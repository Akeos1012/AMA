import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.api import lessons


NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
NOW_JSON = NOW.isoformat().replace("+00:00", "Z")
CONTENT = {
    "blocks": [
        {"type": "heading", "text": "Introduction", "level": 1},
        {"type": "paragraph", "text": "A lesson paragraph."},
    ]
}
CREATE_BODY = {
    "title": "Fractions",
    "topic": "Adding fractions",
    "subject_id": "subject-1",
    "class_id": "class-1",
    "content": CONTENT,
}


class FakeSnapshot:
    def __init__(self, document_id, data):
        self.id = document_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class FakeDocumentReference:
    def __init__(self, collection, document_id):
        self.collection = collection
        self.id = document_id

    def get(self):
        return FakeSnapshot(self.id, self.collection.documents.get(self.id))

    def set(self, data):
        self.collection.documents[self.id] = self.collection.database.resolve_values(
            data
        )

    def update(self, changes):
        if self.id not in self.collection.documents:
            raise AssertionError(f"Cannot update missing test document {self.id}.")
        self.collection.documents[self.id].update(
            self.collection.database.resolve_values(changes)
        )

    def delete(self):
        self.collection.documents.pop(self.id, None)


class FakeQuery:
    def __init__(self, collection, filters=(), limit_count=None):
        self.collection = collection
        self.filters = filters
        self.limit_count = limit_count

    def where(self, field, operator, expected):
        if operator != "==":
            raise AssertionError(f"Unsupported test query operator: {operator}")
        return FakeQuery(
            self.collection,
            self.filters + ((field, expected),),
            self.limit_count,
        )

    def limit(self, count):
        return FakeQuery(self.collection, self.filters, count)

    def stream(self):
        results = [
            FakeSnapshot(document_id, data)
            for document_id, data in self.collection.documents.items()
            if all(data.get(field) == expected for field, expected in self.filters)
        ]
        return results[: self.limit_count]


class FakeCollection:
    def __init__(self, database, name):
        self.database = database
        self.name = name
        self.documents = database.documents.setdefault(name, {})

    def document(self, document_id=None):
        if document_id is None:
            document_id = f"generated-{self.database.next_id}"
            self.database.next_id += 1
        return FakeDocumentReference(self, document_id)

    def where(self, field, operator, expected):
        return FakeQuery(self).where(field, operator, expected)

    def stream(self):
        return FakeQuery(self).stream()


class FakeDatabase:
    def __init__(self):
        self.documents = {}
        self.next_id = 1

    def collection(self, name):
        return FakeCollection(self, name)

    @staticmethod
    def resolve_values(values):
        return {
            key: (
                NOW
                if value is lessons.SERVER_TIMESTAMP
                else FakeDatabase.resolve_nested(value)
            )
            for key, value in values.items()
        }

    @staticmethod
    def resolve_nested(value):
        if value is lessons.SERVER_TIMESTAMP:
            return NOW
        if isinstance(value, dict):
            return FakeDatabase.resolve_values(value)
        if isinstance(value, list):
            return [FakeDatabase.resolve_nested(item) for item in value]
        return value


class LessonApiTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase()
        self.accounts = {
            uid: SimpleNamespace(uid=uid, disabled=False)
            for uid in ("teacher-1", "teacher-2", "student-1", "admin-1")
        }
        self.database.collection("users").documents.update(
            {
                uid: {"uid": uid, "role": role, "status": "active"}
                for uid, role in (
                    ("teacher-1", "teacher"),
                    ("teacher-2", "teacher"),
                    ("student-1", "student"),
                    ("admin-1", "admin"),
                )
            }
        )
        self.add_class("class-1")
        self.add_class("class-2")
        self.add_subject("subject-1", ["teacher-1", "teacher-2"])
        self.add_subject("subject-2", ["teacher-1", "teacher-2"])
        self.add_assignment("class-1", "subject-1", "teacher-1")

        app = FastAPI()
        app.include_router(lessons.router, prefix="/api")
        app.dependency_overrides[
            lessons.verify_firebase_token
        ] = self.mock_verify_firebase_token
        self.client = TestClient(app)
        self.database_patch = patch.object(
            lessons, "get_database", return_value=self.database
        )
        self.auth_patch = patch.object(
            lessons.firebase_auth,
            "get_user",
            side_effect=self.get_account,
        )
        self.database_patch.start()
        self.auth_patch.start()
        self.addCleanup(self.database_patch.stop)
        self.addCleanup(self.auth_patch.stop)
        self.addCleanup(app.dependency_overrides.clear)

    def mock_verify_firebase_token(self, request: Request):
        authorization = request.headers.get("authorization", "")
        token = authorization.removeprefix("Bearer ").strip()
        roles = {
            "teacher-1": "teacher",
            "teacher-2": "teacher",
            "student-1": "student",
            "admin-1": "admin",
        }
        if token not in roles:
            return {}
        return {"uid": token, "role": roles[token]}

    def headers(self, uid="teacher-1"):
        return {"Authorization": f"Bearer {uid}"}

    def get_account(self, uid):
        try:
            return self.accounts[uid]
        except KeyError:
            raise lessons.firebase_auth.UserNotFoundError(
                "user not found", uid
            ) from None

    def add_class(self, class_id, status="active"):
        self.database.collection("classes").documents[class_id] = {
            "name": class_id,
            "grade_level": "Grade 1",
            "section": "A",
            "status": status,
            "created_at": NOW,
            "updated_at": NOW,
        }

    def add_subject(self, subject_id, teacher_ids=None, status="active"):
        self.database.collection("subjects").documents[subject_id] = {
            "name": subject_id,
            "code": subject_id.upper(),
            "status": status,
            "teacher_ids": teacher_ids if teacher_ids is not None else ["teacher-1"],
        }

    def add_assignment(
        self,
        class_id="class-1",
        subject_id="subject-1",
        teacher_uid="teacher-1",
        status="active",
        assignment_id=None,
    ):
        assignment_id = assignment_id or (
            f"{class_id}-{subject_id}-{teacher_uid}"
        )
        self.database.collection("class_teacher_assignments").documents[
            assignment_id
        ] = {
            "class_id": class_id,
            "subject_id": subject_id,
            "teacher_uid": teacher_uid,
            "status": status,
            "created_at": NOW,
            "updated_at": NOW,
        }
        return assignment_id

    def add_membership(
        self,
        class_id="class-1",
        student_uid="student-1",
        status="active",
        membership_id=None,
    ):
        membership_id = membership_id or f"{class_id}-{student_uid}"
        self.database.collection("class_memberships").documents[membership_id] = {
            "class_id": class_id,
            "student_uid": student_uid,
            "status": status,
            "created_at": NOW,
            "updated_at": NOW,
        }

    def add_lesson(
        self,
        lesson_id="lesson-1",
        class_id="class-1",
        subject_id="subject-1",
        teacher_id="teacher-1",
        status="draft",
    ):
        self.database.collection("lessons").documents[lesson_id] = {
            "title": "Fractions",
            "topic": "Adding fractions",
            "subject_id": subject_id,
            "class_id": class_id,
            "teacher_id": teacher_id,
            "status": status,
            "content": CONTENT,
            "created_at": NOW,
            "updated_at": NOW,
            "published_at": NOW if status == "published" else None,
        }

    def test_teacher_can_create_lesson_as_draft_with_server_fields(self):
        response = self.client.post(
            "/api/lessons",
            json=CREATE_BODY,
            headers=self.headers(),
        )

        self.assertEqual(response.status_code, 201)
        lesson = response.json()
        stored = self.database.collection("lessons").documents[lesson["id"]]
        self.assertEqual(lesson["status"], "draft")
        self.assertEqual(lesson["teacher_id"], "teacher-1")
        self.assertEqual(lesson["created_at"], NOW_JSON)
        self.assertEqual(lesson["updated_at"], NOW_JSON)
        self.assertIsNone(lesson["published_at"])
        self.assertEqual(stored["teacher_id"], "teacher-1")
        self.assertEqual(stored["status"], "draft")

    def test_teacher_can_list_owned_lessons_with_active_assignment(self):
        self.add_lesson("owned-draft")
        self.add_lesson("other-teacher", teacher_id="teacher-2")
        self.add_lesson("unassigned", class_id="class-2")

        response = self.client.get("/api/lessons", headers=self.headers())

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()], ["owned-draft"])

    def test_teacher_can_retrieve_owned_lesson(self):
        self.add_lesson()

        response = self.client.get("/api/lessons/lesson-1", headers=self.headers())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "lesson-1")

    def test_teacher_can_update_lesson(self):
        self.add_lesson()

        response = self.client.patch(
            "/api/lessons/lesson-1",
            json={"class_id": "class-1", "title": "Updated fractions"},
            headers=self.headers(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Updated fractions")
        self.assertEqual(response.json()["updated_at"], NOW_JSON)

    def test_teacher_can_publish_and_unpublish_lesson(self):
        self.add_lesson()

        published = self.client.post(
            "/api/lessons/lesson-1/publish",
            headers=self.headers(),
        )
        self.assertEqual(published.status_code, 200)
        self.assertEqual(published.json()["status"], "published")
        self.assertEqual(published.json()["published_at"], NOW_JSON)

        unpublished = self.client.post(
            "/api/lessons/lesson-1/unpublish",
            headers=self.headers(),
        )
        self.assertEqual(unpublished.status_code, 200)
        self.assertEqual(unpublished.json()["status"], "draft")
        self.assertIsNone(unpublished.json()["published_at"])

    def test_teacher_can_delete_owned_lesson(self):
        self.add_lesson()

        response = self.client.delete(
            "/api/lessons/lesson-1",
            headers=self.headers(),
        )

        self.assertEqual(response.status_code, 204)
        self.assertNotIn("lesson-1", self.database.collection("lessons").documents)

    def test_teacher_cannot_manage_another_teachers_lesson(self):
        self.add_lesson(teacher_id="teacher-2")
        requests = (
            ("get", "/api/lessons/lesson-1", None),
            (
                "patch",
                "/api/lessons/lesson-1",
                {"class_id": "class-1", "title": "Tampered"},
            ),
            ("post", "/api/lessons/lesson-1/publish", None),
            ("post", "/api/lessons/lesson-1/unpublish", None),
            ("delete", "/api/lessons/lesson-1", None),
        )
        for method, path, body in requests:
            with self.subTest(method=method, path=path):
                response = self.client.request(
                    method.upper(),
                    path,
                    json=body if body is not None else None,
                    headers=self.headers("teacher-1"),
                )
                self.assertIn(response.status_code, (403, 404))
        self.assertIn("lesson-1", self.database.collection("lessons").documents)

    def test_teacher_loses_management_access_when_assignment_is_inactive(self):
        self.add_lesson()
        self.database.collection("class_teacher_assignments").documents[
            "class-1-subject-1-teacher-1"
        ]["status"] = "inactive"
        requests = (
            ("get", "/api/lessons/lesson-1", None),
            (
                "patch",
                "/api/lessons/lesson-1",
                {"class_id": "class-1", "title": "Tampered"},
            ),
            ("post", "/api/lessons/lesson-1/publish", None),
            ("post", "/api/lessons/lesson-1/unpublish", None),
            ("delete", "/api/lessons/lesson-1", None),
        )
        for method, path, body in requests:
            with self.subTest(method=method, path=path):
                response = self.client.request(
                    method.upper(),
                    path,
                    json=body if body is not None else None,
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 403)
        self.assertIn("lesson-1", self.database.collection("lessons").documents)

    def test_teacher_operations_require_active_profile_and_auth_account(self):
        cases = (
            (
                "inactive_profile",
                lambda: self.database.collection("users").documents[
                    "teacher-1"
                ].update({"status": "inactive"}),
            ),
            (
                "wrong_profile_role",
                lambda: self.database.collection("users").documents[
                    "teacher-1"
                ].update({"role": "student"}),
            ),
            (
                "missing_profile",
                lambda: self.database.collection("users").documents.pop("teacher-1"),
            ),
            (
                "disabled_auth_account",
                lambda: setattr(self.accounts["teacher-1"], "disabled", True),
            ),
            ("missing_auth_account", lambda: self.accounts.pop("teacher-1")),
        )
        for name, deactivate in cases:
            with self.subTest(name=name):
                self.database.collection("users").documents["teacher-1"] = {
                    "uid": "teacher-1",
                    "role": "teacher",
                    "status": "active",
                }
                self.accounts["teacher-1"] = SimpleNamespace(
                    uid="teacher-1",
                    disabled=False,
                )
                deactivate()
                requests = (
                    ("post", "/api/lessons", CREATE_BODY),
                    ("get", "/api/lessons/lesson-1", None),
                    (
                        "patch",
                        "/api/lessons/lesson-1",
                        {"class_id": "class-1", "title": "Changed"},
                    ),
                    ("post", "/api/lessons/lesson-1/publish", None),
                    ("post", "/api/lessons/lesson-1/unpublish", None),
                    ("delete", "/api/lessons/lesson-1", None),
                )
                for method, path, body in requests:
                    self.add_lesson()
                    with self.subTest(method=method, path=path):
                        response = self.client.request(
                            method.upper(),
                            path,
                            json=body,
                            headers=self.headers(),
                        )
                        self.assertEqual(response.status_code, 403)
                        self.assertIn(
                            "lesson-1",
                            self.database.collection("lessons").documents,
                        )

    def test_teacher_requires_subject_eligibility_and_active_matching_assignment(self):
        self.add_subject("subject-ineligible", ["teacher-2"])
        self.add_subject("subject-inactive", ["teacher-1"], status="inactive")
        self.add_class("class-inactive", status="inactive")
        cases = (
            ("subject_ineligible", "class-1", "subject-ineligible"),
            ("subject_inactive", "class-1", "subject-inactive"),
            ("class_inactive", "class-inactive", "subject-1"),
            ("class_missing", "missing-class", "subject-1"),
            ("subject_missing", "class-1", "missing-subject"),
            ("assignment_wrong_class", "class-2", "subject-1"),
            ("assignment_wrong_subject", "class-1", "subject-2"),
        )
        for name, class_id, subject_id in cases:
            with self.subTest(name=name):
                response = self.client.post(
                    "/api/lessons",
                    json={**CREATE_BODY, "class_id": class_id, "subject_id": subject_id},
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.database.collection("lessons").documents, {})

    def test_teacher_cannot_change_to_unauthorized_destination_class_or_subject(self):
        self.add_lesson()
        self.add_subject("subject-ineligible", ["teacher-2"])
        self.add_class("class-unauthorized")
        requests = (
            {"class_id": "class-2"},
            {"class_id": "class-1", "subject_id": "subject-ineligible"},
            {"class_id": "class-1", "subject_id": "subject-2"},
            {"class_id": "class-unauthorized"},
        )
        for changes in requests:
            with self.subTest(changes=changes):
                response = self.client.patch(
                    "/api/lessons/lesson-1",
                    json=changes,
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 403)
                stored = self.database.collection("lessons").documents["lesson-1"]
                self.assertEqual(stored["class_id"], "class-1")
                self.assertEqual(stored["subject_id"], "subject-1")

    def test_teacher_can_change_to_authorized_destination_class_and_subject(self):
        self.add_assignment("class-2", "subject-2", "teacher-1")
        self.add_lesson()

        response = self.client.patch(
            "/api/lessons/lesson-1",
            json={"class_id": "class-2", "subject_id": "subject-2"},
            headers=self.headers(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["class_id"], "class-2")
        self.assertEqual(response.json()["subject_id"], "subject-2")

    def test_student_lists_only_published_lessons_for_active_authorized_memberships(self):
        self.add_membership()
        self.add_lesson("published", status="published")
        self.add_lesson("draft", status="draft")
        self.add_lesson("unrelated-class", class_id="class-2", status="published")
        self.add_assignment("class-2", "subject-1", "teacher-1")
        self.add_membership("class-2", status="inactive")

        response = self.client.get(
            "/api/lessons",
            headers=self.headers("student-1"),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()], ["published"])

    def test_student_can_retrieve_published_lesson_with_valid_membership_and_assignment(self):
        self.add_membership()
        self.add_lesson(status="published")

        response = self.client.get(
            "/api/lessons/lesson-1",
            headers=self.headers("student-1"),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "published")

    def test_student_cannot_read_draft_or_unavailable_lesson(self):
        self.add_membership()
        self.add_lesson("draft")
        self.add_lesson(
            "inactive-class",
            class_id="class-inactive",
            status="published",
        )
        self.add_lesson(
            "inactive-subject",
            subject_id="subject-inactive",
            status="published",
        )
        self.add_class("class-inactive", status="inactive")
        self.add_subject("subject-inactive", ["teacher-1"], status="inactive")
        cases = (
            ("lesson-1", "draft"),
            ("inactive-class", "published"),
            ("inactive-subject", "published"),
        )
        for lesson_id, expected_status in cases:
            if expected_status == "published" and lesson_id != "lesson-1":
                self.add_membership(
                    "class-inactive" if lesson_id == "inactive-class" else "class-1"
                )
            response = self.client.get(
                f"/api/lessons/{lesson_id}",
                headers=self.headers("student-1"),
            )
            self.assertEqual(response.status_code, 404)

    def test_student_requires_active_membership_and_matching_active_assignment(self):
        self.add_lesson(status="published")
        self.add_membership(status="inactive")
        no_membership = self.client.get(
            "/api/lessons/lesson-1",
            headers=self.headers("student-1"),
        )
        self.assertEqual(no_membership.status_code, 404)

        self.add_membership(status="active")
        self.database.collection("class_teacher_assignments").documents.clear()
        no_assignment = self.client.get(
            "/api/lessons/lesson-1",
            headers=self.headers("student-1"),
        )
        self.assertEqual(no_assignment.status_code, 404)

    def test_student_requires_active_account_profile(self):
        self.add_membership()
        self.add_lesson(status="published")
        self.database.collection("users").documents["student-1"]["status"] = "inactive"

        response = self.client.get(
            "/api/lessons",
            headers=self.headers("student-1"),
        )

        self.assertEqual(response.status_code, 403)

    def test_student_and_admin_cannot_perform_teacher_operations(self):
        self.add_lesson()
        for uid in ("student-1", "admin-1"):
            requests = (
                ("post", "/api/lessons", CREATE_BODY),
                (
                    "patch",
                    "/api/lessons/lesson-1",
                    {"class_id": "class-1", "title": "No access"},
                ),
                ("post", "/api/lessons/lesson-1/publish", None),
                ("post", "/api/lessons/lesson-1/unpublish", None),
                ("delete", "/api/lessons/lesson-1", None),
            )
            for method, path, body in requests:
                with self.subTest(uid=uid, method=method, path=path):
                    response = self.client.request(
                        method.upper(),
                        path,
                        json=body,
                        headers=self.headers(uid),
                    )
                    self.assertEqual(response.status_code, 403)
        self.assertIn("lesson-1", self.database.collection("lessons").documents)

    def test_admin_receives_no_lesson_read_access(self):
        self.add_lesson()
        list_response = self.client.get(
            "/api/lessons",
            headers=self.headers("admin-1"),
        )
        detail_response = self.client.get(
            "/api/lessons/lesson-1",
            headers=self.headers("admin-1"),
        )
        self.assertEqual(list_response.status_code, 403)
        self.assertEqual(detail_response.status_code, 403)

    def test_missing_and_malformed_lesson_ids_return_errors(self):
        missing = self.client.get("/api/lessons/not-found", headers=self.headers())
        malformed = self.client.get(
            "/api/lessons/__invalid__",
            headers=self.headers(),
        )
        nested = self.client.get(
            "/api/lessons/nested%2Flesson",
            headers=self.headers(),
        )

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(malformed.status_code, 422)
        self.assertIn(nested.status_code, (404, 422))

    def test_request_bodies_cannot_overwrite_server_managed_fields(self):
        forbidden_fields = (
            "teacher_id",
            "status",
            "created_at",
            "updated_at",
            "published_at",
        )
        for field in forbidden_fields:
            with self.subTest(method="post", field=field):
                response = self.client.post(
                    "/api/lessons",
                    json={**CREATE_BODY, field: "untrusted"},
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 422)
        self.add_lesson()
        before = dict(self.database.collection("lessons").documents["lesson-1"])
        for field in forbidden_fields:
            with self.subTest(method="patch", field=field):
                response = self.client.patch(
                    "/api/lessons/lesson-1",
                    json={"class_id": "class-1", "title": "Changed", field: "untrusted"},
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(
            self.database.collection("lessons").documents["lesson-1"],
            before,
        )
        self.assertEqual(
            self.database.collection("lessons").documents.keys(),
            {"lesson-1"},
        )


if __name__ == "__main__":
    unittest.main()
