from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class InsufficientLessonContentError(Exception):
    """Raised when a lesson lacks sufficient substantive educational content to generate a quiz."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ExtractedPassage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    block_index: int = Field(ge=0)
    block_type: str
    heading_level: int | None = None
    text: str


class ExtractedLessonContent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    lesson_id: str
    title: str
    topic: str
    passages: list[ExtractedPassage]
    full_text: str
    word_count: int

    def get_passage_by_index(self, index: int) -> ExtractedPassage | None:
        for passage in self.passages:
            if passage.block_index == index:
                return passage
        return None


def extract_lesson_text(
    lesson_data: dict[str, Any],
    min_word_count: int = 15,
) -> ExtractedLessonContent:
    """
    Extracts and normalizes educational text from structured lesson blocks.

    Handles HeadingBlock, ParagraphBlock, and BulletListBlock.
    Discards whitespace-only items.
    Preserves block indices and section hierarchy for grounding verification.
    Raises InsufficientLessonContentError if educational content is empty or below threshold.
    """
    lesson_id = str(lesson_data.get("id") or lesson_data.get("lesson_id") or "unknown")
    title = str(lesson_data.get("title") or "").strip()
    topic = str(lesson_data.get("topic") or "").strip()

    raw_content = lesson_data.get("content")
    if isinstance(raw_content, dict):
        raw_blocks = raw_content.get("blocks", [])
    elif hasattr(raw_content, "blocks"):
        raw_blocks = raw_content.blocks
    else:
        raw_blocks = []

    if not isinstance(raw_blocks, (list, tuple)):
        raw_blocks = []

    passages: list[ExtractedPassage] = []
    formatted_sections: list[str] = []

    # If title and topic exist, include them as preamble context
    preamble_parts: list[str] = []
    if title:
        preamble_parts.append(f"Lesson Title: {title}")
    if topic:
        preamble_parts.append(f"Topic: {topic}")
    if preamble_parts:
        formatted_sections.append("\n".join(preamble_parts))

    for idx, raw_block in enumerate(raw_blocks):
        # Support both dict and pydantic block objects
        if hasattr(raw_block, "model_dump"):
            block_dict = raw_block.model_dump()
        elif isinstance(raw_block, dict):
            block_dict = raw_block
        else:
            continue

        b_type = block_dict.get("type")

        if b_type == "heading":
            text = str(block_dict.get("text") or "").strip()
            level = block_dict.get("level", 1)
            if text:
                prefix = "#" * max(1, min(3, int(level) if isinstance(level, (int, float)) else 1))
                passages.append(
                    ExtractedPassage(
                        block_index=idx,
                        block_type="heading",
                        heading_level=int(level) if isinstance(level, (int, float)) else 1,
                        text=text,
                    )
                )
                formatted_sections.append(f"{prefix} {text}")

        elif b_type == "paragraph":
            text = str(block_dict.get("text") or "").strip()
            if text:
                passages.append(
                    ExtractedPassage(
                        block_index=idx,
                        block_type="paragraph",
                        text=text,
                    )
                )
                formatted_sections.append(text)

        elif b_type == "bullet_list":
            items = block_dict.get("items", [])
            valid_items: list[str] = []
            if isinstance(items, (list, tuple)):
                for item in items:
                    clean_item = str(item or "").strip()
                    if clean_item:
                        valid_items.append(clean_item)
            if valid_items:
                joined_text = "\n".join(f"- {it}" for it in valid_items)
                passages.append(
                    ExtractedPassage(
                        block_index=idx,
                        block_type="bullet_list",
                        text=joined_text,
                    )
                )
                formatted_sections.append(joined_text)

    # Calculate substantive words from extracted passages
    passage_words = " ".join(p.text for p in passages).split()
    total_words = len(passage_words)

    if not passages or total_words < min_word_count:
        raise InsufficientLessonContentError(
            message=(
                f"Lesson content has only {total_words} substantive word(s), "
                f"which is below the minimum threshold of {min_word_count} words required for quiz generation."
            ),
            details={
                "lesson_id": lesson_id,
                "word_count": total_words,
                "min_word_count": min_word_count,
                "passage_count": len(passages),
            },
        )

    full_text = "\n\n".join(formatted_sections)

    return ExtractedLessonContent(
        lesson_id=lesson_id,
        title=title,
        topic=topic,
        passages=passages,
        full_text=full_text,
        word_count=total_words,
    )
