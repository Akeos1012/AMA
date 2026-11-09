from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError
from google.api_core.exceptions import AlreadyExists
from google.cloud.firestore_v1 import SERVER_TIMESTAMP

from app.models.student_quiz import (
    StudentQuizListResponse,
    StudentQuizResponse,
    StudentQuizSubmissionRequest,
    StudentQuizSubmissionResponse,
)
from app.services.lesson_access_service import (
    has_active_assignment,
    require_active_class,
    require_active_subject,
)
from app.services.lesson_service import aware_datetime
from app.validation.lesson_validation import validate_document_id


QUIZ_COLLECTION = "quizzes"
MEMBERSHIP_COLLECTION = "class_memberships"
ATTEMPT_COLLECTION = "quiz_attempts"


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


def _availability_status(
    data: dict[str, Any],
    current_time: datetime,
    answered: bool,
) -> str:
    if answered:
        return "answered"
    opening_at = data.get("opening_at")
    closing_at = data.get("closing_at")
    for value in (opening_at, closing_at):
        if value is not None and (
            not isinstance(value, datetime)
            or value.tzinfo is None
            or value.utcoffset() is None
        ):
            return "closed"
    if opening_at is not None and closing_at is not None and opening_at >= closing_at:
        return "closed"
    if opening_at is not None and current_time < opening_at:
        return "scheduled"
    if closing_at is not None and current_time >= closing_at:
        return "closed"
    return "open"


def _attempt_reference(database: Any, quiz_id: str, student_uid: str):
    attempt_id = sha256(f"{quiz_id}:{student_uid}".encode("utf-8")).hexdigest()
    return database.collection(ATTEMPT_COLLECTION).document(attempt_id)


def _student_can_access_quiz(
    database: Any,
    student_uid: str,
    quiz_data: dict[str, Any],
    active_class_ids: set[str] | None = None,
) -> bool:
    if quiz_data.get("status") != "published":
        return False

    class_id = quiz_data.get("target_class_id") or quiz_data.get("class_id")
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
    return True


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
        "title": data.get("published_title") or data.get("title"),
        "description": data.get("published_description", data.get("description")),
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
        "grade_level": data.get("published_grade_level"),
        "section": data.get("published_section"),
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
) -> list[StudentQuizListResponse]:
    active_class_ids = _active_student_class_ids(database, student_uid)
    current_time = utc_now()
    quizzes = (
        database.collection(QUIZ_COLLECTION)
        .where("status", "==", "published")
        .stream()
    )
    responses: list[StudentQuizListResponse] = []
    for quiz in quizzes:
        data = quiz.to_dict() or {}
        if _student_can_access_quiz(
            database,
            student_uid,
            data,
            active_class_ids=active_class_ids,
        ):
            attempt = _attempt_reference(database, quiz.id, student_uid).get()
            status_value = _availability_status(
                data,
                current_time,
                answered=attempt.exists,
            )
            response_data = {
                "id": quiz.id,
                "title": data.get("published_title") or data.get("title"),
                "description": data.get(
                    "published_description",
                    data.get("description"),
                ),
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
                "grade_level": data.get("published_grade_level"),
                "section": data.get("published_section"),
                "status": status_value,
            }
            try:
                responses.append(StudentQuizListResponse.model_validate(response_data))
            except (TypeError, ValidationError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Stored quiz data is invalid.",
                ) from exc
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
    current_time = utc_now()
    if (
        not _student_can_access_quiz(database, student_uid, data)
        or _availability_status(data, current_time, answered=False) != "open"
        or _attempt_reference(database, quiz_id, student_uid).get().exists
    ):
        raise HTTPException(status_code=404, detail="Quiz not found.")
    return student_quiz_response(quiz_id, data)


def submit_student_quiz(
    database: Any,
    quiz_id: str,
    student_uid: str,
    submission: StudentQuizSubmissionRequest,
) -> StudentQuizSubmissionResponse:
    quiz_id = validate_document_id(quiz_id, "quiz ID")
    snapshot = database.collection(QUIZ_COLLECTION).document(quiz_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Quiz not found.")
    data = snapshot.to_dict() or {}
    if (
        not _student_can_access_quiz(database, student_uid, data)
        or _availability_status(data, utc_now(), answered=False) != "open"
    ):
        raise HTTPException(status_code=404, detail="Quiz not found.")

    questions = data.get("questions")
    if not isinstance(questions, list) or len(submission.answers) != len(questions):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Submit exactly one answer for every quiz question.",
        )

    answers_by_id = {answer.question_id: answer.answer for answer in submission.answers}
    if len(answers_by_id) != len(submission.answers) or set(answers_by_id) != set(
        range(len(questions))
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Each quiz question must have exactly one answer.",
        )

    for question_index, question in enumerate(questions):
        if not isinstance(question, dict):
            raise HTTPException(status_code=500, detail="Stored quiz data is invalid.")
        answer = answers_by_id[question_index]
        question_type = question.get("type")
        if question_type == "multiple_choice":
            valid = isinstance(answer, str) and answer in question.get("options", [])
        elif question_type == "true_false":
            valid = type(answer) is bool
        elif question_type in {"identification", "essay"}:
            valid = isinstance(answer, str) and bool(answer.strip())
        else:
            valid = False
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Answer for question {question_index + 1} is invalid.",
            )

    attempt_ref = _attempt_reference(database, quiz_id, student_uid)
    attempt = {
        "quiz_id": quiz_id,
        "student_uid": student_uid,
        "answers": [
            {"question_id": index, "answer": answers_by_id[index]}
            for index in range(len(questions))
        ],
        "submitted_at": SERVER_TIMESTAMP,
    }
    try:
        attempt_ref.create(attempt)
    except AlreadyExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz has already been submitted.",
        ) from None
    return StudentQuizSubmissionResponse(id=quiz_id, status="answered")
