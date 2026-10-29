import hashlib
import importlib
import json
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import auth as firebase_auth, firestore
from google.api_core.exceptions import AlreadyExists, NotFound
from google.cloud.firestore_v1 import SERVER_TIMESTAMP

from app.api.auth import require_admin, verify_firebase_token

_class_models = importlib.import_module("app.models.class")
ClassCreateRequest = _class_models.ClassCreateRequest
ClassResponse = _class_models.ClassResponse
ClassUpdateRequest = _class_models.ClassUpdateRequest
ClassScheduleEntry = _class_models.ClassScheduleEntry
StudentMembershipCreateRequest = _class_models.StudentMembershipCreateRequest
StudentMembershipResponse = _class_models.StudentMembershipResponse
TeacherSubjectAssignmentCreateRequest = (
    _class_models.TeacherSubjectAssignmentCreateRequest
)
TeacherSubjectAssignmentResponse = _class_models.TeacherSubjectAssignmentResponse

router = APIRouter(dependencies=[Depends(require_admin)])
teacher_router = APIRouter()

CLASS_COLLECTION = "classes"
USER_COLLECTION = "users"
SUBJECT_COLLECTION = "subjects"
ASSIGNMENT_COLLECTION = "class_teacher_assignments"
MEMBERSHIP_COLLECTION = "class_memberships"


def get_database():
    return firestore.client()


def validate_document_id(value: str, label: str) -> str:
    if (
        not value
        or len(value.encode("utf-8")) > 1500
        or "/" in value
        or value in {".", ".."}
        or (value.startswith("__") and value.endswith("__"))
    ):
        raise HTTPException(status_code=422, detail=f"Invalid {label}.")
    return value


def document_data(snapshot: Any, label: str) -> dict[str, Any]:
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail=f"{label} not found.")
    return snapshot.to_dict() or {}


def class_response(document_id: str, data: dict[str, Any]) -> ClassResponse:
    try:
        return ClassResponse.model_validate(data | {"id": document_id})
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=500,
            detail="Stored class data is invalid.",
        ) from None


def assignment_response(
    document_id: str,
    data: dict[str, Any],
) -> TeacherSubjectAssignmentResponse:
    try:
        return TeacherSubjectAssignmentResponse.model_validate(data | {"id": document_id})
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=500,
            detail="Stored teacher assignment data is invalid.",
        ) from None


def membership_response(
    document_id: str,
    data: dict[str, Any],
) -> StudentMembershipResponse:
    try:
        return StudentMembershipResponse.model_validate(data | {"id": document_id})
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=500,
            detail="Stored student membership data is invalid.",
        ) from None


def validate_account(database, uid: str, expected_role: str) -> dict[str, Any]:
    validate_document_id(uid, "account ID")
    profile_snapshot = database.collection(USER_COLLECTION).document(uid).get()
    profile = document_data(profile_snapshot, "User account")

    try:
        account = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User account not found.") from None

    claims = account.custom_claims or {}
    if (
        account.disabled
        or profile.get("status") != "active"
        or profile.get("role") != expected_role
        or claims.get("role") != expected_role
    ):
        raise HTTPException(
            status_code=422,
            detail=f"An active {expected_role} account is required.",
        )
    return profile


def require_active_class(database, class_id: str) -> dict[str, Any]:
    validate_document_id(class_id, "class ID")
    snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
    class_data = document_data(snapshot, "Class")
    if class_data.get("status") != "active":
        raise HTTPException(
            status_code=409,
            detail="The class is inactive and cannot accept new assignments or members.",
        )
    return class_data


def relationship_document_id(prefix: str, *parts: str) -> str:
    encoded = json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    return f"{prefix}_{hashlib.sha256(encoded).hexdigest()}"


def validate_path_class_id(class_id: str) -> None:
    validate_document_id(class_id, "class ID")


def validate_class_schedule(
    database,
    status_value: str,
    grade_level: str,
    schedule: list[dict[str, Any]],
) -> None:
    if schedule and status_value != "active":
        raise HTTPException(
            status_code=409,
            detail="Schedules can only be assigned to an active class.",
        )

    entry_ids: set[str] = set()
    entries_by_day: dict[str, list[dict[str, Any]]] = {}
    for entry in schedule:
        entry_id = entry["id"]
        if entry_id in entry_ids:
            raise HTTPException(
                status_code=422,
                detail="Schedule entry IDs must be unique within a class.",
            )
        entry_ids.add(entry_id)
        if entry["start_time"] >= entry["end_time"]:
            raise HTTPException(
                status_code=422,
                detail="Schedule end time must be later than start time.",
            )

        day_entries = entries_by_day.setdefault(entry["day"], [])
        if any(
            entry["start_time"] < current["end_time"]
            and entry["end_time"] > current["start_time"]
            for current in day_entries
        ):
            raise HTTPException(
                status_code=422,
                detail="Schedule entries cannot overlap on the same day.",
            )
        day_entries.append(entry)

        subject_snapshot = (
            database.collection(SUBJECT_COLLECTION)
            .document(entry["subject_id"])
            .get()
        )
        subject = document_data(subject_snapshot, "Subject")
        validate_account(database, entry["teacher_uid"], "teacher")
        validate_teacher_subject(subject, entry["teacher_uid"])
        validate_subject_class(subject, grade_level)


def validate_subject_class(subject: dict[str, Any], grade_level: str) -> None:
    grade_levels = subject.get("grade_levels", [])
    if not isinstance(grade_levels, (list, tuple)) or grade_level not in grade_levels:
        raise HTTPException(
            status_code=422,
            detail="The subject is not available for this class's grade level.",
        )


@teacher_router.get("/teacher/classes")
def list_teacher_classes(
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> list[dict[str, Any]]:
    teacher_uid = decoded_token.get("uid")
    if decoded_token.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    if not isinstance(teacher_uid, str) or not teacher_uid:
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token.")

    validate_document_id(teacher_uid, "teacher ID")
    database = get_database()
    validate_account(database, teacher_uid, "teacher")

    class_ids: set[str] = set()
    for document in database.collection(CLASS_COLLECTION).stream():
        class_data = document.to_dict() or {}
        if class_data.get("status") == "active" and class_data.get("lead_teacher_uid") == teacher_uid:
            class_ids.add(document.id)

    for document in database.collection(ASSIGNMENT_COLLECTION).where(
        "teacher_uid", "==", teacher_uid
    ).stream():
        assignment_data = document.to_dict() or {}
        if assignment_data.get("status") == "active":
            class_id = assignment_data.get("class_id")
            if isinstance(class_id, str):
                class_ids.add(class_id)

    teacher_classes: list[dict[str, Any]] = []
    for class_id in sorted(class_ids):
        class_snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
        if not class_snapshot.exists:
            continue
        class_data = class_snapshot.to_dict() or {}
        if class_data.get("status") != "active":
            continue

        assignment_records = [
            record.to_dict() or {}
            for record in database.collection(ASSIGNMENT_COLLECTION)
            .where("class_id", "==", class_id)
            .stream()
        ]
        subject_entries: list[dict[str, Any]] = []
        seen_subject_ids: set[str] = set()
        for assignment in assignment_records:
            if (
                assignment.get("status") != "active"
                or assignment.get("teacher_uid") != teacher_uid
            ):
                continue
            subject_id = assignment.get("subject_id")
            if not isinstance(subject_id, str) or not subject_id:
                continue
            if subject_id in seen_subject_ids:
                continue
            seen_subject_ids.add(subject_id)

            subject_snapshot = (
                database.collection(SUBJECT_COLLECTION).document(subject_id).get()
            )
            if not subject_snapshot.exists:
                continue
            subject_data = subject_snapshot.to_dict() or {}
            teacher_uids = subject_data.get("teacher_ids", [])
            grade_levels = subject_data.get("grade_levels", [])
            if (
                subject_data.get("status") != "active"
                or not isinstance(teacher_uids, (list, tuple))
                or teacher_uid not in teacher_uids
                or not isinstance(grade_levels, (list, tuple))
                or class_data.get("grade_level") not in grade_levels
            ):
                continue
            subject_entries.append(
                {
                    "id": subject_id,
                    "name": subject_data.get("name", ""),
                    "code": subject_data.get("code", ""),
                    "teacher_uids": list(subject_data.get("teacher_ids", [])),
                }
            )

        if not subject_entries and class_data.get("lead_teacher_uid") != teacher_uid:
            continue

        membership_records = [
            record.to_dict() or {}
            for record in database.collection(MEMBERSHIP_COLLECTION)
            .where("class_id", "==", class_id)
            .stream()
        ]
        students: list[dict[str, Any]] = []
        seen_student_uids: set[str] = set()
        for membership in membership_records:
            if membership.get("status") != "active":
                continue
            student_uid = membership.get("student_uid")
            if (
                not isinstance(student_uid, str)
                or not student_uid
                or student_uid in seen_student_uids
            ):
                continue
            seen_student_uids.add(student_uid)
            profile_snapshot = database.collection(USER_COLLECTION).document(student_uid).get()
            profile = profile_snapshot.to_dict() or {}
            students.append(
                {
                    "uid": student_uid,
                    "name": profile.get("name") or profile.get("display_name") or student_uid,
                    "grade_level": profile.get("grade_level"),
                    "section": profile.get("section"),
                }
            )

        teacher_classes.append(
            {
                "id": class_id,
                "name": class_data.get("name", ""),
                "grade_level": class_data.get("grade_level", ""),
                "section": class_data.get("section", ""),
                "status": class_data.get("status", "active"),
                "lead_teacher_uid": class_data.get("lead_teacher_uid"),
                "is_adviser": class_data.get("lead_teacher_uid") == teacher_uid,
                "student_count": len(students),
                "students": students,
                "assigned_subjects": subject_entries,
            }
        )

    return sorted(
        teacher_classes,
        key=lambda item: (
            str(item.get("grade_level", "")).casefold(),
            str(item.get("section", "")).casefold(),
            str(item.get("id", "")).casefold(),
        ),
    )


@router.get("/admin/classes", response_model=list[ClassResponse])
def list_classes() -> list[ClassResponse]:
    database = get_database()
    classes = [
        class_response(document.id, document.to_dict() or {})
        for document in database.collection(CLASS_COLLECTION).stream()
    ]
    return sorted(
        classes,
        key=lambda item: (item.grade_level.casefold(), item.section.casefold(), item.id),
    )


@router.post(
    "/admin/classes",
    response_model=ClassResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_class(data: ClassCreateRequest) -> ClassResponse:
    database = get_database()
    if data.lead_teacher_uid is not None:
        validate_account(database, data.lead_teacher_uid, "teacher")

    class_ref = database.collection(CLASS_COLLECTION).document()
    class_data = data.model_dump()
    validate_class_schedule(
        database,
        class_data["status"],
        class_data["grade_level"],
        class_data["schedule"],
    )
    class_data.update(
        {
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    try:
        class_ref.create(class_data)
    except AlreadyExists:
        raise HTTPException(
            status_code=409,
            detail="A class with this identifier already exists.",
        ) from None

    return class_response(class_ref.id, class_ref.get().to_dict() or {})


@router.get("/admin/classes/{class_id}", response_model=ClassResponse)
def get_class(class_id: str) -> ClassResponse:
    validate_path_class_id(class_id)
    database = get_database()
    snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
    return class_response(class_id, document_data(snapshot, "Class"))


@router.patch("/admin/classes/{class_id}", response_model=ClassResponse)
def update_class(class_id: str, data: ClassUpdateRequest) -> ClassResponse:
    validate_path_class_id(class_id)
    database = get_database()
    class_ref = database.collection(CLASS_COLLECTION).document(class_id)
    current_data = document_data(class_ref.get(), "Class")

    changes = data.model_dump(exclude_unset=True)
    if "lead_teacher_uid" in changes and changes["lead_teacher_uid"] is not None:
        validate_account(database, changes["lead_teacher_uid"], "teacher")
    if "schedule" in changes or "grade_level" in changes:
        schedule = changes.get("schedule", current_data.get("schedule", []))
        schedule = [
            item.model_dump() if isinstance(item, ClassScheduleEntry) else item
            for item in schedule
        ]
        validate_class_schedule(
            database,
            changes.get("status", current_data.get("status", "active")),
            changes.get("grade_level", current_data.get("grade_level", "")),
            schedule,
        )
        if "schedule" in changes:
            changes["schedule"] = schedule
    changes["updated_at"] = SERVER_TIMESTAMP

    try:
        class_ref.update(changes)
    except NotFound:
        raise HTTPException(status_code=404, detail="Class not found.") from None

    updated_data = class_ref.get().to_dict() or current_data
    return class_response(class_id, updated_data)


def validate_assignment_request(
    database,
    class_id: str,
    data: TeacherSubjectAssignmentCreateRequest,
) -> None:
    if data.class_id != class_id:
        raise HTTPException(
            status_code=422,
            detail="The assignment class_id must match the requested class.",
        )
    class_data = require_active_class(database, class_id)
    validate_document_id(data.subject_id, "subject ID")
    subject_snapshot = (
        database.collection(SUBJECT_COLLECTION).document(data.subject_id).get()
    )
    subject = document_data(subject_snapshot, "Subject")
    validate_account(database, data.teacher_uid, "teacher")

    validate_teacher_subject(subject, data.teacher_uid)
    validate_subject_class(subject, class_data.get("grade_level", ""))


def validate_teacher_subject(subject: dict[str, Any], teacher_uid: str) -> None:
    teacher_ids = subject.get("teacher_ids", [])
    if subject.get("status") != "active":
        raise HTTPException(status_code=422, detail="An active subject is required.")
    if not isinstance(teacher_ids, (list, tuple)) or teacher_uid not in teacher_ids:
        raise HTTPException(
            status_code=422,
            detail="The teacher is not assigned to this subject.",
        )


def require_active_class_data(class_data: dict[str, Any]) -> None:
    if class_data.get("status") != "active":
        raise HTTPException(
            status_code=409,
            detail="The class is inactive and cannot accept new assignments or members.",
        )


@router.get(
    "/admin/classes/{class_id}/teacher-assignments",
    response_model=list[TeacherSubjectAssignmentResponse],
)
def list_teacher_assignments(class_id: str) -> list[TeacherSubjectAssignmentResponse]:
    validate_path_class_id(class_id)
    database = get_database()
    class_snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
    document_data(class_snapshot, "Class")
    assignments = [
        assignment_response(document.id, document.to_dict() or {})
        for document in database.collection(ASSIGNMENT_COLLECTION)
        .where("class_id", "==", class_id)
        .stream()
    ]
    return sorted(
        assignments,
        key=lambda item: (item.subject_id, item.teacher_uid, item.id),
    )


@router.get(
    "/admin/teacher-assignments",
    response_model=list[TeacherSubjectAssignmentResponse],
)
def list_all_teacher_assignments() -> list[TeacherSubjectAssignmentResponse]:
    database = get_database()
    assignments = [
        assignment_response(document.id, document.to_dict() or {})
        for document in database.collection(ASSIGNMENT_COLLECTION).stream()
    ]
    return sorted(
        assignments,
        key=lambda item: (
            item.teacher_uid,
            item.class_id,
            item.subject_id,
            item.id,
        ),
    )


@router.post(
    "/admin/classes/{class_id}/teacher-assignments",
    response_model=TeacherSubjectAssignmentResponse,
)
def create_teacher_assignment(
    class_id: str,
    data: TeacherSubjectAssignmentCreateRequest,
) -> TeacherSubjectAssignmentResponse:
    validate_path_class_id(class_id)
    database = get_database()
    validate_assignment_request(database, class_id, data)

    assignment_id = relationship_document_id(
        "tsa",
        class_id,
        data.subject_id,
        data.teacher_uid,
    )
    assignment_ref = database.collection(ASSIGNMENT_COLLECTION).document(assignment_id)
    try:
        @firestore.transactional
        def save_assignment(transaction):
            class_ref = database.collection(CLASS_COLLECTION).document(class_id)
            class_data = document_data(
                class_ref.get(transaction=transaction),
                "Class",
            )
            require_active_class_data(class_data)

            subject_ref = database.collection(SUBJECT_COLLECTION).document(
                data.subject_id
            )
            subject = document_data(
                subject_ref.get(transaction=transaction),
                "Subject",
            )
            validate_teacher_subject(subject, data.teacher_uid)
            validate_subject_class(subject, class_data.get("grade_level", ""))

            profile_ref = database.collection(USER_COLLECTION).document(
                data.teacher_uid
            )
            profile = document_data(
                profile_ref.get(transaction=transaction),
                "User account",
            )
            if profile.get("role") != "teacher" or profile.get("status") != "active":
                raise HTTPException(
                    status_code=422,
                    detail="An active teacher account is required.",
                )

            existing_snapshot = assignment_ref.get(transaction=transaction)
            if existing_snapshot.exists:
                existing_data = existing_snapshot.to_dict() or {}
                if existing_data.get("status") == data.status:
                    return
                transaction.update(
                    assignment_ref,
                    {"status": data.status, "updated_at": SERVER_TIMESTAMP},
                )
                return

            assignment_data = data.model_dump()
            assignment_data.update(
                {
                    "created_at": SERVER_TIMESTAMP,
                    "updated_at": SERVER_TIMESTAMP,
                }
            )
            transaction.create(assignment_ref, assignment_data)

        save_assignment(database.transaction())
    except AlreadyExists:
        concurrent_data = assignment_ref.get().to_dict() or {}
        if concurrent_data.get("status") == "active":
            return assignment_response(assignment_id, concurrent_data)
        raise HTTPException(
            status_code=409,
            detail="The teacher assignment changed concurrently.",
        ) from None
    return assignment_response(assignment_id, assignment_ref.get().to_dict() or {})


def deactivate_relationship(
    database,
    collection_name: str,
    class_id: str,
    relationship_id: str,
    response_factory: Callable[[str, dict[str, Any]], Any],
    label: str,
):
    validate_path_class_id(class_id)
    validate_document_id(relationship_id, f"{label} ID")
    relationship_ref = database.collection(collection_name).document(relationship_id)
    relationship_data = document_data(relationship_ref.get(), label)
    if relationship_data.get("class_id") != class_id:
        raise HTTPException(status_code=404, detail=f"{label} not found.")

    if relationship_data.get("status") != "inactive":
        relationship_ref.update(
            {"status": "inactive", "updated_at": SERVER_TIMESTAMP}
        )
        relationship_data = relationship_ref.get().to_dict() or relationship_data
    return response_factory(relationship_id, relationship_data)


@router.delete(
    "/admin/classes/{class_id}/teacher-assignments/{assignment_id}",
    response_model=TeacherSubjectAssignmentResponse,
)
def deactivate_teacher_assignment(
    class_id: str,
    assignment_id: str,
) -> TeacherSubjectAssignmentResponse:
    return deactivate_relationship(
        get_database(),
        ASSIGNMENT_COLLECTION,
        class_id,
        assignment_id,
        assignment_response,
        "Teacher assignment",
    )


@router.get(
    "/admin/classes/{class_id}/memberships",
    response_model=list[StudentMembershipResponse],
)
def list_memberships(class_id: str) -> list[StudentMembershipResponse]:
    validate_path_class_id(class_id)
    database = get_database()
    class_snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
    document_data(class_snapshot, "Class")
    memberships = [
        membership_response(document.id, document.to_dict() or {})
        for document in database.collection(MEMBERSHIP_COLLECTION)
        .where("class_id", "==", class_id)
        .stream()
    ]
    return sorted(memberships, key=lambda item: (item.student_uid, item.id))


@router.post(
    "/admin/classes/{class_id}/memberships",
    response_model=StudentMembershipResponse,
)
def create_membership(
    class_id: str,
    data: StudentMembershipCreateRequest,
) -> StudentMembershipResponse:
    validate_path_class_id(class_id)
    if data.class_id != class_id:
        raise HTTPException(
            status_code=422,
            detail="The membership class_id must match the requested class.",
        )
    database = get_database()
    require_active_class(database, class_id)
    validate_account(database, data.student_uid, "student")

    membership_id = relationship_document_id(
        "mem",
        class_id,
        data.student_uid,
    )
    membership_ref = database.collection(MEMBERSHIP_COLLECTION).document(membership_id)
    try:
        @firestore.transactional
        def save_membership(transaction):
            class_ref = database.collection(CLASS_COLLECTION).document(class_id)
            class_data = document_data(
                class_ref.get(transaction=transaction),
                "Class",
            )
            require_active_class_data(class_data)

            profile_ref = database.collection(USER_COLLECTION).document(
                data.student_uid
            )
            profile = document_data(
                profile_ref.get(transaction=transaction),
                "User account",
            )
            if profile.get("role") != "student" or profile.get("status") != "active":
                raise HTTPException(
                    status_code=422,
                    detail="An active student account is required.",
                )

            existing_snapshot = membership_ref.get(transaction=transaction)
            if existing_snapshot.exists:
                existing_data = existing_snapshot.to_dict() or {}
                if existing_data.get("status") == data.status:
                    return
                transaction.update(
                    membership_ref,
                    {"status": data.status, "updated_at": SERVER_TIMESTAMP},
                )
                return

            membership_data = data.model_dump()
            membership_data.update(
                {
                    "created_at": SERVER_TIMESTAMP,
                    "updated_at": SERVER_TIMESTAMP,
                }
            )
            transaction.create(membership_ref, membership_data)

        save_membership(database.transaction())
    except AlreadyExists:
        concurrent_data = membership_ref.get().to_dict() or {}
        if concurrent_data.get("status") == "active":
            return membership_response(membership_id, concurrent_data)
        raise HTTPException(
            status_code=409,
            detail="The student membership changed concurrently.",
        ) from None
    return membership_response(membership_id, membership_ref.get().to_dict() or {})


@router.delete(
    "/admin/classes/{class_id}/memberships/{membership_id}",
    response_model=StudentMembershipResponse,
)
def deactivate_membership(
    class_id: str,
    membership_id: str,
) -> StudentMembershipResponse:
    return deactivate_relationship(
        get_database(),
        MEMBERSHIP_COLLECTION,
        class_id,
        membership_id,
        membership_response,
        "Student membership",
    )
