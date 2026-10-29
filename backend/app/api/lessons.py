import logging

from datetime import datetime, timezone
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from firebase_admin import auth as firebase_auth, firestore
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.api.auth import verify_firebase_token
from app.ai.client import LLMProviderError
from app.ai.ollama_client import OllamaClient
from app.extraction.lesson_text import extract_lesson_text, InsufficientLessonContentError
from app.extraction.lesson_import import (
    LessonImportError,
    PDF_MAX_BYTES,
    TXT_MAX_BYTES,
    extract_pdf,
    extract_txt,
    text_to_paragraphs,
)
from app.models.generation import (
    GenerateQuizRequestBody,
    QuizDraft,
    QuizGenerationRequest,
)
from app.models.lesson import (
    LessonCreateRequest,
    LessonContent,
    LessonImportPreview,
    LessonResponse,
    LessonUpdateRequest,
)
from app.services.quiz_generation_orchestrator import (
    QuizGenerationOrchestrator,
    QuizOrchestrationError,
)
from app.services.quiz_generation_service import (
    QuizGenerationService,
    QuizGenerationServiceError,
)
from app.validation.quiz_validator import QuizValidator

router = APIRouter()

logger = logging.getLogger(__name__)
LESSON_COLLECTION = "lessons"
USER_COLLECTION = "users"
CLASS_COLLECTION = "classes"
SUBJECT_COLLECTION = "subjects"
ASSIGNMENT_COLLECTION = "class_teacher_assignments"
MEMBERSHIP_COLLECTION = "class_memberships"
QUIZ_COLLECTION = "quizzes"


def get_database():
    return firestore.client()


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


def require_role(decoded_token: dict[str, Any], role: str) -> str:
    if decoded_token.get("role") != role:
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    uid = decoded_token.get("uid")
    if not isinstance(uid, str) or not uid:
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token.")
    return uid


def validate_active_account(
    database,
    uid: str,
    role: str,
) -> dict[str, Any]:
    profile_snapshot = database.collection(USER_COLLECTION).document(uid).get()
    if not profile_snapshot.exists:
        raise HTTPException(status_code=403, detail="An active account is required.")
    profile = profile_snapshot.to_dict() or {}

    try:
        account = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(
            status_code=403,
            detail="An active account is required.",
        ) from None

    if (
        account.disabled
        or profile.get("status") != "active"
        or profile.get("role") != role
    ):
        raise HTTPException(status_code=403, detail="An active account is required.")
    return profile


def require_active_class(database, class_id: str) -> dict[str, Any] | None:
    snapshot = database.collection(CLASS_COLLECTION).document(class_id).get()
    if not snapshot.exists:
        return None
    class_data = snapshot.to_dict() or {}
    if class_data.get("status") != "active":
        return None
    return class_data


def require_active_subject(database, subject_id: str) -> dict[str, Any] | None:
    snapshot = database.collection(SUBJECT_COLLECTION).document(subject_id).get()
    if not snapshot.exists:
        return None
    subject_data = snapshot.to_dict() or {}
    if subject_data.get("status") != "active":
        return None
    return subject_data


def has_active_assignment(
    database,
    class_id: str,
    subject_id: str,
    teacher_uid: str | None = None,
) -> bool:
    assignments = (
        database.collection(ASSIGNMENT_COLLECTION)
        .where("class_id", "==", class_id)
        .where("subject_id", "==", subject_id)
        .where("status", "==", "active")
    )
    if teacher_uid is not None:
        assignments = assignments.where("teacher_uid", "==", teacher_uid)
    return next(iter(assignments.limit(1).stream()), None) is not None


def teacher_can_manage_lesson(
    database,
    teacher_uid: str,
    class_id: str,
    subject_id: str,
) -> bool:
    if require_active_class(database, class_id) is None:
        return False
    subject = require_active_subject(database, subject_id)
    if subject is None:
        return False
    teacher_ids = subject.get("teacher_ids", [])
    return (
        isinstance(teacher_ids, (list, tuple))
        and teacher_uid in teacher_ids
        and has_active_assignment(database, class_id, subject_id, teacher_uid)
    )


def require_teacher_lesson_access(
    database,
    teacher_uid: str,
    lesson: dict[str, Any],
) -> None:
    if not teacher_can_manage_lesson(
        database,
        teacher_uid,
        lesson.get("class_id", ""),
        lesson.get("subject_id", ""),
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to manage this lesson.",
        )


def lesson_snapshot(database, lesson_id: str) -> tuple[Any, dict[str, Any]]:
    validate_document_id(lesson_id, "lesson ID")
    snapshot = database.collection(LESSON_COLLECTION).document(lesson_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    return snapshot, snapshot.to_dict() or {}


def aware_datetime(value: Any, field_name: str) -> datetime:
    if not isinstance(value, datetime):
        raise HTTPException(
            status_code=500,
            detail=f"Stored lesson {field_name} timestamp is invalid.",
        )
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def lesson_response(lesson_id: str, data: dict[str, Any]) -> LessonResponse:
    response_data = dict(data)
    response_data.update(
        {
            "id": lesson_id,
            "created_at": aware_datetime(data.get("created_at"), "created_at"),
            "updated_at": aware_datetime(data.get("updated_at"), "updated_at"),
            "published_at": (
                aware_datetime(data["published_at"], "published_at")
                if data.get("published_at") is not None
                else None
            ),
        }
    )
    try:
        return LessonResponse.model_validate(response_data)
    except (TypeError, ValidationError):
        raise HTTPException(
            status_code=500,
            detail="Stored lesson data is invalid.",
        ) from None


def student_can_read_lesson(
    database,
    student_uid: str,
    lesson: dict[str, Any],
) -> bool:
    class_id = lesson.get("class_id", "")
    subject_id = lesson.get("subject_id", "")
    if lesson.get("status") != "published":
        return False
    if require_active_class(database, class_id) is None:
        return False
    if require_active_subject(database, subject_id) is None:
        return False

    memberships = (
        database.collection(MEMBERSHIP_COLLECTION)
        .where("class_id", "==", class_id)
        .where("student_uid", "==", student_uid)
        .where("status", "==", "active")
        .limit(1)
        .stream()
    )
    return (
        next(iter(memberships), None) is not None
        and has_active_assignment(database, class_id, subject_id)
    )


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


@router.post(
    "/lessons",
    response_model=LessonResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_lesson(
    data: LessonCreateRequest,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonResponse:
    teacher_uid = require_role(decoded_token, "teacher")
    validate_document_id(data.class_id, "class ID")
    validate_document_id(data.subject_id, "subject ID")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")

    if not teacher_can_manage_lesson(
        database,
        teacher_uid,
        data.class_id,
        data.subject_id,
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized for this class and subject.",
        )

    lesson_ref = database.collection(LESSON_COLLECTION).document()
    lesson_ref.set(
        {
            **data.model_dump(),
            "teacher_id": teacher_uid,
            "status": "draft",
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
            "published_at": None,
        }
    )
    return lesson_response(lesson_ref.id, lesson_ref.get().to_dict() or {})


def authorize_lesson_import(
    decoded_token: dict[str, Any],
    class_id: str,
    subject_id: str,
):
    teacher_uid = require_role(decoded_token, "teacher")
    validate_document_id(class_id, "class ID")
    validate_document_id(subject_id, "subject ID")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
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


@router.post(
    "/lessons/import/txt",
    response_model=LessonImportPreview,
)
async def import_lesson_txt(
    file: UploadFile = File(...),
    class_id: str = Form(...),
    subject_id: str = Form(...),
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonImportPreview:
    authorize_lesson_import(decoded_token, class_id, subject_id)
    data = await read_import_file(file, ".txt", TXT_MAX_BYTES)
    try:
        text = extract_txt(data)
    except LessonImportError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from None
    return lesson_import_preview("txt", text)


@router.post(
    "/lessons/import/pdf",
    response_model=LessonImportPreview,
)
async def import_lesson_pdf(
    file: UploadFile = File(...),
    class_id: str = Form(...),
    subject_id: str = Form(...),
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonImportPreview:
    authorize_lesson_import(decoded_token, class_id, subject_id)
    data = await read_import_file(file, ".pdf", PDF_MAX_BYTES)
    try:
        text, page_count = await run_in_threadpool(extract_pdf, data)
    except LessonImportError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from None
    return lesson_import_preview("pdf", text, page_count)


@router.get("/lessons", response_model=list[LessonResponse])
def list_lessons(
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> list[LessonResponse]:
    database = get_database()
    role = decoded_token.get("role")

    if role == "teacher":
        teacher_uid = require_role(decoded_token, "teacher")
        validate_active_account(database, teacher_uid, "teacher")
        documents = (
            database.collection(LESSON_COLLECTION)
            .where("teacher_id", "==", teacher_uid)
            .stream()
        )
        return [
            lesson_response(document.id, data)
            for document in documents
            if (data := document.to_dict() or {})
            and teacher_can_manage_lesson(
                database,
                teacher_uid,
                data.get("class_id", ""),
                data.get("subject_id", ""),
            )
        ]

    student_uid = require_role(decoded_token, "student")
    validate_active_account(database, student_uid, "student")
    memberships = (
        database.collection(MEMBERSHIP_COLLECTION)
        .where("student_uid", "==", student_uid)
        .where("status", "==", "active")
        .stream()
    )
    active_class_ids = {
        membership_data.get("class_id")
        for membership in memberships
        if (membership_data := membership.to_dict() or {})
        and isinstance(membership_data.get("class_id"), str)
        and require_active_class(database, membership_data["class_id"]) is not None
    }

    lessons: dict[str, LessonResponse] = {}
    for class_id in active_class_ids:
        documents = (
            database.collection(LESSON_COLLECTION)
            .where("class_id", "==", class_id)
            .where("status", "==", "published")
            .stream()
        )
        for document in documents:
            data = document.to_dict() or {}
            if student_can_read_lesson(database, student_uid, data):
                lessons[document.id] = lesson_response(document.id, data)
    return sorted(lessons.values(), key=lambda lesson: lesson.id)


@router.get("/lessons/{lesson_id}", response_model=LessonResponse)
def get_lesson(
    lesson_id: str,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonResponse:
    database = get_database()
    _, data = lesson_snapshot(database, lesson_id)

    if decoded_token.get("role") == "teacher":
        teacher_uid = require_role(decoded_token, "teacher")
        validate_active_account(database, teacher_uid, "teacher")
        if data.get("teacher_id") != teacher_uid:
            raise HTTPException(status_code=404, detail="Lesson not found.")
        require_teacher_lesson_access(database, teacher_uid, data)
    else:
        student_uid = require_role(decoded_token, "student")
        validate_active_account(database, student_uid, "student")
        if not student_can_read_lesson(database, student_uid, data):
            raise HTTPException(status_code=404, detail="Lesson not found.")
    return lesson_response(lesson_id, data)


@router.patch("/lessons/{lesson_id}", response_model=LessonResponse)
def update_lesson(
    lesson_id: str,
    data: LessonUpdateRequest,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonResponse:
    teacher_uid = require_role(decoded_token, "teacher")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
    lesson_ref = database.collection(LESSON_COLLECTION).document(
        validate_document_id(lesson_id, "lesson ID")
    )
    _, current_data = lesson_snapshot(database, lesson_id)
    if current_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, current_data)

    changes = data.model_dump(exclude_unset=True)
    destination_class_id = changes["class_id"]
    destination_subject_id = changes.get(
        "subject_id",
        current_data.get("subject_id", ""),
    )
    validate_document_id(destination_class_id, "class ID")
    validate_document_id(destination_subject_id, "subject ID")
    if not teacher_can_manage_lesson(
        database,
        teacher_uid,
        destination_class_id,
        destination_subject_id,
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not authorized for this class and subject.",
        )

    changes["updated_at"] = SERVER_TIMESTAMP
    lesson_ref.update(changes)
    updated_data = lesson_ref.get().to_dict() or {}
    return lesson_response(lesson_id, updated_data)


def set_publication_status(
    lesson_id: str,
    decoded_token: dict[str, Any],
    published: bool,
) -> LessonResponse:
    teacher_uid = require_role(decoded_token, "teacher")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
    lesson_id = validate_document_id(lesson_id, "lesson ID")
    lesson_ref = database.collection(LESSON_COLLECTION).document(lesson_id)
    _, current_data = lesson_snapshot(database, lesson_id)
    if current_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, current_data)
    if published:
        validate_publishable_lesson(current_data)

    lesson_ref.update(
        {
            "status": "published" if published else "draft",
            "published_at": SERVER_TIMESTAMP if published else None,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    return lesson_response(lesson_id, lesson_ref.get().to_dict() or {})


@router.post("/lessons/{lesson_id}/publish", response_model=LessonResponse)
def publish_lesson(
    lesson_id: str,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonResponse:
    return set_publication_status(lesson_id, decoded_token, True)


@router.post("/lessons/{lesson_id}/unpublish", response_model=LessonResponse)
def unpublish_lesson(
    lesson_id: str,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonResponse:
    return set_publication_status(lesson_id, decoded_token, False)


@router.delete("/lessons/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(
    lesson_id: str,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> Response:
    teacher_uid = require_role(decoded_token, "teacher")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
    lesson_id = validate_document_id(lesson_id, "lesson ID")
    lesson_ref = database.collection(LESSON_COLLECTION).document(lesson_id)
    _, current_data = lesson_snapshot(database, lesson_id)
    if current_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, current_data)
    lesson_ref.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def get_quiz_orchestrator() -> QuizGenerationOrchestrator:
    client = OllamaClient()
    service = QuizGenerationService(llm_client=client)
    validator = QuizValidator()
    return QuizGenerationOrchestrator(generation_service=service, validator=validator)


def quiz_draft_response(quiz_id: str, data: dict[str, Any]) -> QuizDraft:
    response_data = dict(data)
    response_data.update(
        {
            "id": quiz_id,
            "created_at": aware_datetime(data.get("created_at"), "created_at"),
            "updated_at": aware_datetime(data.get("updated_at"), "updated_at"),
            "published_at": (
                aware_datetime(data["published_at"], "published_at")
                if data.get("published_at") is not None
                else None
            ),
        }
    )
    try:
        return QuizDraft.model_validate(response_data)
    except (TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=500,
            detail="Stored quiz draft data is invalid.",
        ) from exc


@router.post(
    "/lessons/{lesson_id}/generate-quiz",
    response_model=QuizDraft,
    status_code=status.HTTP_201_CREATED,
)
def generate_quiz_for_lesson(
    lesson_id: str,
    body: GenerateQuizRequestBody,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
    orchestrator: QuizGenerationOrchestrator = Depends(get_quiz_orchestrator),
) -> QuizDraft:
    teacher_uid = require_role(decoded_token, "teacher")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
    lesson_id = validate_document_id(lesson_id, "lesson ID")

    _, lesson_data = lesson_snapshot(database, lesson_id)
    if lesson_data.get("teacher_id") != teacher_uid:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    require_teacher_lesson_access(database, teacher_uid, lesson_data)

    try:
        extracted_lesson = extract_lesson_text(lesson_data)
    except InsufficientLessonContentError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc

    gen_request = QuizGenerationRequest(
        lesson_id=lesson_id,
        question_counts=body.question_counts,
        instructions=body.instructions,
    )

    if body.max_attempts is not None:
        orchestrator.max_attempts = body.max_attempts

    try:
        result = orchestrator.orchestrate_generation(
            lesson=extracted_lesson,
            request=gen_request,
        )
    except LLMProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI generation service is currently unavailable. Please try again later.",
        ) from None
    except QuizGenerationServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from None

    if (
        not result.success
        or not result.quiz
        or not result.validation_report
        or not result.validation_report.is_valid
        or result.validation_report.status != "passed"
    ):
        if result.validation_report is not None:
            logger.warning(
                "Quiz generation failed validation: lesson_id=%s attempts=%s "
                "status=%s grounding_passed=%s correctness_passed=%s",
                lesson_id,
                result.attempts,
                result.validation_report.status,
                result.validation_report.grounding_passed,
                result.validation_report.correctness_passed,
            )
        else:
            logger.warning(
                "Quiz generation failed without a validation report: lesson_id=%s "
                "attempts=%s error=%s",
                lesson_id,
                result.attempts,
                result.error_message,
            )
        failure_detail = result.error_message or "Quiz generation failed validation requirements."
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=failure_detail,
        )

    quiz_ref = database.collection(QUIZ_COLLECTION).document()
    draft_record = {
        "lesson_id": lesson_id,
        "class_id": lesson_data.get("class_id"),
        "subject_id": lesson_data.get("subject_id"),
        "teacher_id": teacher_uid,
        "title": result.quiz.title,
        "status": "draft",
        "questions": [q.model_dump() for q in result.quiz.questions],
        "validation_report": result.validation_report.model_dump(),
        "model_id": result.model or "qwen2.5:3b",
        "created_at": SERVER_TIMESTAMP,
        "updated_at": SERVER_TIMESTAMP,
        "published_at": None,
    }

    try:
        quiz_ref.set(draft_record)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save quiz draft.",
        ) from exc

    saved_doc = quiz_ref.get()
    if not saved_doc.exists:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve saved quiz draft.",
        )

    return quiz_draft_response(quiz_ref.id, saved_doc.to_dict() or {})
