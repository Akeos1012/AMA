import logging
import re

from typing import Any

from app.ai.client import LLMProviderError
from app.extraction.lesson_text import (
    ExtractedLessonContent,
    InsufficientLessonContentError,
    extract_lesson_text,
)
from app.models.generation import (
    GeneratedQuiz,
    OrchestrationResult,
    QuizGenerationRequest,
    QuizValidationReport,
)
from app.services.quiz_generation_service import (
    QuestionCountMismatchError,
    QuizGenerationResult,
    QuizGenerationService,
    QuizGenerationServiceError,
    SchemaValidationError,
)
logger = logging.getLogger(__name__)


def _sanitize_diagnostic_text(value: Any) -> str:
    text = str(value or "")
    # Validation messages may embed answer keys or quote text in single quotes.
    return re.sub(r"'[^']*'", "'<redacted>'", text)


from app.validation.quiz_validator import QuizValidator


class QuizOrchestrationError(Exception):
    """Base exception for orchestration failures."""

    def __init__(
        self,
        message: str,
        details: dict[str, Any] | None = None,
        report: QuizValidationReport | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.details = details or {}
        self.report = report


class MaxAttemptsExceededError(QuizOrchestrationError):
    """Raised when all permitted generation or validation attempts fail."""

    pass


class QuizGenerationOrchestrator:
    """
    Coordinates lesson extraction, quiz generation, validation, and bounded retry logic.
    Applies corrective feedback from validation failures during retries.
    Never returns an invalid quiz or unverified fallback questions.
    """

    def __init__(
        self,
        generation_service: QuizGenerationService,
        validator: QuizValidator | None = None,
        max_attempts: int = 2,
    ):
        if max_attempts < 1:
            raise ValueError(f"max_attempts must be at least 1, got {max_attempts}.")
        self.generation_service = generation_service
        self.validator = validator or QuizValidator()
        self.max_attempts = max_attempts

    def _extract_lesson(
        self,
        lesson_input: ExtractedLessonContent | dict[str, Any],
    ) -> ExtractedLessonContent:
        if isinstance(lesson_input, ExtractedLessonContent):
            return lesson_input
        elif isinstance(lesson_input, dict):
            return extract_lesson_text(lesson_input)
        else:
            raise ValueError(f"Unsupported lesson input type: {type(lesson_input).__name__}")

    def orchestrate_generation(
        self,
        lesson: ExtractedLessonContent | dict[str, Any],
        request: QuizGenerationRequest,
        raise_on_failure: bool = False,
    ) -> OrchestrationResult:
        """
        Executes bounded generation and validation attempts.
        Returns an OrchestrationResult or raises MaxAttemptsExceededError if raise_on_failure=True.
        """
        # 1. Lesson content extraction and validation (non-retryable permanent error if empty)
        extracted_lesson = self._extract_lesson(lesson)

        current_instructions = request.instructions or ""
        last_report: QuizValidationReport | None = None
        last_error_message: str | None = None
        accumulated_duration_ms: float = 0.0
        accumulated_prompt_tokens: int = 0
        accumulated_completion_tokens: int = 0
        model_used: str | None = None

        for attempt in range(1, self.max_attempts + 1):
            # 2. Build attempt-specific request
            if attempt == 1:
                attempt_request = request
            else:
                # Compile actionable failure reasons from previous attempt
                feedback_items: list[str] = []
                if last_report:
                    for q_rep in last_report.question_reports:
                        if q_rep.status != "passed":
                            for issue in q_rep.issues:
                                feedback_items.append(
                                    f"Question {q_rep.question_index + 1}: {issue.message}"
                                )
                    for issue in last_report.general_issues:
                        feedback_items.append(f"General: {issue.message}")
                elif last_error_message:
                    feedback_items.append(f"Previous generation error: {last_error_message}")

                # Append corrective directive to prompt context without altering question counts/types
                correction_text = "\n".join(f"- {item}" for item in feedback_items[:8])
                corrective_instructions = (
                    f"{current_instructions}\n\n"
                    f"CORRECTIVE DIRECTIVE FOR RETRY ATTEMPT {attempt}:\n"
                    f"The previous attempt failed validation with the following issues. "
                    f"Correct every issue below using ONLY facts from the provided lesson text:\n"
                    f"{correction_text}"
                ).strip()

                attempt_request = request.model_copy(
                    update={"instructions": corrective_instructions}
                )

            # 3. Generate quiz
            try:
                gen_result: QuizGenerationResult = self.generation_service.generate_quiz(
                    extracted_lesson, attempt_request
                )
            except LLMProviderError as exc:
                if not exc.retryable:
                    # Permanent provider error (e.g. model not found, client 400); do not retry
                    raise
                last_error_message = f"Transient provider failure: {exc.message}"
                if attempt < self.max_attempts:
                    continue
                error_msg = f"Provider failed after {self.max_attempts} attempt(s): {exc.message}"
                if raise_on_failure:
                    raise MaxAttemptsExceededError(error_msg, details={"last_error": str(exc)}) from exc
                return OrchestrationResult(
                    success=False,
                    quiz=None,
                    validation_report=None,
                    attempts=attempt,
                    model=model_used,
                    error_message=error_msg,
                )
            except (SchemaValidationError, QuestionCountMismatchError) as exc:
                # Model output format issue; retryable within limit
                last_error_message = exc.message
                if attempt < self.max_attempts:
                    continue
                error_msg = f"Generation format error after {self.max_attempts} attempt(s): {exc.message}"
                if raise_on_failure:
                    raise MaxAttemptsExceededError(error_msg, details={"last_error": str(exc)}) from exc
                return OrchestrationResult(
                    success=False,
                    quiz=None,
                    validation_report=None,
                    attempts=attempt,
                    model=model_used,
                    error_message=error_msg,
                )

            # Track metrics
            if gen_result.duration_ms:
                accumulated_duration_ms += gen_result.duration_ms
            if gen_result.prompt_tokens:
                accumulated_prompt_tokens += gen_result.prompt_tokens
            if gen_result.completion_tokens:
                accumulated_completion_tokens += gen_result.completion_tokens
            model_used = gen_result.model

            # 4. Validate generated quiz
            validation_report = self.validator.validate_quiz(
                gen_result.quiz, extracted_lesson
            )
            last_report = validation_report
            # Server-side diagnostics only (no question text, answers, model responses,
            # credentials, or lesson contents).
            issue_summaries = []
            for q_report in validation_report.question_reports:
                for issue in q_report.issues:
                    q_idx = issue.question_index if issue.question_index is not None else q_report.question_index
                    issue_summaries.append(
                        "question_index=%s stage=%s severity=%s detail=%s"
                        % (q_idx, issue.stage, issue.severity, _sanitize_diagnostic_text(issue.message))
                    )
            logger.warning(
                "Quiz validation attempt: lesson_id=%s attempt=%d/%d status=%s "
                "grounding_passed=%s correctness_passed=%s issues=[%s]",
                extracted_lesson.lesson_id,
                attempt,
                self.max_attempts,
                validation_report.status,
                validation_report.grounding_passed,
                validation_report.correctness_passed,
                "; ".join(issue_summaries),
            )

            if validation_report.is_valid and validation_report.status == "passed":
                # Validated successfully!
                return OrchestrationResult(
                    success=True,
                    quiz=gen_result.quiz,
                    validation_report=validation_report,
                    attempts=attempt,
                    model=model_used,
                    duration_ms=accumulated_duration_ms or None,
                    prompt_tokens=accumulated_prompt_tokens or None,
                    completion_tokens=accumulated_completion_tokens or None,
                )

            # Validation failed; loop continues if attempt < max_attempts

        # 5. All attempts exhausted without passing validation
        failure_message = (
            f"Generated quiz failed validation after {self.max_attempts} attempt(s)."
        )
        if raise_on_failure:
            raise MaxAttemptsExceededError(
                failure_message,
                report=last_report,
                details={"attempts": self.max_attempts},
            )

        return OrchestrationResult(
            success=False,
            quiz=None,  # NEVER return unverified quiz as successful
            validation_report=last_report,
            attempts=self.max_attempts,
            model=model_used,
            duration_ms=accumulated_duration_ms or None,
            prompt_tokens=accumulated_prompt_tokens or None,
            completion_tokens=accumulated_completion_tokens or None,
            error_message=failure_message,
        )
