import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.api import admin_users
from app.api.auth import verify_firebase_token


class AdminUserPasswordResetTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(admin_users.router, prefix="/api")
        app.dependency_overrides[verify_firebase_token] = (
            self.mock_verify_firebase_token
        )
        self.client = TestClient(app)
        self.addCleanup(app.dependency_overrides.clear)
        self.account = SimpleNamespace(
            uid="student-1",
            email="student@example.com",
            custom_claims={"role": "student"},
        )
        self.get_user_patch = patch.object(
            admin_users.firebase_auth,
            "get_user",
            side_effect=self.get_user,
        )
        self.get_user_patch.start()
        self.addCleanup(self.get_user_patch.stop)

    def get_user(self, uid):
        if uid == self.account.uid:
            return self.account
        raise admin_users.firebase_auth.UserNotFoundError("user not found", uid)

    @staticmethod
    def mock_verify_firebase_token(request: Request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        return {"uid": token, "role": "admin" if token == "admin-1" else "teacher"}

    @staticmethod
    def admin_headers():
        return {"Authorization": "Bearer admin-1"}

    def test_admin_gets_registered_student_email_for_reset(self):
        response = self.client.post(
            "/api/admin/users/student-1/password-reset",
            headers=self.admin_headers(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"email": "student@example.com"})

    def test_teacher_cannot_get_password_reset_target(self):
        response = self.client.post(
            "/api/admin/users/student-1/password-reset",
            headers={"Authorization": "Bearer teacher-1"},
        )

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.post(
            "/api/admin/users/student-1/password-reset",
        )

        self.assertEqual(response.status_code, 401)

    def test_missing_target_user_is_not_found(self):
        response = self.client.post(
            "/api/admin/users/missing-user/password-reset",
            headers=self.admin_headers(),
        )

        self.assertEqual(response.status_code, 404)

    def test_administrator_target_is_not_eligible_for_password_reset(self):
        self.account.custom_claims = {"role": "admin"}

        response = self.client.post(
            "/api/admin/users/student-1/password-reset",
            headers=self.admin_headers(),
        )

        self.assertEqual(response.status_code, 403)

    def test_missing_or_invalid_registered_email_is_rejected(self):
        for email in (None, "not-an-email"):
            with self.subTest(email=email):
                self.account.email = email
                response = self.client.post(
                    "/api/admin/users/student-1/password-reset",
                    headers=self.admin_headers(),
                )
                self.assertEqual(response.status_code, 422)

    def test_admin_user_listing_includes_profile_status_for_account_state(self):
        auth_user = SimpleNamespace(
            uid="teacher-1",
            email="teacher@example.com",
            display_name="Teacher One",
            disabled=False,
            email_verified=True,
            custom_claims={"role": "teacher", "employee_id": "EMP-1"},
            user_metadata=SimpleNamespace(creation_timestamp=123),
        )
        profile = SimpleNamespace(
            id="teacher-1",
            to_dict=lambda: {
                "status": "inactive",
                "name": "Teacher One",
            },
        )
        user_collection = SimpleNamespace(
            document=lambda uid: SimpleNamespace(id=uid)
        )
        database = SimpleNamespace(
            collection=lambda name: user_collection,
            get_all=lambda refs: [profile for _ in refs],
        )
        list_users_patch = patch.object(
            admin_users.firebase_auth,
            "list_users",
            return_value=SimpleNamespace(iterate_all=lambda: [auth_user]),
        )
        database_patch = patch.object(
            admin_users.firestore,
            "client",
            return_value=database,
        )
        with list_users_patch, database_patch:
            response = self.client.get(
                "/api/admin/users",
                headers=self.admin_headers(),
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["profile_status"], "inactive")


if __name__ == "__main__":
    unittest.main()
