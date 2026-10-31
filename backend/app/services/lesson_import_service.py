from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.extraction.lesson_import import (
    LessonImportError,
    PDF_MAX_BYTES,
    TXT_MAX_BYTES,
    extract_pdf,
    extract_txt,
    text_to_paragraphs,
)
from app.models.lesson import LessonImportPreview
from app.services.lesson_access_service import teacher_can_manage_lesson


def authorize_lesson_import(
    database,
    teacher_uid: str,
    class_id: str,
    subject_id: str,
) -> None:
    if not teacher_can_manage_lesson(database, teacher_uid, class_id, subject_id):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized for this class and subject.",
        )


async def read_import_file(
    file: UploadFile,
    expected_extension: str,
    max_bytes: int,
) -> bytes:
    filename = file.filename or ""
    if not filename.lower().endswith(expected_extension):
        raise HTTPException(
            status_code=415,
            detail=f"Choose a {expected_extension} file for this import option.",
        )
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        message = (
            "Text files must be 2 MiB or smaller."
            if expected_extension == ".txt"
            else "PDF files must be 20 MiB or smaller."
        )
        raise HTTPException(status_code=413, detail=message)
    return data


def lesson_import_preview(
    source_type: str,
    text: str,
    page_count: int | None = None,
) -> LessonImportPreview:
    return LessonImportPreview(
        source_type=source_type,
        text=text,
        page_count=page_count,
        paragraph_count=len(text_to_paragraphs(text)),
    )


async def import_lesson_txt(
    file: UploadFile,
) -> LessonImportPreview:
    data = await read_import_file(file, ".txt", TXT_MAX_BYTES)
    try:
        text = extract_txt(data)
    except LessonImportError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from None
    return lesson_import_preview("txt", text)


async def import_lesson_pdf(
    file: UploadFile,
) -> LessonImportPreview:
    data = await read_import_file(file, ".pdf", PDF_MAX_BYTES)
    try:
        text, page_count = await run_in_threadpool(extract_pdf, data)
    except LessonImportError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from None
    return lesson_import_preview("pdf", text, page_count)
