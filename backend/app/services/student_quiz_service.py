from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError

from app.models.student_quiz import StudentQuizResponse
from app.services.lesson_access_service import (
    has_active_assignment,
    require_active_class,
    require_active_subject,
)
from app.services.lesson_service import aware_datetime
from app.validation.lesson_validation import validate_document_id


QUIZ_COLLECTION = "quizzes"
MEMBERSHIP_COLLECTION = "class_memberships"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _active_student_class_ids(database: Any, student_uid: str) -> set[str]:
    memberships = (
        database.collection(MEMBERSHIP_COLLECTION)
        .where("student_uid", "==", student_uid)
        .where("status", "==", "active")
        .stream()
    )
    class_ids: set[str] = set()
    for membership in memberships:
        data = membership.to_dict() or {}
        class_id = data.get("class_id")
        if (
            isinstance(class_id, str)
            and require_active_class(database, class_id) is not None
        ):
            class_ids.add(class_id)
    return class_ids


def _schedule_is_available(data: dict[str, Any], current_time: datetime) -> bool:
    opening_at = data.get("opening_at")
    closing_at = data.get("closing_at")
    for value in (opening_at, closing_at):
        if value is not None and (
            not isinstance(value, datetime)
            or value.tzinfo is None
            or value.utcoffset() is None
        ):
            return False

    if opening_at is not None and current_time < opening_at:
        return False
    if closing_at is not None and current_time >= closing_at:
        return False
    return True


def _student_can_access_quiz(
    database: Any,
    student_uid: str,
    quiz_data: dict[str, Any],
    active_class_ids: set[str] | None = None,
    current_time: datetime | None = None,
) -> bool:
    if quiz_data.get("status") != "published":
        return False

    class_id = quiz_data.get("class_id")
    subject_id = quiz_data.get("subject_id")
    if not isinstance(class_id, str) or not isinstance(subject_id, str):
        return False

    available_classes = (
        active_class_ids
        if active_class_ids is not None
        else _active_student_class_ids(database, student_uid)
    )
    if class_id not in available_classes:
        return False
    if require_active_subject(database, subject_id) is None:
        return False
    if not has_active_assignment(database, class_id, subject_id):
        return False
    return _schedule_is_available(quiz_data, current_time or utc_now())


def _student_question(question: dict[str, Any], question_index: int) -> dict[str, Any]:
    question_type = question.get("type")
    safe_question = {
        "id": question_index,
        "type": question_type,
        "prompt": question.get("prompt"),
    }
    if question_type == "multiple_choice":
        safe_question["options"] = question.get("options")
    return safe_question


def student_quiz_response(quiz_id: str, data: dict[str, Any]) -> StudentQuizResponse:
    response_data = {
        "id": quiz_id,
        "lesson_id": data.get("lesson_id"),
        "subject_id": data.get("subject_id"),
        "title": data.get("title"),
        "description": data.get("description"),
        "opening_at": (
            aware_datetime(data["opening_at"], "opening_at")
            if data.get("opening_at") is not None
            else None
        ),
        "closing_at": (
            aware_datetime(data["closing_at"], "closing_at")
            if data.get("closing_at") is not None
            else None
        ),
        "questions": [
            _student_question(question, index)
            for index, question in enumerate(data.get("questions", []))
            if isinstance(question, dict)
        ],
    }
    try:
        return StudentQuizResponse.model_validate(response_data)
    except (TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored quiz data is invalid.",
        ) from exc


def list_student_quizzes(
    database: Any,
    student_uid: str,
) -> list[StudentQuizResponse]:
    active_class_ids = _active_student_class_ids(database, student_uid)
    current_time = utc_now()
    quizzes = (
        database.collection(QUIZ_COLLECTION)
        .where("status", "==", "published")
        .stream()
    )
    responses = []
    for quiz in quizzes:
        data = quiz.to_dict() or {}
        if _student_can_access_quiz(
            database,
            student_uid,
            data,
            active_class_ids=active_class_ids,
            current_time=current_time,
        ):
            responses.append(student_quiz_response(quiz.id, data))
    return sorted(responses, key=lambda item: item.id)


def get_student_quiz(
    database: Any,
    quiz_id: str,
    student_uid: str,
) -> StudentQuizResponse:
    quiz_id = validate_document_id(quiz_id, "quiz ID")
    snapshot = database.collection(QUIZ_COLLECTION).document(quiz_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    data = snapshot.to_dict() or {}
    if not _student_can_access_quiz(database, student_uid, data):
        raise HTTPException(status_code=404, detail="Quiz not found.")
    return student_quiz_response(quiz_id, data)
