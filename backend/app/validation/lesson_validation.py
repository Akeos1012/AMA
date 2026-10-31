from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from app.models.lesson import LessonContent


def validate_document_id(value: str, label: str) -> str:
    if (
        not value
        or len(value.encode("utf-8")) > 1500
        or "/" in value
        or value in {".", ".."}
        or (value.startswith("__") and value.endswith("__"))
    ):
        raise HTTPException(status_code=422, detail=f"Invalid {label}.")
    return value


def validate_publishable_lesson(lesson: dict[str, Any]) -> None:
    if not isinstance(lesson.get("title"), str) or not lesson["title"].strip():
        raise HTTPException(
            status_code=422,
            detail="Add a lesson title before publishing.",
        )
    if not isinstance(lesson.get("topic"), str) or not lesson["topic"].strip():
        raise HTTPException(
            status_code=422,
            detail="Add a lesson topic before publishing.",
        )
    try:
        content = LessonContent.model_validate(lesson.get("content"))
    except ValidationError:
        raise HTTPException(
            status_code=422,
            detail="Lesson content is invalid. Review the content blocks before publishing.",
        ) from None

    text_parts: list[str] = []
    for block in content.blocks:
        if block.type == "bullet_list":
            text_parts.extend(block.items)
        else:
            text_parts.append(block.text)
    if not any(
        character.isalnum()
        for text in text_parts
        for character in text
    ):
        raise HTTPException(
            status_code=422,
            detail="Add at least one content block with usable lesson text before publishing.",
        )
