from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

NonEmptyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, strict=True),
]

QuestionType = Literal["multiple_choice", "true_false", "identification", "essay"]
QuizDraftStatus = Literal["draft", "published"]


class SourceEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    quote: NonEmptyText
    block_index: int | None = Field(default=None, ge=0)
    context: str | None = None


class MultipleChoiceQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["multiple_choice"] = "multiple_choice"
    prompt: NonEmptyText
    options: list[NonEmptyText] = Field(min_length=4, max_length=4)
    correct_answer: NonEmptyText
    explanation: NonEmptyText
    evidence: SourceEvidence

    @model_validator(mode="after")
    def validate_options_and_answer(self) -> "MultipleChoiceQuestion":
        cleaned_options = [opt.strip() for opt in self.options]
        # Check for exactly 4 unique options (case-insensitive check)
        unique_options = {opt.lower() for opt in cleaned_options}
        if len(unique_options) != 4:
            raise ValueError("Multiple-choice questions must have exactly 4 distinct options.")

        # Check correct answer matches one of the options exactly
        if self.correct_answer.strip() not in cleaned_options:
            raise ValueError(
                f"Correct answer '{self.correct_answer}' must be one of the provided options: {self.options}."
            )
        return self


class TrueFalseQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["true_false"] = "true_false"
    prompt: NonEmptyText
    correct_answer: bool
    explanation: NonEmptyText
    evidence: SourceEvidence


class IdentificationQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["identification"] = "identification"
    prompt: NonEmptyText
    correct_answer: NonEmptyText
    accepted_alternatives: list[NonEmptyText] = Field(default_factory=list)
    explanation: NonEmptyText
    evidence: SourceEvidence

    @model_validator(mode="after")
    def validate_identification(self) -> "IdentificationQuestion":
        # Ensure duplicates are not in accepted_alternatives
        alts = [alt.strip().lower() for alt in self.accepted_alternatives]
        if self.correct_answer.strip().lower() in alts:
            raise ValueError("Correct answer should not be duplicated in accepted_alternatives.")
        if len(alts) != len(set(alts)):
            raise ValueError("accepted_alternatives must not contain duplicates.")
        return self


class EssayQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["essay"] = "essay"
    prompt: NonEmptyText
    rubric: list[NonEmptyText] = Field(min_length=1)
    sample_solution: NonEmptyText | None = None
    explanation: NonEmptyText
    evidence: SourceEvidence


GeneratedQuestion = Annotated[
    Union[
        MultipleChoiceQuestion,
        TrueFalseQuestion,
        IdentificationQuestion,
        EssayQuestion,
    ],
    Field(discriminator="type"),
]


class QuizGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    lesson_id: NonEmptyText
    question_counts: dict[QuestionType, int]
    instructions: str | None = None

    @field_validator("question_counts")
    @classmethod
    def validate_counts(cls, counts: dict[QuestionType, int]) -> dict[QuestionType, int]:
        if not counts:
            raise ValueError("At least one question type count must be requested.")
        total = 0
        for q_type, count in counts.items():
            if count < 0:
                raise ValueError(f"Count for '{q_type}' cannot be negative.")
            total += count
        if total < 1:
            raise ValueError("At least one question must be requested.")
        if total > 50:
            raise ValueError("Cannot request more than 50 questions per generation batch.")
        return counts

    @property
    def total_questions(self) -> int:
        return sum(self.question_counts.values())


class GenerateQuizRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    question_counts: dict[QuestionType, int]
    instructions: str | None = None
    max_attempts: int | None = Field(default=2, ge=1, le=5)

    @field_validator("question_counts")
    @classmethod
    def validate_counts(cls, counts: dict[QuestionType, int]) -> dict[QuestionType, int]:
        if not counts:
            raise ValueError("At least one question type count must be requested.")
        total = 0
        for q_type, count in counts.items():
            if count < 0:
                raise ValueError(f"Count for '{q_type}' cannot be negative.")
            total += count
        if total < 1:
            raise ValueError("At least one question must be requested.")
        if total > 50:
            raise ValueError("Cannot request more than 50 questions per generation batch.")
        return counts

    @property
    def total_questions(self) -> int:
        return sum(self.question_counts.values())


ValidationStatus = Literal["passed", "failed", "needs_review"]


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    severity: Literal["error", "warning"]
    stage: Literal["schema", "grounding", "correctness"]
    message: NonEmptyText
    question_index: int | None = Field(default=None, ge=0)


class QuestionValidationReport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    question_index: int = Field(ge=0)
    status: ValidationStatus = "passed"
    schema_valid: bool = True
    quote_valid: bool = True
    block_reference_valid: bool = True
    evidence_supported: ValidationStatus = "passed"
    answer_correct: ValidationStatus = "passed"
    grounding_passed: bool
    correctness_passed: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


class QuizValidationReport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: ValidationStatus = "passed"
    is_valid: bool
    grounding_passed: bool
    correctness_passed: bool
    question_reports: list[QuestionValidationReport] = Field(default_factory=list)
    general_issues: list[ValidationIssue] = Field(default_factory=list)


class GeneratedQuiz(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: NonEmptyText
    topic: NonEmptyText
    lesson_id: NonEmptyText
    questions: list[GeneratedQuestion] = Field(min_length=1)


class QuizDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    lesson_id: NonEmptyText
    class_id: NonEmptyText
    subject_id: NonEmptyText
    teacher_id: NonEmptyText
    title: NonEmptyText
    status: QuizDraftStatus = "draft"
    questions: list[GeneratedQuestion] = Field(min_length=1)
    validation_report: QuizValidationReport
    model_id: NonEmptyText
    created_at: AwareDatetime
    updated_at: AwareDatetime
    published_at: AwareDatetime | None = None


class GenerationErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    error_code: NonEmptyText
    message: NonEmptyText
    stage: Literal[
        "extraction",
        "prompt",
        "provider",
        "parsing",
        "grounding",
        "correctness",
        "persistence",
    ]
    details: dict[str, Any] = Field(default_factory=dict)
    retryable: bool = False


class OrchestrationResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    success: bool
    quiz: GeneratedQuiz | None = None
    validation_report: QuizValidationReport | None = None
    attempts: int = Field(ge=1)
    model: str | None = None
    duration_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    error_message: str | None = None


# ---------------------------------------------------------------------------
# Ollama structured-output JSON schema
# ---------------------------------------------------------------------------

_EVIDENCE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "quote": {"type": "string"},
        "block_index": {"type": "integer"},
        "context": {"type": "string"},
    },
    "required": ["quote"],
}

_QUESTION_TYPE_ENUM = ["multiple_choice", "true_false", "identification", "essay"]

_MC_QUESTION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["multiple_choice"]},
        "prompt": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "correct_answer": {"type": "string"},
        "explanation": {"type": "string"},
        "evidence": _EVIDENCE_SCHEMA,
    },
    "required": ["type", "prompt", "options", "correct_answer", "explanation", "evidence"],
}

_TF_QUESTION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["true_false"]},
        "prompt": {"type": "string"},
        "correct_answer": {"type": "boolean"},
        "explanation": {"type": "string"},
        "evidence": _EVIDENCE_SCHEMA,
    },
    "required": ["type", "prompt", "correct_answer", "explanation", "evidence"],
}

_IDENT_QUESTION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["identification"]},
        "prompt": {"type": "string"},
        "correct_answer": {"type": "string"},
        "accepted_alternatives": {"type": "array", "items": {"type": "string"}},
        "explanation": {"type": "string"},
        "evidence": _EVIDENCE_SCHEMA,
    },
    "required": ["type", "prompt", "correct_answer", "explanation", "evidence"],
}

_ESSAY_QUESTION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["essay"]},
        "prompt": {"type": "string"},
        "rubric": {"type": "array", "items": {"type": "string"}},
        "sample_solution": {"type": "string"},
        "explanation": {"type": "string"},
        "evidence": _EVIDENCE_SCHEMA,
    },
    "required": ["type", "prompt", "rubric", "explanation", "evidence"],
}


def build_quiz_response_schema() -> dict:
    """
    Returns a JSON schema dict suitable for Ollama's ``format`` parameter.

    The schema describes the quiz response envelope (``title``, ``topic``,
    ``questions``) and uses ``anyOf`` to express the discriminated union of
    question types.  Every question object **requires** an explicit ``type``
    field restricted to the four valid enum values.

    Ollama does not support JSON Schema ``$ref``/``$defs``, so all types are
    inlined.  Optional Pydantic fields (``accepted_alternatives``,
    ``sample_solution``, ``context``) are intentionally left non-required so
    valid existing outputs are not rejected.
    """
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "topic": {"type": "string"},
            "questions": {
                "type": "array",
                "items": {
                    "anyOf": [
                        _MC_QUESTION_SCHEMA,
                        _TF_QUESTION_SCHEMA,
                        _IDENT_QUESTION_SCHEMA,
                        _ESSAY_QUESTION_SCHEMA,
                    ],
                },
            },
        },
        "required": ["title", "topic", "questions"],
    }

