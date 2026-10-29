import re
from io import BytesIO

from pypdf import PdfReader, apply_configuration
from pypdf.errors import LimitReachedError, PdfReadError


TXT_MAX_BYTES = 2 * 1024 * 1024
PDF_MAX_BYTES = 20 * 1024 * 1024
PDF_MAX_PAGES = 100
IMPORTED_TEXT_MAX_BYTES = 256 * 1024
PDF_MAX_XREF_ENTRIES = 200_000
PDF_ROOT_RECOVERY_LIMIT = 1_000
PDF_MAX_DECODED_STREAM_BYTES = 10 * 1024 * 1024
PDF_MAX_DECODE_WORK_BYTES = 20 * 1024 * 1024
PDF_MAX_STREAM_PARSE_OPERATIONS = 500_000


class LessonImportError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


def _decode_text(data: bytes) -> str:
    has_binary_control = any(
        byte < 32 and byte not in {9, 10, 12, 13}
        for byte in data
    )
    if b"%PDF-" in data[:1024] or has_binary_control:
        raise LessonImportError(
            "This file is not valid UTF-8 plain text.",
            422,
        )
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise LessonImportError(
            "This text file is not valid UTF-8. Save it as UTF-8 and try again.",
            422,
        ) from None
    return _validate_extracted_text(text)


def _validate_extracted_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if "\x00" in normalized:
        raise LessonImportError(
            "The extracted file contains invalid text data.",
            422,
        )
    if not any(character.isalnum() for character in normalized):
        raise LessonImportError(
            "No usable text was found. Enter the lesson text manually or choose another file.",
            422,
        )
    if len(normalized.encode("utf-8")) > IMPORTED_TEXT_MAX_BYTES:
        raise LessonImportError(
            "Extracted text exceeds the 256 KiB lesson content limit.",
            413,
        )
    return normalized


def extract_txt(data: bytes) -> str:
    if not data:
        raise LessonImportError("The text file is empty.", 422)
    if len(data) > TXT_MAX_BYTES:
        raise LessonImportError("Text files must be 2 MiB or smaller.", 413)
    return _decode_text(data)


def extract_pdf(data: bytes) -> tuple[str, int]:
    if not data:
        raise LessonImportError("The PDF file is empty.", 422)
    if len(data) > PDF_MAX_BYTES:
        raise LessonImportError("PDF files must be 20 MiB or smaller.", 413)
    if b"%PDF-" not in data[:1024]:
        raise LessonImportError(
            "The uploaded file is not a valid PDF document.",
            422,
        )

    try:
        with apply_configuration(
            maximum_declared_stream_length=PDF_MAX_DECODED_STREAM_BYTES,
            array_based_stream_maximum_output_length=PDF_MAX_DECODED_STREAM_BYTES,
            jbig2_maximum_output_length=PDF_MAX_DECODED_STREAM_BYTES,
            lzw_maximum_output_length=PDF_MAX_DECODED_STREAM_BYTES,
            run_length_maximum_output_length=PDF_MAX_DECODED_STREAM_BYTES,
            zlib_maximum_output_length=PDF_MAX_DECODED_STREAM_BYTES,
            brotli_maximum_output_length=PDF_MAX_DECODED_STREAM_BYTES,
            image_maximum_buffer_size=PDF_MAX_DECODED_STREAM_BYTES,
            stream_decoding_work_maximum_length=PDF_MAX_DECODE_WORK_BYTES,
            stream_parsing_work_maximum_count=PDF_MAX_STREAM_PARSE_OPERATIONS,
            stream_filters_maximum_length=8,
            page_tree_maximum_entries=2_000,
            page_tree_maximum_depth=50,
            page_tree_maximum_page_entries=10_000,
            xform_maximum_invocations_per_extraction=500,
        ):
            reader = PdfReader(
                BytesIO(data),
                strict=True,
                root_object_recovery_limit=PDF_ROOT_RECOVERY_LIMIT,
                xref_stream_maximum_entries=PDF_MAX_XREF_ENTRIES,
            )
            if reader.is_encrypted:
                raise LessonImportError(
                    "Password-protected PDFs are not supported. Remove the password and try again.",
                    422,
                )

            page_count = len(reader.pages)
            if page_count == 0:
                raise LessonImportError("The PDF contains no pages.", 422)
            if page_count > PDF_MAX_PAGES:
                raise LessonImportError(
                    "PDFs must contain 100 pages or fewer.",
                    413,
                )

            page_texts: list[str] = []
            extracted_bytes = 0
            for page in reader.pages:
                page_text = page.extract_text() or ""
                extracted_bytes += len(page_text.encode("utf-8"))
                if extracted_bytes > IMPORTED_TEXT_MAX_BYTES:
                    raise LessonImportError(
                        "Extracted text exceeds the 256 KiB lesson content limit.",
                        413,
                    )
                page_texts.append(page_text)
    except LessonImportError:
        raise
    except (LimitReachedError, PdfReadError, ValueError, OSError):
        raise LessonImportError(
            "The PDF is corrupt or exceeds safe text-extraction limits.",
            422,
        ) from None

    combined_text = "\n\n".join(page_texts)
    if not any(character.isalnum() for character in combined_text):
        raise LessonImportError(
            "This PDF has no usable selectable text. Scanned/image-only PDFs need manual text entry; OCR is not supported yet.",
            422,
        )
    text = _validate_extracted_text(combined_text)
    return text, page_count


def text_to_paragraphs(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return [
        paragraph.strip()
        for paragraph in re.split(r"\n[ \t]*\n+", normalized)
        if paragraph.strip()
    ]
