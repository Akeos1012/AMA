from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import auth as firebase_auth, firestore
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from pydantic import BaseModel, Field

from app.api.auth import require_admin

router = APIRouter()

GradeLevel = Literal[
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
    "Grade 6",
]
SubjectStatus = Literal["active", "inactive"]


class CreateSubjectRequest(BaseModel):
    name: str
    code: str
    description: str = ""
    grade_levels: list[GradeLevel]
    status: SubjectStatus = "active"
    teacher_ids: list[str] = Field(default_factory=list)


class UpdateSubjectRequest(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    grade_levels: list[GradeLevel] | None = None
    status: SubjectStatus | None = None
    add_teacher_ids: list[str] = Field(default_factory=list)
    remove_teacher_ids: list[str] = Field(default_factory=list)


def get_database():
    return firestore.client()


def normalize_subject_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Subject name is required.")
    return name


def normalize_subject_code(value: str) -> str:
    code = value.strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="Subject code is required.")
    return code


def validate_grade_levels(grade_levels: list[str]) -> list[str]:
    cleaned = list(dict.fromkeys(grade_levels))
    if not cleaned:
        raise HTTPException(
            status_code=422,
            detail="Select at least one applicable grade level.",
        )
    return cleaned


def validate_teacher_ids(database, teacher_ids: list[str]) -> list[str]:
    cleaned = list(dict.fromkeys(teacher_id.strip() for teacher_id in teacher_ids))
    if any(not teacher_id for teacher_id in cleaned):
        raise HTTPException(status_code=422, detail="Teacher IDs must not be empty.")

    for teacher_id in cleaned:
        try:
            user = firebase_auth.get_user(teacher_id)
        except firebase_auth.UserNotFoundError:
            raise HTTPException(
                status_code=422,
                detail="One or more selected teachers could not be found.",
            ) from None

        profile_snapshot = database.collection("users").document(teacher_id).get()
        profile = profile_snapshot.to_dict() or {}
        if (
            user.disabled
            or (user.custom_claims or {}).get("role") != "teacher"
            or profile.get("role") != "teacher"
            or profile.get("status") != "active"
        ):
            raise HTTPException(
                status_code=422,
                detail="Only active teacher accounts can be assigned to subjects.",
            )

    return cleaned


def ensure_unique_code(database, code: str, excluded_subject_id: str | None = None):
    for document in database.collection("subjects").stream():
        if document.id == excluded_subject_id:
            continue
        if str((document.to_dict() or {}).get("code", "")).upper() == code:
            raise HTTPException(
                status_code=409,
                detail="A subject with this code already exists.",
            )


def subject_response(document_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document_id,
        "name": data.get("name", ""),
        "code": data.get("code", ""),
        "description": data.get("description", ""),
        "grade_levels": data.get("grade_levels", []),
        "status": data.get("status", "active"),
        "teacher_ids": data.get("teacher_ids", []),
    }


@router.get("/admin/subjects")
def list_subjects(
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> list[dict[str, Any]]:
    database = get_database()
    subjects = [
        subject_response(document.id, document.to_dict())
        for document in database.collection("subjects").stream()
    ]
    return sorted(subjects, key=lambda subject: subject["name"].lower())


@router.post("/admin/subjects")
def create_subject(
    data: CreateSubjectRequest,
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    database = get_database()
    name = normalize_subject_name(data.name)
    code = normalize_subject_code(data.code)
    grade_levels = validate_grade_levels(data.grade_levels)
    teacher_ids = validate_teacher_ids(database, data.teacher_ids)
    ensure_unique_code(database, code)

    subject_data = {
        "name": name,
        "code": code,
        "description": data.description.strip(),
        "grade_levels": grade_levels,
        "status": data.status,
        "teacher_ids": teacher_ids,
        "created_at": SERVER_TIMESTAMP,
        "updated_at": SERVER_TIMESTAMP,
    }
    document = database.collection("subjects").document()
    document.set(subject_data)
    return subject_response(document.id, subject_data)


@router.patch("/admin/subjects/{subject_id}")
def update_subject(
    subject_id: str,
    data: UpdateSubjectRequest,
    decoded_token: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    database = get_database()
    document = database.collection("subjects").document(subject_id)
    transaction = database.transaction()
    changes = data.dict(exclude_unset=True)
    add_teacher_ids = validate_teacher_ids(database, data.add_teacher_ids)
    remove_teacher_ids = list(dict.fromkeys(data.remove_teacher_ids))

    if set(add_teacher_ids) & set(remove_teacher_ids):
        raise HTTPException(
            status_code=422,
            detail="A teacher cannot be added and removed in the same update.",
        )

    changes.pop("add_teacher_ids", None)
    changes.pop("remove_teacher_ids", None)

    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(status_code=422, detail="Subject name is required.")
        changes["name"] = normalize_subject_name(changes["name"])

    if "code" in changes:
        if changes["code"] is None:
            raise HTTPException(status_code=422, detail="Subject code is required.")
        changes["code"] = normalize_subject_code(changes["code"])
        ensure_unique_code(database, changes["code"], subject_id)

    if "description" in changes:
        if changes["description"] is None:
            raise HTTPException(status_code=422, detail="Description cannot be null.")
        changes["description"] = changes["description"].strip()

    if "grade_levels" in changes:
        if changes["grade_levels"] is None:
            raise HTTPException(
                status_code=422,
                detail="Select at least one applicable grade level.",
            )
        changes["grade_levels"] = validate_grade_levels(changes["grade_levels"])

    if "status" in changes and changes["status"] is None:
        raise HTTPException(status_code=422, detail="Subject status is required.")

    if not changes and not add_teacher_ids and not remove_teacher_ids:
        raise HTTPException(status_code=422, detail="No subject changes were provided.")

    changes["updated_at"] = SERVER_TIMESTAMP

    @firestore.transactional
    def apply_changes(current_transaction):
        snapshot = document.get(transaction=current_transaction)
        if not snapshot.exists:
            raise HTTPException(status_code=404, detail="Subject not found.")

        current_data = snapshot.to_dict()
        teacher_ids = set(current_data.get("teacher_ids", []))
        teacher_ids.update(add_teacher_ids)
        teacher_ids.difference_update(remove_teacher_ids)
        updated_data = dict(current_data)
        updated_data.update(changes)
        updated_data["teacher_ids"] = sorted(teacher_ids)
        current_transaction.update(document, changes | {"teacher_ids": sorted(teacher_ids)})
        return subject_response(subject_id, updated_data)

    return apply_changes(transaction)
