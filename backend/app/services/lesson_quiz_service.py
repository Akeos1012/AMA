import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from pydantic import ValidationError

from app.ai.client import LLMProviderError
from app.extraction.lesson_text import (
    InsufficientLessonContentError,
    extract_lesson_text,
)
from app.models.generation import (
    GenerateQuizRequestBody,
    GeneratedQuiz,
    QuizDraft,
    QuizDraftUpdateRequest,
    PublishQuizRequest,
    QuizGenerationRequest,
)
from app.services.lesson_service import aware_datetime, lesson_snapshot
from app.services.lesson_access_service import (
    require_active_class,
    require_active_subject,
    require_teacher_lesson_access,
    teacher_can_manage_lesson,
)
from app.services.quiz_generation_orchestrator import QuizGenerationOrchestrator
from app.services.quiz_generation_service import QuizGenerationServiceError
from app.validation.lesson_validation import validate_document_id
from app.validation.quiz_validator import QuizValidator

# Keep the existing diagnostics logger name so current API tests and operators
# continue to observe the same validation warnings after extraction.
logger = logging.getLogger("app.api.lessons")

QUIZ_COLLECTION = "quizzes"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _publication_status(data: dict[str, Any], current_time: datetime) -> str:
    opening_at = data.get("opening_at")
    closing_at = data.get("closing_at")
    if (
        not isinstance(opening_at, datetime)
        or opening_at.tzinfo is None
        or opening_at.utcoffset() is None
        or not isinstance(closing_at, datetime)
        or closing_at.tzinfo is None
        or closing_at.utcoffset() is None
    ):
        return "closed"
    if opening_at >= closing_at:
        return "closed"
    if current_time < opening_at:
        return "scheduled"
    if current_time >= closing_at:
        return "closed"
    return "open"


def quiz_draft_response(quiz_id: str, data: dict[str, Any]) -> QuizDraft:
    response_data = dict(data)
    response_data.update(
        {
            "id": quiz_id,
            "created_at": aware_datetime(data.get("created_at"), "created_at"),
            "updated_at": aware_datetime(data.get("updated_at"), "updated_at"),
            "published_at": (
                aware_datetime(data["published_at"], "published_at")
                if data.get("published_at") is not None
                else None
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
        }
    )
    try:
        return QuizDraft.model_validate(response_data)
    except (TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored quiz draft data is invalid.",
        ) from exc


def generate_quiz_for_lesson(
    database: Any,
    lesson_id: str,
    lesson_data: dict[str, Any],
    teacher_uid: str,
    body: GenerateQuizRequestBody,
    orchestrator: QuizGenerationOrchestrator,
) -> QuizDraft:
    try:
        extracted_lesson = extract_lesson_text(lesson_data)
    except InsufficientLessonContentError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc

    gen_request = QuizGenerationRequest(
        lesson_id=lesson_id,
        question_counts=body.question_counts,
        instructions=body.instructions,
    )

    if body.max_attempts is not None:
        orchestrator.max_attempts = body.max_attempts

    try:
        result = orchestrator.orchestrate_generation(
            lesson=extracted_lesson,
            request=gen_request,
        )
    except LLMProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI generation service is currently unavailable. Please try again later.",
        ) from None
    except QuizGenerationServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from None

    if (
        not result.success
        or not result.quiz
        or not result.validation_report
        or not result.validation_report.is_valid
        or result.validation_report.status != "passed"
    ):
        if result.validation_report is not None:
            logger.warning(
                "Quiz generation failed validation: lesson_id=%s attempts=%s "
                "status=%s grounding_passed=%s correctness_passed=%s",
                lesson_id,
                result.attempts,
                result.validation_report.status,
                result.validation_report.grounding_passed,
                result.validation_report.correctness_passed,
            )
        else:
            logger.warning(
                "Quiz generation failed without a validation report: lesson_id=%s "
                "attempts=%s error=%s",
                lesson_id,
                result.attempts,
                result.error_message,
            )
        failure_detail = result.error_message or "Quiz generation failed validation requirements."
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=failure_detail,
        )

    quiz_ref = database.collection(QUIZ_COLLECTION).document()
    draft_record = {
        "lesson_id": lesson_id,
        "class_id": lesson_data.get("class_id"),
        "subject_id": lesson_data.get("subject_id"),
        "teacher_id": teacher_uid,
        "title": result.quiz.title,
        "description": None,
        "opening_at": None,
        "closing_at": None,
        "status": "draft",
        "questions": [question.model_dump() for question in result.quiz.questions],
        "validation_report": result.validation_report.model_dump(),
        "model_id": result.model or "qwen2.5:3b",
        "created_at": SERVER_TIMESTAMP,
        "updated_at": SERVER_TIMESTAMP,
        "published_at": None,
    }

    try:
        quiz_ref.set(draft_record)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save quiz draft.",
        ) from exc

    saved_doc = quiz_ref.get()
    if not saved_doc.exists:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve saved quiz draft.",
        )

    return quiz_draft_response(quiz_ref.id, saved_doc.to_dict() or {})


def list_quiz_drafts(
    database: Any,
    teacher_uid: str,
) -> list[QuizDraft]:
    quizzes = (
        database.collection(QUIZ_COLLECTION)
        .where("teacher_id", "==", teacher_uid)
        .where("status", "==", "draft")
        .stream()
    )
    return [
        quiz_draft_response(quiz.id, quiz.to_dict() or {})
        for quiz in quizzes
    ]


def list_published_quizzes(
    database: Any,
    teacher_uid: str,
) -> list[QuizDraft]:
    quizzes = (
        database.collection(QUIZ_COLLECTION)
        .where("teacher_id", "==", teacher_uid)
        .where("status", "==", "published")
        .stream()
    )
    current_time = utc_now()
    return [
        quiz_draft_response(
            quiz.id,
            (quiz.to_dict() or {})
            | {
                "availability_status": _publication_status(
                    quiz.to_dict() or {},
                    current_time,
                )
            },
        )
        for quiz in quizzes
    ]


def update_quiz_draft(
    database: Any,
    quiz_id: str,
    teacher_uid: str,
    update: QuizDraftUpdateRequest,
) -> QuizDraft:
    """Update an owned draft and revalidate its complete question set."""
    quiz_id = validate_document_id(quiz_id, "quiz ID")
    quiz_ref = database.collection(QUIZ_COLLECTION).document(quiz_id)
    snapshot = quiz_ref.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Quiz draft not found.")

    current = snapshot.to_dict() or {}
    if current.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Quiz draft not found.")
    if current.get("status") != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only quiz drafts can be modified.",
        )

    if "title" in update.model_fields_set and update.title is None:
        raise HTTPException(status_code=422, detail="Quiz title cannot be empty.")

    merged = dict(current)
    for field in ("title", "description", "opening_at", "closing_at", "questions"):
        if field in update.model_fields_set:
            merged[field] = getattr(update, field)

    opening_at = merged.get("opening_at")
    closing_at = merged.get("closing_at")
    if opening_at is not None and closing_at is not None:
        if opening_at >= closing_at:
            raise HTTPException(
                status_code=422,
                detail="Opening time must be earlier than closing time.",
            )

    try:
        _, lesson_data = lesson_snapshot(database, current["lesson_id"])
        if (
            lesson_data.get("teacher_id") != teacher_uid
            or lesson_data.get("class_id") != current.get("class_id")
            or lesson_data.get("subject_id") != current.get("subject_id")
        ):
            raise HTTPException(status_code=404, detail="Quiz draft not found.")
        require_teacher_lesson_access(database, teacher_uid, lesson_data)
        extracted_lesson = extract_lesson_text(lesson_data)
        quiz = GeneratedQuiz(
            title=merged["title"],
            topic=lesson_data.get("topic", "Quiz"),
            lesson_id=current["lesson_id"],
            questions=merged["questions"],
        )
    except (InsufficientLessonContentError, KeyError, TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Quiz draft contains invalid question or lesson data.",
        ) from exc

    validation_report = QuizValidator().validate_quiz(quiz, extracted_lesson)
    if not validation_report.is_valid or validation_report.status != "passed":
        raise HTTPException(
            status_code=422,
            detail="Quiz draft failed grounding or correctness validation.",
        )

    changes = {
        "title": quiz.title,
        "description": merged.get("description"),
        "opening_at": opening_at,
        "closing_at": closing_at,
        "questions": [question.model_dump() for question in quiz.questions],
        "validation_report": validation_report.model_dump(),
        "updated_at": SERVER_TIMESTAMP,
    }
    try:
        quiz_ref.update(changes)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save quiz draft.",
        ) from exc

    saved_doc = quiz_ref.get()
    if not saved_doc.exists:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve saved quiz draft.",
        )
    return quiz_draft_response(quiz_id, saved_doc.to_dict() or {})


def publish_quiz(
    database: Any,
    quiz_id: str,
    teacher_uid: str,
    request: PublishQuizRequest,
) -> QuizDraft:
    """Publish an owned draft to an authorized class with a future schedule."""
    quiz_id = validate_document_id(quiz_id, "quiz ID")
    target_class_id = validate_document_id(request.target_class_id, "class ID")
    quiz_ref = database.collection(QUIZ_COLLECTION).document(quiz_id)
    snapshot = quiz_ref.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Quiz draft not found.")

    current = snapshot.to_dict() or {}
    if current.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Quiz draft not found.")
    if current.get("status") != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only quiz drafts can be published.",
        )

    if request.opening_at <= utc_now():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Opening time must be in the future.",
        )

    try:
        _, lesson_data = lesson_snapshot(database, current["lesson_id"])
        if (
            lesson_data.get("teacher_id") != teacher_uid
            or lesson_data.get("class_id") != current.get("class_id")
            or lesson_data.get("subject_id") != current.get("subject_id")
        ):
            raise HTTPException(status_code=404, detail="Quiz draft not found.")
        require_teacher_lesson_access(database, teacher_uid, lesson_data)
        target_class = require_active_class(database, target_class_id)
        target_subject = require_active_subject(database, current["subject_id"])
        if (
            target_class is None
            or target_subject is None
            or not teacher_can_manage_lesson(
                database,
                teacher_uid,
                target_class_id,
                current["subject_id"],
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to publish to the selected class.",
            )
        if not isinstance(target_class.get("grade_level"), str) or not isinstance(
            target_class.get("section"), str
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The selected class has invalid grade or section data.",
            )
        grade_levels = target_subject.get("grade_levels", [])
        if (
            not isinstance(grade_levels, (list, tuple))
            or target_class.get("grade_level") not in grade_levels
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The subject is not available for the selected class's grade level.",
            )
        extracted_lesson = extract_lesson_text(lesson_data)
        quiz = GeneratedQuiz(
            title=current["title"],
            topic=lesson_data.get("topic", "Quiz"),
            lesson_id=current["lesson_id"],
            questions=current["questions"],
        )
    except (InsufficientLessonContentError, KeyError, TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Quiz draft contains invalid question or lesson data.",
        ) from exc

    validation_report = QuizValidator().validate_quiz(quiz, extracted_lesson)
    if not validation_report.is_valid or validation_report.status != "passed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Quiz draft failed grounding or correctness validation.",
        )

    try:
        quiz_ref.update(
            {
                "status": "published",
                "published_title": request.title,
                "published_description": request.description,
                "target_class_id": target_class_id,
                "published_grade_level": target_class["grade_level"],
                "published_section": target_class["section"],
                "opening_at": request.opening_at,
                "closing_at": request.closing_at,
                "published_by": teacher_uid,
                "published_at": SERVER_TIMESTAMP,
                "updated_at": SERVER_TIMESTAMP,
            }
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to publish quiz.",
        ) from exc

    saved_doc = quiz_ref.get()
    if not saved_doc.exists:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve published quiz.",
        )
    return quiz_draft_response(quiz_id, saved_doc.to_dict() or {})
