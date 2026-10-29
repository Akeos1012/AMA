from typing import Any, Literal

import secrets
import firebase_admin

from firebase_admin import auth as firebase_auth, firestore
from google.cloud.firestore_v1 import SERVER_TIMESTAMP

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, ValidationError

from app.api.auth import require_admin

router = APIRouter()


class CreateUserRequest(BaseModel):
    name: str
    email: EmailStr
    role: Literal["student", "teacher"]
    grade_level: str | None = None
    section: str | None = None
    sex: Literal["boy", "girl"] | None = None
    student_id: str | None = None
    employee_id: str | None = None
    department_subject: str | None = None


class UpdateUserRequest(BaseModel):
    name: str
    email: EmailStr
    student_id: str | None = None
    grade_level: str | None = None
    section: str | None = None
    sex: Literal["boy", "girl"] | None = None
    employee_id: str | None = None
    department_subject: str | None = None


class UserStatusRequest(BaseModel):
    disabled: bool


class PasswordResetTargetResponse(BaseModel):
    email: EmailStr


@router.get("/admin/users")
def list_users(
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> list[dict[str, Any]]:
    users = []
    auth_users = list(firebase_auth.list_users().iterate_all())
    db = firestore.client()
    profile_refs = [
        db.collection("users").document(user.uid) for user in auth_users
    ]
    profiles = {
        snapshot.id: snapshot.to_dict() or {}
        for snapshot in db.get_all(profile_refs)
    }

    for user in auth_users:
        claims = user.custom_claims or {}
        profile = profiles.get(user.uid, {})
        users.append(
            {
                "uid": user.uid,
                "email": user.email,
                "display_name": user.display_name or profile.get("name"),
                "disabled": user.disabled,
                "email_verified": user.email_verified,
                "role": claims.get("role"),
                "profile_status": profile.get("status"),
                "created_at": user.user_metadata.creation_timestamp,
                "student_id": claims.get("student_id"),
                "employee_id": claims.get("employee_id"),
                "grade_level": profile.get("grade_level"),
                "section": profile.get("section"),
                "sex": profile.get("sex"),
                "department_subject": profile.get("department_subject"),
            }
        )

    return users


@router.post(
    "/admin/users/{uid}/password-reset",
    response_model=PasswordResetTargetResponse,
)
def get_password_reset_target(
    uid: str,
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> PasswordResetTargetResponse:
    try:
        user = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User account not found.") from None

    role = (user.custom_claims or {}).get("role")
    if role not in {"student", "teacher"}:
        raise HTTPException(
            status_code=403,
            detail="Password resets are only available for student and teacher accounts.",
        )

    try:
        return PasswordResetTargetResponse.model_validate({"email": user.email})
    except ValidationError:
        raise HTTPException(
            status_code=422,
            detail="The user account does not have a valid registered email address.",
        ) from None


def ensure_editable_user(uid: str) -> tuple[Any, dict[str, Any]]:
    try:
        user = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User account not found.") from None

    claims = user.custom_claims or {}
    if claims.get("role") == "admin":
        raise HTTPException(
            status_code=403,
            detail="Administrator accounts cannot be changed here.",
        )
    if claims.get("role") not in {"student", "teacher"}:
        raise HTTPException(status_code=400, detail="Unsupported user role.")
    return user, claims


def check_duplicate_user_id(role: str, value: str, except_uid: str) -> None:
    for user in firebase_auth.list_users().iterate_all():
        if user.uid == except_uid:
            continue
        claims = user.custom_claims or {}
        claim_name = "student_id" if role == "student" else "employee_id"
        if claims.get(claim_name) == value:
            label = "Student ID" if role == "student" else "Employee ID"
            raise HTTPException(
                status_code=409,
                detail=f"A user with this {label} already exists.",
            )


@router.patch("/admin/users/{uid}")
def update_user(
    uid: str,
    data: UpdateUserRequest,
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    user, claims = ensure_editable_user(uid)
    role = claims["role"]
    profile_updates: dict[str, Any] = {
        "uid": uid,
        "name": data.name.strip(),
        "email": str(data.email),
        "role": role,
    }
    user_updates: dict[str, Any] = {
        "display_name": data.name.strip(),
        "email": str(data.email),
    }

    if not data.name.strip():
        raise HTTPException(status_code=422, detail="Name is required.")

    if role == "student":
        if not data.student_id or not data.grade_level or not data.section or not data.sex:
            raise HTTPException(
                status_code=422,
                detail="Student requires student ID, grade level, section, and sex.",
            )
        check_duplicate_user_id(role, data.student_id, uid)
        claims["student_id"] = data.student_id
        profile_updates.update(
            {
                "student_id": data.student_id,
                "grade_level": data.grade_level,
                "section": data.section,
                "sex": data.sex,
            }
        )
    else:
        if not data.employee_id or not data.department_subject:
            raise HTTPException(
                status_code=422,
                detail="Teacher requires employee ID and department/subject.",
            )
        check_duplicate_user_id(role, data.employee_id, uid)
        claims["employee_id"] = data.employee_id
        profile_updates.update(
            {
                "employee_id": data.employee_id,
                "department_subject": data.department_subject,
            }
        )

    try:
        updated_user = firebase_auth.update_user(uid, **user_updates)
    except firebase_auth.EmailAlreadyExistsError:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        ) from None

    firebase_auth.set_custom_user_claims(uid, claims)
    firestore.client().collection("users").document(uid).set(
        profile_updates,
        merge=True,
    )
    return {"message": "User updated successfully", "uid": updated_user.uid}


@router.patch("/admin/users/{uid}/status")
def update_user_status(
    uid: str,
    data: UserStatusRequest,
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    ensure_editable_user(uid)
    try:
        user = firebase_auth.update_user(uid, disabled=data.disabled)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User account not found.") from None

    firestore.client().collection("users").document(uid).set(
        {"status": "disabled" if data.disabled else "active"},
        merge=True,
    )
    return {
        "message": "User status updated successfully",
        "uid": user.uid,
        "disabled": user.disabled,
    }


def check_duplicate_id(data: CreateUserRequest) -> None:
    for user in firebase_auth.list_users().iterate_all():
        if data.role == "student":
            existing_id = (user.custom_claims or {}).get("student_id")

            if existing_id and existing_id == data.student_id:
                raise HTTPException(
                    status_code=409,
                    detail="A student with this Student ID already exists.",
                )

        if data.role == "teacher":
            existing_id = (user.custom_claims or {}).get("employee_id")

            if existing_id and existing_id == data.employee_id:
                raise HTTPException(
                    status_code=409,
                    detail="A teacher with this Employee ID already exists.",
                )


@router.post("/admin/users")
def create_user(
    data: CreateUserRequest,
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:

    check_duplicate_id(data)

    if data.role == "student":
        if (
            not data.student_id
            or not data.grade_level
            or not data.section
            or not data.sex
        ):
            raise HTTPException(
                status_code=422,
                detail="Student requires student ID, grade level, section, and sex.",
            )

    if data.role == "teacher":
        if not data.employee_id or not data.department_subject:
            raise HTTPException(
                status_code=422,
                detail="Teacher requires employee ID and department/subject.",
            )

    try:
        user = firebase_auth.create_user(
            email=data.email,
            display_name=data.name,
            password=secrets.token_urlsafe(24),
        )
    except firebase_auth.EmailAlreadyExistsError:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        ) from None

    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Unable to create the user account.",
        ) from None

    claims = {
        "role": data.role,
    }

    if data.role == "student":
        claims["student_id"] = data.student_id

    if data.role == "teacher":
        claims["employee_id"] = data.employee_id

    firebase_auth.set_custom_user_claims(
        user.uid,
        claims,
    )

    db = firestore.client()

    profile = {
        "uid": user.uid,
        "name": data.name,
        "email": data.email,
        "role": data.role,
        "status": "active",
        "created_at": SERVER_TIMESTAMP,
    }

    if data.role == "student":
        profile.update(
            {
                "grade_level": data.grade_level,
                "section": data.section,
                "sex": data.sex,
                "student_id": data.student_id,
            }
        )

    if data.role == "teacher":
        profile.update(
            {
                "employee_id": data.employee_id,
                "department_subject": data.department_subject,
            }
        )

    db.collection("users").document(user.uid).set(profile)

    return {
        "message": "User created successfully",
        "uid": user.uid,
        "email": user.email,
        "role": data.role,
    }
