from typing import Annotated, Literal, Union

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)


NonEmptyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, strict=True),
]


class StudentMultipleChoiceQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: int = Field(ge=0)
    type: Literal["multiple_choice"]
    prompt: NonEmptyText
    options: list[NonEmptyText] = Field(min_length=4, max_length=4)


class StudentTrueFalseQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: int = Field(ge=0)
    type: Literal["true_false"]
    prompt: NonEmptyText


class StudentIdentificationQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: int = Field(ge=0)
    type: Literal["identification"]
    prompt: NonEmptyText


class StudentEssayQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: int = Field(ge=0)
    type: Literal["essay"]
    prompt: NonEmptyText


StudentQuizQuestion = Annotated[
    Union[
        StudentMultipleChoiceQuestion,
        StudentTrueFalseQuestion,
        StudentIdentificationQuestion,
        StudentEssayQuestion,
    ],
    Field(discriminator="type"),
]


class StudentQuizResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    lesson_id: NonEmptyText
    subject_id: NonEmptyText
    title: NonEmptyText
    description: str | None = None
    opening_at: AwareDatetime | None = None
    closing_at: AwareDatetime | None = None
    grade_level: str | None = None
    section: str | None = None
    questions: list[StudentQuizQuestion] = Field(min_length=1)


class StudentQuizListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    title: NonEmptyText
    description: str | None = None
    opening_at: AwareDatetime | None = None
    closing_at: AwareDatetime | None = None
    grade_level: str | None = None
    section: str | None = None
    status: Literal["scheduled", "open", "closed", "answered"]


class StudentQuizAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    question_id: int = Field(ge=0)
    answer: str | bool


class StudentQuizSubmissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    answers: list[StudentQuizAnswer] = Field(min_length=1)


class StudentQuizSubmissionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    status: Literal["answered"]
