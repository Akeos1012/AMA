import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.api import quizzes
from test_lessons import FakeDatabase, NOW


class StudentQuizApiTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase()
        self.accounts = {
            "student-1": SimpleNamespace(disabled=False),
            "student-2": SimpleNamespace(disabled=False),
            "teacher-1": SimpleNamespace(disabled=False),
        }
        self.database.collection("users").documents.update(
            {
                "student-1": {"role": "student", "status": "active"},
                "student-2": {"role": "student", "status": "active"},
                "teacher-1": {"role": "teacher", "status": "active"},
            }
        )
        self.database.collection("classes").documents.update(
            {
                "class-1": {"status": "active"},
                "class-2": {"status": "active"},
            }
        )
        self.database.collection("subjects").documents["subject-1"] = {
            "status": "active",
            "teacher_ids": ["teacher-1"],
        }
        self.database.collection("class_teacher_assignments").documents["assignment-1"] = {
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_uid": "teacher-1",
            "status": "active",
        }
        self.database.collection("class_memberships").documents["membership-1"] = {
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
        }
        self.database.collection("class_memberships").documents["membership-2"] = {
            "class_id": "class-2",
            "student_uid": "student-2",
            "status": "active",
        }
        self.seed_quiz("quiz-published", status="published")
        self.seed_quiz("quiz-draft", status="draft")
        self.seed_quiz("quiz-other-class", class_id="class-2", status="published")

        app = FastAPI()
        app.include_router(quizzes.router, prefix="/api")
        app.dependency_overrides[quizzes.verify_firebase_token] = self.mock_verify_token
        self.database_patch = patch.object(quizzes, "get_database", return_value=self.database)
        self.auth_patch = patch.object(
            quizzes.firebase_auth,
            "get_user",
            side_effect=self.get_account,
        )
        self.database_patch.start()
        self.auth_patch.start()
        self.addCleanup(self.database_patch.stop)
        self.addCleanup(self.auth_patch.stop)
        self.client = TestClient(app)

    def mock_verify_token(self, request: Request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        roles = {"student-1": "student", "student-2": "student", "teacher-1": "teacher"}
        if token not in roles:
            raise HTTPException(status_code=401, detail="Invalid Firebase ID token")
        return {"uid": token, "role": roles[token]}

    def get_account(self, uid):
        try:
            return self.accounts[uid]
        except KeyError:
            raise quizzes.firebase_auth.UserNotFoundError("User not found", uid) from None

    def seed_quiz(
        self,
        quiz_id,
        class_id="class-1",
        status="published",
        opening_at=None,
        closing_at=None,
    ):
        self.database.collection("quizzes").documents[quiz_id] = {
            "lesson_id": "lesson-1",
            "class_id": class_id,
            "subject_id": "subject-1",
            "teacher_id": "teacher-1",
            "title": "Cell Energy Quiz",
            "description": "Review quiz",
            "opening_at": opening_at,
            "closing_at": closing_at,
            "status": status,
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria generate ATP.",
                    "evidence": {"quote": "private", "block_index": 0},
                },
                {
                    "type": "essay",
                    "prompt": "Explain cellular energy.",
                    "rubric": ["Mention ATP"],
                    "sample_solution": "Private sample",
                    "explanation": "Private explanation",
                    "evidence": {"quote": "private", "block_index": 0},
                },
            ],
            "validation_report": {"status": "passed"},
            "model_id": "private-model",
            "created_at": NOW,
            "updated_at": NOW,
            "published_at": NOW if status == "published" else None,
        }

    def headers(self, uid="student-1"):
        return {"Authorization": f"Bearer {uid}"}

    def test_authorized_student_lists_published_quizzes(self):
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual([quiz["id"] for quiz in response.json()], ["quiz-published"])
        self.assertEqual(response.json()[0]["status"], "open")
        self.assertNotIn("questions", response.json()[0])

    def test_drafts_and_other_classes_are_excluded(self):
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        ids = [quiz["id"] for quiz in response.json()]
        self.assertNotIn("quiz-draft", ids)
        self.assertNotIn("quiz-other-class", ids)

    def test_student_can_get_authorized_quiz_detail(self):
        response = self.client.get(
            "/api/student/quizzes/quiz-published",
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "quiz-published")

    def test_direct_detail_cannot_bypass_class_authorization(self):
        response = self.client.get(
            "/api/student/quizzes/quiz-other-class",
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 404)

    def test_published_target_class_controls_student_access(self):
        self.database.documents["quizzes"]["quiz-published"]["target_class_id"] = "class-2"
        self.database.documents["class_teacher_assignments"]["assignment-2"] = {
            "class_id": "class-2",
            "subject_id": "subject-1",
            "teacher_uid": "teacher-1",
            "status": "active",
        }
        response_for_original_class = self.client.get(
            "/api/student/quizzes",
            headers=self.headers("student-1"),
        )
        self.assertEqual(response_for_original_class.json(), [])

        response_for_target_class = self.client.get(
            "/api/student/quizzes",
            headers=self.headers("student-2"),
        )
        self.assertIn(
            "quiz-published",
            [item["id"] for item in response_for_target_class.json()],
        )
        detail = self.client.get(
            "/api/student/quizzes/quiz-published",
            headers=self.headers("student-2"),
        )
        self.assertEqual(detail.status_code, 200)

    def test_restricted_fields_are_not_returned(self):
        response = self.client.get(
            "/api/student/quizzes/quiz-published",
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        restricted = {
            "correct_answer", "accepted_alternatives", "explanation", "evidence",
            "correct_option_index", "rubric", "sample_solution", "validation_report",
            "teacher_id", "model_id",
        }
        self.assertTrue(restricted.isdisjoint(payload))
        for question in payload["questions"]:
            self.assertTrue(restricted.isdisjoint(question))

    def test_inactive_membership_is_rejected(self):
        self.database.documents["class_memberships"]["membership-1"]["status"] = "inactive"
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_inactive_class_or_subject_is_rejected(self):
        self.database.documents["classes"]["class-1"]["status"] = "inactive"
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

        self.database.documents["classes"]["class-1"]["status"] = "active"
        self.database.documents["subjects"]["subject-1"]["status"] = "inactive"
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_missing_active_assignment_is_rejected(self):
        self.database.documents["class_teacher_assignments"]["assignment-1"]["status"] = "inactive"
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    @patch("app.services.student_quiz_service.utc_now")
    def test_scheduled_and_closed_quizzes_are_listed_but_not_openable(self, mock_now):
        mock_now.return_value = NOW
        self.database.documents["quizzes"]["quiz-published"].update(
            {
                "opening_at": NOW + timedelta(hours=1),
                "closing_at": NOW + timedelta(hours=2),
            }
        )
        before = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(before.json()[0]["status"], "scheduled")
        before_detail = self.client.get(
            "/api/student/quizzes/quiz-published",
            headers=self.headers(),
        )
        self.assertEqual(before_detail.status_code, 404)

        mock_now.return_value = NOW + timedelta(hours=3)
        after = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(after.json()[0]["status"], "closed")
        after_detail = self.client.get(
            "/api/student/quizzes/quiz-published",
            headers=self.headers(),
        )
        self.assertEqual(after_detail.status_code, 404)

    @patch("app.services.student_quiz_service.utc_now")
    def test_student_can_open_quiz_only_during_availability_window(self, mock_now):
        mock_now.return_value = NOW
        self.database.documents["quizzes"]["quiz-published"].update(
            {
                "opening_at": NOW,
                "closing_at": NOW + timedelta(hours=1),
                "published_title": "Scheduled publication title",
                "published_description": "Published copy",
                "published_grade_level": "Grade 1",
                "published_section": "A",
            }
        )

        response = self.client.get(
            "/api/student/quizzes/quiz-published",
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Scheduled publication title")
        self.assertEqual(response.json()["grade_level"], "Grade 1")
        self.assertEqual(
            response.json()["questions"][0]["prompt"],
            "Which organelle generates ATP?",
        )
        self.assertNotIn("correct_answer", response.json()["questions"][0])

    @patch("app.services.student_quiz_service.utc_now")
    def test_student_submission_is_one_time_and_marks_quiz_answered(self, mock_now):
        mock_now.return_value = NOW
        answers = {
            "answers": [
                {"question_id": 0, "answer": "Mitochondria"},
                {"question_id": 1, "answer": "Cellular energy is stored in ATP."},
            ]
        }
        submitted = self.client.post(
            "/api/student/quizzes/quiz-published/submit",
            headers=self.headers(),
            json=answers,
        )
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json(), {"id": "quiz-published", "status": "answered"})

        listed = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(listed.json()[0]["status"], "answered")
        self.assertEqual(
            self.client.get(
                "/api/student/quizzes/quiz-published",
                headers=self.headers(),
            ).status_code,
            404,
        )
        duplicate = self.client.post(
            "/api/student/quizzes/quiz-published/submit",
            headers=self.headers(),
            json=answers,
        )
        self.assertEqual(duplicate.status_code, 409)

    @patch("app.services.student_quiz_service.utc_now")
    def test_submission_after_closing_time_is_rejected(self, mock_now):
        mock_now.return_value = NOW + timedelta(hours=2)
        self.database.documents["quizzes"]["quiz-published"].update(
            {
                "opening_at": NOW,
                "closing_at": NOW + timedelta(hours=1),
            }
        )
        response = self.client.post(
            "/api/student/quizzes/quiz-published/submit",
            headers=self.headers(),
            json={
                "answers": [
                    {"question_id": 0, "answer": "Mitochondria"},
                    {"question_id": 1, "answer": "ATP"},
                ]
            },
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.database.documents.get("quiz_attempts", {}), {})

    def test_invalid_quiz_answer_is_rejected_without_saving_attempt(self):
        response = self.client.post(
            "/api/student/quizzes/quiz-published/submit",
            headers=self.headers(),
            json={
                "answers": [
                    {"question_id": 0, "answer": "Not an option"},
                    {"question_id": 1, "answer": "ATP"},
                ]
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.database.documents.get("quiz_attempts", {}), {})

    def test_boolean_and_identification_answers_are_validated_by_question_type(self):
        self.database.documents["quizzes"]["quiz-published"]["questions"] = [
            {"type": "true_false", "prompt": "The Earth orbits the Sun."},
            {"type": "identification", "prompt": "Name the star at the center."},
        ]
        response = self.client.post(
            "/api/student/quizzes/quiz-published/submit",
            headers=self.headers(),
            json={
                "answers": [
                    {"question_id": 0, "answer": True},
                    {"question_id": 1, "answer": "The Sun"},
                ]
            },
        )
        self.assertEqual(response.status_code, 200)

    def test_missing_schedule_fields_are_compatible(self):
        self.database.documents["quizzes"]["quiz-published"].pop("opening_at")
        self.database.documents["quizzes"]["quiz-published"].pop("closing_at")
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()], ["quiz-published"])

    def test_missing_or_invalid_authentication_is_rejected(self):
        missing = self.client.get("/api/student/quizzes")
        invalid = self.client.get(
            "/api/student/quizzes",
            headers={"Authorization": "Bearer unknown"},
        )
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)

    def test_inactive_student_account_is_rejected(self):
        self.database.documents["users"]["student-1"]["status"] = "inactive"
        response = self.client.get("/api/student/quizzes", headers=self.headers())
        self.assertEqual(response.status_code, 403)

    def test_teacher_cannot_use_student_quiz_routes(self):
        response = self.client.get(
            "/api/student/quizzes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
