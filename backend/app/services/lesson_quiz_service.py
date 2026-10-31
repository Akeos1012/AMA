import logging
from typing import Any

from fastapi import HTTPException, status
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from pydantic import ValidationError

from app.ai.client import LLMProviderError
from app.extraction.lesson_text import InsufficientLessonContentError, extract_lesson_text
from app.models.generation import GenerateQuizRequestBody, QuizDraft, QuizGenerationRequest
from app.services.lesson_service import aware_datetime
from app.services.quiz_generation_orchestrator import QuizGenerationOrchestrator
from app.services.quiz_generation_service import QuizGenerationServiceError

# Keep the existing diagnostics logger name so current API tests and operators
# continue to observe the same validation warnings after extraction.
logger = logging.getLogger("app.api.lessons")

QUIZ_COLLECTION = "quizzes"


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
