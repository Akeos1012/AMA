from typing import Any

from fastapi import HTTPException
from firebase_admin import auth as firebase_auth


USER_COLLECTION = "users"
CLASS_COLLECTION = "classes"
SUBJECT_COLLECTION = "subjects"
ASSIGNMENT_COLLECTION = "class_teacher_assignments"
MEMBERSHIP_COLLECTION = "class_memberships"


def validate_active_account(
    database,
    uid: str,
    role: str,
) -> dict[str, Any]:
    profile_snapshot = database.collection(USER_COLLECTION).document(uid).get()
    if not profile_snapshot.exists:
        raise HTTPException(status_code=403, detail="An active account is required.")
    profile = profile_snapshot.to_dict() or {}

    try:
        account = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(
            status_code=403,
            detail="An active account is required.",
        ) from None

    if (
        account.disabled
        or profile.get("status") != "active"
        or profile.get("role") != role
    ):
        raise HTTPException(status_code=403, detail="An active account is required.")
    return profile


def require_active_class(database, class_id: str) -> dict[str, Any] | None:
    snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
    if not snapshot.exists:
        return None
    class_data = snapshot.to_dict() or {}
    if class_data.get("status") != "active":
        return None
    return class_data


def require_active_subject(database, subject_id: str) -> dict[str, Any] | None:
    snapshot = database.collection(SUBJECT_COLLECTION).document(subject_id).get()
    if not snapshot.exists:
        return None
    subject_data = snapshot.to_dict() or {}
    if subject_data.get("status") != "active":
        return None
    return subject_data


def has_active_assignment(
    database,
    class_id: str,
    subject_id: str,
    teacher_uid: str | None = None,
) -> bool:
    assignments = (
        database.collection(ASSIGNMENT_COLLECTION)
        .where("class_id", "==", class_id)
        .where("subject_id", "==", subject_id)
        .where("status", "==", "active")
    )
    if teacher_uid is not None:
        assignments = assignments.where("teacher_uid", "==", teacher_uid)
    return next(iter(assignments.limit(1).stream()), None) is not None


def teacher_can_manage_lesson(
    database,
    teacher_uid: str,
    class_id: str,
    subject_id: str,
) -> bool:
    if require_active_class(database, class_id) is None:
        return False
    subject = require_active_subject(database, subject_id)
    if subject is None:
        return False
    teacher_ids = subject.get("teacher_ids", [])
    return (
        isinstance(teacher_ids, (list, tuple))
        and teacher_uid in teacher_ids
        and has_active_assignment(database, class_id, subject_id, teacher_uid)
    )


def require_teacher_lesson_access(
    database,
    teacher_uid: str,
    lesson: dict[str, Any],
) -> None:
    if not teacher_can_manage_lesson(
        database,
        teacher_uid,
        lesson.get("class_id", ""),
        lesson.get("subject_id", ""),
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to manage this lesson.",
        )


def student_can_read_lesson(
    database,
    student_uid: str,
    lesson: dict[str, Any],
) -> bool:
    class_id = lesson.get("class_id", "")
    subject_id = lesson.get("subject_id", "")
    if lesson.get("status") != "published":
        return False
    if require_active_class(database, class_id) is None:
        return False
    if require_active_subject(database, subject_id) is None:
        return False

    memberships = (
        database.collection(MEMBERSHIP_COLLECTION)
        .where("class_id", "==", class_id)
        .where("student_uid", "==", student_uid)
        .where("status", "==", "active")
        .limit(1)
        .stream()
    )
    return (
        next(iter(memberships), None) is not None
        and has_active_assignment(database, class_id, subject_id)
    )
