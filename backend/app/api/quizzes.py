from typing import Any

from fastapi import APIRouter, Depends

from app.api.auth import verify_firebase_token
from app.api.lessons import require_role
from app.models.student_quiz import (
    StudentQuizListResponse,
    StudentQuizResponse,
    StudentQuizSubmissionRequest,
    StudentQuizSubmissionResponse,
)
from app.services.lesson_access_service import validate_active_account
from app.services.student_quiz_service import (
    get_student_quiz,
    list_student_quizzes,
    submit_student_quiz,
)
from firebase_admin import auth as firebase_auth, firestore


router = APIRouter()


def get_database():
    return firestore.client()


@router.get("/student/quizzes", response_model=list[StudentQuizListResponse])
def read_student_quizzes(
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> list[StudentQuizListResponse]:
    student_uid = require_role(decoded_token, "student")
    database = get_database()
    validate_active_account(database, student_uid, "student")
    return list_student_quizzes(database, student_uid)


@router.get("/student/quizzes/{quiz_id}", response_model=StudentQuizResponse)
def read_student_quiz(
    quiz_id: str,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> StudentQuizResponse:
    student_uid = require_role(decoded_token, "student")
    database = get_database()
    validate_active_account(database, student_uid, "student")
    return get_student_quiz(database, quiz_id, student_uid)


@router.post(
    "/student/quizzes/{quiz_id}/submit",
    response_model=StudentQuizSubmissionResponse,
)
def submit_quiz_answers(
    quiz_id: str,
    body: StudentQuizSubmissionRequest,
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> StudentQuizSubmissionResponse:
    student_uid = require_role(decoded_token, "student")
    database = get_database()
    validate_active_account(database, student_uid, "student")
    return submit_student_quiz(database, quiz_id, student_uid, body)
