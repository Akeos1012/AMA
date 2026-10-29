from collections import Counter
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.ai.client import BaseLLMClient, LLMResponse
from app.ai.prompt_builder import build_quiz_prompt
from app.extraction.lesson_text import ExtractedLessonContent
from app.models.generation import (
    EssayQuestion,
    GeneratedQuestion,
    GeneratedQuiz,
    IdentificationQuestion,
    MultipleChoiceQuestion,
    QuestionType,
    QuizGenerationRequest,
    TrueFalseQuestion,
    build_quiz_response_schema,
)


class QuizGenerationServiceError(Exception):
    """Base error for quiz generation service operations."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class SchemaValidationError(QuizGenerationServiceError):
    """Raised when the LLM output violates expected quiz or question schemas."""

    pass


class QuestionCountMismatchError(QuizGenerationServiceError):
    """Raised when generated question counts or types do not strictly match the request."""

    pass


class QuizGenerationResult(BaseModel):
    """Result returned by the quiz generation service containing validated questions and metadata."""

    model_config = ConfigDict(extra="forbid", strict=True)

    quiz: GeneratedQuiz
    model: str
    duration_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class QuizGenerationService:
    """
    Orchestrates quiz generation using a provider-independent LLM client.
    Does NOT depend on FastAPI, Firestore, or any specific LLM provider.
    Never returns unverified or sample fallback questions.
    """

    def __init__(self, llm_client: BaseLLMClient):
        self.llm_client = llm_client

    def _parse_question(self, raw_q: dict[str, Any], index: int) -> GeneratedQuestion:
        if not isinstance(raw_q, dict):
            raise SchemaValidationError(
                f"Question at index {index} is not a valid JSON object.",
                details={"index": index, "raw": raw_q},
            )

        q_type = raw_q.get("type")
        try:
            if q_type == "multiple_choice":
                return MultipleChoiceQuestion.model_validate(raw_q)
            elif q_type == "true_false":
                return TrueFalseQuestion.model_validate(raw_q)
            elif q_type == "identification":
                return IdentificationQuestion.model_validate(raw_q)
            elif q_type == "essay":
                return EssayQuestion.model_validate(raw_q)
            else:
                raise SchemaValidationError(
                    f"Question at index {index} has unsupported type '{q_type}'.",
                    details={"index": index, "type": q_type},
                )
        except ValidationError as exc:
            raise SchemaValidationError(
                f"Question at index {index} failed schema validation: {exc}",
                details={"index": index, "type": q_type, "errors": exc.errors()},
            ) from exc

    def generate_quiz(
        self,
        lesson: ExtractedLessonContent,
        request: QuizGenerationRequest,
    ) -> QuizGenerationResult:
        """
        Executes prompt construction, calls the LLM provider, validates question schemas,
        and enforces exact question count and type distributions.
        """
        if not lesson or not lesson.full_text or not lesson.full_text.strip():
            raise QuizGenerationServiceError(
                "Cannot generate quiz: lesson content is empty or contains no substantive text.",
                details={"lesson_id": getattr(lesson, "lesson_id", "unknown")},
            )

        if not request or request.total_questions < 1:
            raise QuizGenerationServiceError(
                "Cannot generate quiz: request specifies 0 questions.",
                details={"request": request.model_dump() if request else None},
            )

        # 1. Build prompt
        system_instruction, user_prompt = build_quiz_prompt(lesson, request)

        # 2. Invoke LLM provider (exceptions from provider propagate cleanly)
        llm_response: LLMResponse = self.llm_client.generate_structured(
            prompt=user_prompt,
            system_instruction=system_instruction,
            schema=build_quiz_response_schema(),
        )

        data = llm_response.parsed_json
        if not isinstance(data, dict):
            raise SchemaValidationError(
                "Model response must be a JSON object containing 'questions'.",
                details={"received_type": type(data).__name__},
            )

        raw_questions = data.get("questions")
        if not isinstance(raw_questions, list):
            raise SchemaValidationError(
                "Model output is missing a 'questions' array.",
                details={"response_keys": list(data.keys())},
            )

        # 3. Parse and validate each question schema
        parsed_questions: list[GeneratedQuestion] = [
            self._parse_question(q, idx) for idx, q in enumerate(raw_questions)
        ]

        if not parsed_questions:
            raise SchemaValidationError(
                "Model returned an empty list of questions.",
                details={"expected_total": request.total_questions},
            )

        # 4. Strict enforcement of question counts and type distribution
        actual_counts = Counter(q.type for q in parsed_questions)

        # Check expected counts
        for expected_type, expected_count in request.question_counts.items():
            actual_count = actual_counts.get(expected_type, 0)
            if actual_count != expected_count:
                raise QuestionCountMismatchError(
                    f"Count mismatch for question type '{expected_type}': "
                    f"expected {expected_count}, but model generated {actual_count}.",
                    details={
                        "expected_counts": request.question_counts,
                        "actual_counts": dict(actual_counts),
                    },
                )

        # Check for unrequested types produced by model
        for actual_type, actual_count in actual_counts.items():
            if request.question_counts.get(actual_type, 0) == 0:
                raise QuestionCountMismatchError(
                    f"Model generated unrequested question type '{actual_type}' ({actual_count} item(s)).",
                    details={
                        "expected_counts": request.question_counts,
                        "actual_counts": dict(actual_counts),
                    },
                )

        # Total count check
        if len(parsed_questions) != request.total_questions:
            raise QuestionCountMismatchError(
                f"Total question count mismatch: expected {request.total_questions}, "
                f"but model generated {len(parsed_questions)}.",
                details={
                    "expected_total": request.total_questions,
                    "actual_total": len(parsed_questions),
                },
            )

        quiz = GeneratedQuiz(
            title=str(data.get("title") or lesson.title or "Generated Quiz").strip(),
            topic=str(data.get("topic") or lesson.topic or "Lesson Topic").strip(),
            lesson_id=request.lesson_id,
            questions=parsed_questions,
        )

        return QuizGenerationResult(
            quiz=quiz,
            model=llm_response.model,
            duration_ms=llm_response.duration_ms,
            prompt_tokens=llm_response.prompt_tokens,
            completion_tokens=llm_response.completion_tokens,
        )
