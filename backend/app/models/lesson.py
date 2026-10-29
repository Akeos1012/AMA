from typing import Annotated, Literal, Union

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


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


class PageHeadingElement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["heading"]
    id: NonEmptyText
    text: NonEmptyText
    level: HeadingLevel


class PageParagraphElement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["paragraph"]
    id: NonEmptyText
    text: NonEmptyText


class PageBulletListElement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["bullet_list"]
    id: NonEmptyText
    items: list[NonEmptyText] = Field(min_length=1)


class PageImageElement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["image"]
    id: NonEmptyText
    asset_id: NonEmptyText
    alt_text: str = ""


PageLessonElement = Annotated[
    Union[
        PageHeadingElement,
        PageParagraphElement,
        PageBulletListElement,
        PageImageElement,
    ],
    Field(discriminator="type"),
]


class LessonPage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    elements: list[PageLessonElement] = Field(default_factory=list)


class PageLessonContent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: Literal[1] = 1
    pages: list[LessonPage] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "PageLessonContent":
        page_ids = [page.id for page in self.pages]
        element_ids = [
            element.id
            for page in self.pages
            for element in page.elements
        ]
        if len(page_ids) != len(set(page_ids)):
            raise ValueError("Page IDs must be unique.")
        if len(element_ids) != len(set(element_ids)):
            raise ValueError("Element IDs must be unique.")
        return self

    def to_canonical_content(self) -> LessonContent:
        """Flatten ordered page text to the existing AI-compatible block schema."""
        canonical_blocks: list[LessonContentBlock] = []

        for page in self.pages:
            for element in page.elements:
                if isinstance(element, PageHeadingElement):
                    canonical_blocks.append(
                        HeadingBlock(
                            type="heading",
                            text=element.text,
                            level=element.level,
                        )
                    )
                elif isinstance(element, PageParagraphElement):
                    canonical_blocks.append(
                        ParagraphBlock(type="paragraph", text=element.text)
                    )
                elif isinstance(element, PageBulletListElement):
                    canonical_blocks.append(
                        BulletListBlock(type="bullet_list", items=element.items)
                    )

        return LessonContent(schema_version=1, blocks=canonical_blocks)


class LessonCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: NonEmptyText
    topic: NonEmptyText
    subject_id: NonEmptyText
    class_id: NonEmptyText
    content: LessonContent


class LessonImportPreview(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    source_type: Literal["txt", "pdf"]
    text: str
    page_count: int | None
    paragraph_count: int = Field(ge=1)


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
