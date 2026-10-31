import logging

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

from app.api.auth import verify_firebase_token
from app.ai.ollama_client import OllamaClient
from app.models.generation import (
    GenerateQuizRequestBody,
    QuizDraft,
)
from app.models.lesson import (
    LessonCreateRequest,
    LessonImportPreview,
    LessonResponse,
    LessonUpdateRequest,
)
from app.services.quiz_generation_orchestrator import (
    QuizGenerationOrchestrator,
)
from app.services.lesson_access_service import (
    has_active_assignment,
    require_active_class,
    require_active_subject,
    require_teacher_lesson_access,
    student_can_read_lesson,
    teacher_can_manage_lesson,
    validate_active_account,
)
from app.services.lesson_service import (
    aware_datetime,
    create_lesson as create_lesson_service,
    delete_lesson as delete_lesson_service,
    get_lesson as get_lesson_service,
    lesson_response,
    lesson_snapshot,
    list_lessons as list_lessons_service,
    set_publication_status as set_publication_status_service,
    update_lesson as update_lesson_service,
)
from app.services.lesson_import_service import (
    authorize_lesson_import as authorize_lesson_import_service,
    import_lesson_pdf as import_lesson_pdf_service,
    import_lesson_txt as import_lesson_txt_service,
    lesson_import_preview as lesson_import_preview_service,
    read_import_file as read_import_file_service,
)
from app.services.quiz_generation_service import (
    QuizGenerationService,
)
from app.services.lesson_quiz_service import (
    generate_quiz_for_lesson as generate_quiz_for_lesson_service,
    quiz_draft_response,
)
from app.validation.quiz_validator import QuizValidator
from app.validation.lesson_validation import (
    validate_document_id,
    validate_publishable_lesson,
)

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


def require_role(decoded_token: dict[str, Any], role: str) -> str:
    if decoded_token.get("role") != role:
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    uid = decoded_token.get("uid")
    if not isinstance(uid, str) or not uid:
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token.")
    return uid


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

    return create_lesson_service(database, data, teacher_uid)


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
    return authorize_lesson_import_service(
        database,
        teacher_uid,
        class_id,
        subject_id,
    )


async def read_import_file(
    file: UploadFile,
    expected_extension: str,
    max_bytes: int,
) -> bytes:
    return await read_import_file_service(file, expected_extension, max_bytes)


def lesson_import_preview(
    source_type: str,
    text: str,
    page_count: int | None = None,
) -> LessonImportPreview:
    return lesson_import_preview_service(source_type, text, page_count)


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
    return await import_lesson_txt_service(file)


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
    return await import_lesson_pdf_service(file)


@router.get("/lessons", response_model=list[LessonResponse])
def list_lessons(
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> list[LessonResponse]:
    database = get_database()
    role = decoded_token.get("role")

    if role == "teacher":
        teacher_uid = require_role(decoded_token, "teacher")
        validate_active_account(database, teacher_uid, "teacher")
        return list_lessons_service(database, "teacher", teacher_uid)

    student_uid = require_role(decoded_token, "student")
    validate_active_account(database, student_uid, "student")
    return list_lessons_service(database, "student", student_uid)


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
        return get_lesson_service(
            database,
            lesson_id,
            data,
            "teacher",
            teacher_uid,
        )

    student_uid = require_role(decoded_token, "student")
    validate_active_account(database, student_uid, "student")
    return get_lesson_service(
        database,
        lesson_id,
        data,
        "student",
        student_uid,
    )


@router.patch("/lessons/{lesson_id}", response_model=LessonResponse)
def update_lesson(
    lesson_id: str,
    data: LessonUpdateRequest,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> LessonResponse:
    teacher_uid = require_role(decoded_token, "teacher")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
    return update_lesson_service(database, lesson_id, data, teacher_uid)


def set_publication_status(
    lesson_id: str,
    decoded_token: dict[str, Any],
    published: bool,
) -> LessonResponse:
    teacher_uid = require_role(decoded_token, "teacher")
    database = get_database()
    validate_active_account(database, teacher_uid, "teacher")
    return set_publication_status_service(
        database,
        lesson_id,
        teacher_uid,
        published,
    )


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
    delete_lesson_service(database, lesson_id, teacher_uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def get_quiz_orchestrator() -> QuizGenerationOrchestrator:
    client = OllamaClient()
    service = QuizGenerationService(llm_client=client)
    validator = QuizValidator()
    return QuizGenerationOrchestrator(generation_service=service, validator=validator)


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
    return generate_quiz_for_lesson_service(
        database=database,
        lesson_id=lesson_id,
        lesson_data=lesson_data,
        teacher_uid=teacher_uid,
        body=body,
        orchestrator=orchestrator,
    )
