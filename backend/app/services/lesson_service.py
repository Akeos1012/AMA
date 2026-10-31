from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from pydantic import ValidationError

from app.models.lesson import (
    LessonCreateRequest,
    LessonResponse,
    LessonUpdateRequest,
)
from app.services.lesson_access_service import (
    require_active_class,
    require_teacher_lesson_access,
    student_can_read_lesson,
    teacher_can_manage_lesson,
)
from app.validation.lesson_validation import (
    validate_document_id,
    validate_publishable_lesson,
)


LESSON_COLLECTION = "lessons"
MEMBERSHIP_COLLECTION = "class_memberships"


def lesson_snapshot(database, lesson_id: str) -> tuple[Any, dict[str, Any]]:
    validate_document_id(lesson_id, "lesson ID")
    snapshot = database.collection(LESSON_COLLECTION).document(lesson_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    return snapshot, snapshot.to_dict() or {}


def aware_datetime(value: Any, field_name: str) -> datetime:
    if not isinstance(value, datetime):
        raise HTTPException(
            status_code=500,
            detail=f"Stored lesson {field_name} timestamp is invalid.",
        )
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def lesson_response(lesson_id: str, data: dict[str, Any]) -> LessonResponse:
    response_data = dict(data)
    response_data.update(
        {
            "id": lesson_id,
            "created_at": aware_datetime(data.get("created_at"), "created_at"),
            "updated_at": aware_datetime(data.get("updated_at"), "updated_at"),
            "published_at": (
                aware_datetime(data["published_at"], "published_at")
                if data.get("published_at") is not None
                else None
            ),
        }
    )
    try:
        return LessonResponse.model_validate(response_data)
    except (TypeError, ValidationError):
        raise HTTPException(
            status_code=500,
            detail="Stored lesson data is invalid.",
        ) from None


def create_lesson(
    database,
    data: LessonCreateRequest,
    teacher_uid: str,
) -> LessonResponse:
    if not teacher_can_manage_lesson(
        database,
        teacher_uid,
        data.class_id,
        data.subject_id,
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized for this class and subject.",
        )

    lesson_ref = database.collection(LESSON_COLLECTION).document()
    lesson_ref.set(
        {
            **data.model_dump(),
            "teacher_id": teacher_uid,
            "status": "draft",
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
            "published_at": None,
        }
    )
    return lesson_response(lesson_ref.id, lesson_ref.get().to_dict() or {})


def list_lessons(
    database,
    role: str,
    uid: str,
) -> list[LessonResponse]:
    if role == "teacher":
        documents = (
            database.collection(LESSON_COLLECTION)
            .where("teacher_id", "==", uid)
            .stream()
        )
        return [
            lesson_response(document.id, data)
            for document in documents
            if (data := document.to_dict() or {})
            and teacher_can_manage_lesson(
                database,
                uid,
                data.get("class_id", ""),
                data.get("subject_id", ""),
            )
        ]

    memberships = (
        database.collection(MEMBERSHIP_COLLECTION)
        .where("student_uid", "==", uid)
        .where("status", "==", "active")
        .stream()
    )
    active_class_ids = {
        membership_data.get("class_id")
        for membership in memberships
        if (membership_data := membership.to_dict() or {})
        and isinstance(membership_data.get("class_id"), str)
        and require_active_class(database, membership_data["class_id"]) is not None
    }

    lessons: dict[str, LessonResponse] = {}
    for class_id in active_class_ids:
        documents = (
            database.collection(LESSON_COLLECTION)
            .where("class_id", "==", class_id)
            .where("status", "==", "published")
            .stream()
        )
        for document in documents:
            data = document.to_dict() or {}
            if student_can_read_lesson(database, uid, data):
                lessons[document.id] = lesson_response(document.id, data)
    return sorted(lessons.values(), key=lambda lesson: lesson.id)


def get_lesson(
    database,
    lesson_id: str,
    data: dict[str, Any],
    role: str,
    uid: str,
) -> LessonResponse:
    if role == "teacher":
        if data.get("teacher_id") != uid:
            raise HTTPException(status_code=404, detail="Lesson not found.")
        require_teacher_lesson_access(database, uid, data)
    elif not student_can_read_lesson(database, uid, data):
        raise HTTPException(status_code=404, detail="Lesson not found.")
    return lesson_response(lesson_id, data)


def update_lesson(
    database,
    lesson_id: str,
    data: LessonUpdateRequest,
    teacher_uid: str,
) -> LessonResponse:
    lesson_ref = database.collection(LESSON_COLLECTION).document(
        validate_document_id(lesson_id, "lesson ID")
    )
    _, current_data = lesson_snapshot(database, lesson_id)
    if current_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, current_data)

    changes = data.model_dump(exclude_unset=True)
    destination_class_id = changes["class_id"]
    destination_subject_id = changes.get(
        "subject_id",
        current_data.get("subject_id", ""),
    )
    validate_document_id(destination_class_id, "class ID")
    validate_document_id(destination_subject_id, "subject ID")
    if not teacher_can_manage_lesson(
        database,
        teacher_uid,
        destination_class_id,
        destination_subject_id,
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized for this class and subject.",
        )

    changes["updated_at"] = SERVER_TIMESTAMP
    lesson_ref.update(changes)
    updated_data = lesson_ref.get().to_dict() or {}
    return lesson_response(lesson_id, updated_data)


def set_publication_status(
    database,
    lesson_id: str,
    teacher_uid: str,
    published: bool,
) -> LessonResponse:
    lesson_id = validate_document_id(lesson_id, "lesson ID")
    lesson_ref = database.collection(LESSON_COLLECTION).document(lesson_id)
    _, current_data = lesson_snapshot(database, lesson_id)
    if current_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, current_data)
    if published:
        validate_publishable_lesson(current_data)

    lesson_ref.update(
        {
            "status": "published" if published else "draft",
            "published_at": SERVER_TIMESTAMP if published else None,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    return lesson_response(lesson_id, lesson_ref.get().to_dict() or {})


def delete_lesson(
    database,
    lesson_id: str,
    teacher_uid: str,
) -> None:
    lesson_id = validate_document_id(lesson_id, "lesson ID")
    lesson_ref = database.collection(LESSON_COLLECTION).document(lesson_id)
    _, current_data = lesson_snapshot(database, lesson_id)
    if current_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, current_data)
    lesson_ref.delete()
