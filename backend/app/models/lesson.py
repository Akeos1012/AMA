from typing import Annotated, Literal, Union

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints


NonEmptyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, strict=True),
]
HeadingLevel = Annotated[int, Field(strict=True, ge=1, le=3)]
LessonStatus = Literal["draft", "published"]


class HeadingBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["heading"]
    text: NonEmptyText
    level: HeadingLevel


class ParagraphBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["paragraph"]
    text: NonEmptyText


class BulletListBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["bullet_list"]
    items: list[NonEmptyText] = Field(min_length=1)


LessonContentBlock = Annotated[
    Union[HeadingBlock, ParagraphBlock, BulletListBlock],
    Field(discriminator="type"),
]


class LessonContent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: Literal[1] = 1
    blocks: list[LessonContentBlock] = Field(min_length=1)


class LessonCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: NonEmptyText
    topic: NonEmptyText
    subject_id: NonEmptyText
    class_id: NonEmptyText
    content: LessonContent


class LessonUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: NonEmptyText | None = None
    topic: NonEmptyText | None = None
    subject_id: NonEmptyText | None = None
    class_id: NonEmptyText
    content: LessonContent | None = None

    def model_post_init(self, __context: object) -> None:
        if not self.model_fields_set:
            raise ValueError("At least one lesson field must be provided.")

        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null.")


class LessonResponse(BaseModel):
    """Lesson data; the service layer must provide timezone-aware datetimes."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    title: NonEmptyText
    topic: NonEmptyText
    subject_id: NonEmptyText
    class_id: NonEmptyText
    teacher_id: NonEmptyText
    status: LessonStatus
    content: LessonContent
    created_at: AwareDatetime
    updated_at: AwareDatetime
    published_at: AwareDatetime | None = None
