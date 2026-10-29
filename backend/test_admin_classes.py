import importlib
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.api import admin_classes

class_models = importlib.import_module("app.models.class")

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


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

    def get(self, transaction=None):
        _ = transaction
        return FakeSnapshot(self.id, self.collection.documents.get(self.id))

    def create(self, data):
        if self.id in self.collection.documents:
            from google.api_core.exceptions import AlreadyExists

            raise AlreadyExists("document already exists")
        self.collection.documents[self.id] = self.collection.database.resolve_values(
            data
        )

    def update(self, changes):
        if self.id not in self.collection.documents:
            from google.api_core.exceptions import NotFound

            raise NotFound("document not found")
        self.collection.documents[self.id].update(
            self.collection.database.resolve_values(changes)
        )


class FakeQuery:
    def __init__(self, collection, field, expected):
        self.collection = collection
        self.field = field
        self.expected = expected

    def stream(self):
        return [
            FakeSnapshot(document_id, data)
            for document_id, data in self.collection.documents.items()
            if data.get(self.field) == self.expected
        ]


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

    def stream(self):
        return [
            FakeSnapshot(document_id, data)
            for document_id, data in self.documents.items()
        ]

    def where(self, field, operator, expected):
        if operator != "==":
            raise AssertionError(f"Unsupported test query operator: {operator}")
        return FakeQuery(self, field, expected)


class FakeDatabase:
    def __init__(self):
        self.documents = {}
        self.next_id = 1

    def collection(self, name):
        return FakeCollection(self, name)

    def transaction(self):
        return FakeTransaction()

    @staticmethod
    def resolve_values(values):
        return {
            key: NOW if value is admin_classes.SERVER_TIMESTAMP else value
            for key, value in values.items()
        }


class FakeTransaction:
    def create(self, document_reference, data):
        document_reference.create(data)

    def update(self, document_reference, changes):
        document_reference.update(changes)


class AdminClassApiTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase()
        self.accounts = {
            "teacher-1": SimpleNamespace(
                uid="teacher-1",
                disabled=False,
                custom_claims={"role": "teacher"},
            ),
            "teacher-2": SimpleNamespace(
                uid="teacher-2",
                disabled=False,
                custom_claims={"role": "teacher"},
            ),
            "student-1": SimpleNamespace(
                uid="student-1",
                disabled=False,
                custom_claims={"role": "student"},
            ),
            "student-2": SimpleNamespace(
                uid="student-2",
                disabled=False,
                custom_claims={"role": "student"},
            ),
        }
        self.database.collection("users").documents.update(
            {
                "teacher-1": {
                    "uid": "teacher-1",
                    "role": "teacher",
                    "status": "active",
                },
                "teacher-2": {
                    "uid": "teacher-2",
                    "role": "teacher",
                    "status": "active",
                },
                "student-1": {
                    "uid": "student-1",
                    "role": "student",
                    "status": "active",
                },
                "student-2": {
                    "uid": "student-2",
                    "role": "student",
                    "status": "active",
                },
            }
        )
        self.get_database_patch = patch.object(
            admin_classes, "get_database", return_value=self.database
        )
        self.get_user_patch = patch.object(
            admin_classes.firebase_auth,
            "get_user",
            side_effect=self.get_account,
        )
        self.transactional_patch = patch.object(
            admin_classes.firestore,
            "transactional",
            side_effect=lambda callback: callback,
        )
        self.get_database_patch.start()
        self.get_user_patch.start()
        self.transactional_patch.start()
        self.addCleanup(self.get_database_patch.stop)
        self.addCleanup(self.get_user_patch.stop)
        self.addCleanup(self.transactional_patch.stop)

        app = FastAPI()
        app.include_router(admin_classes.router, prefix="/api")
        app.include_router(admin_classes.teacher_router, prefix="/api")
        app.dependency_overrides[
            admin_classes.verify_firebase_token
        ] = self.mock_verify_firebase_token
        self.client = TestClient(app)
        self.addCleanup(app.dependency_overrides.clear)

    def mock_verify_firebase_token(self, request: Request):
        authorization = request.headers.get("authorization", "")
        token = authorization.removeprefix("Bearer ").strip()
        roles = {
            "admin-1": "admin",
            "teacher-1": "teacher",
            "teacher-2": "teacher",
            "student-1": "student",
            "student-2": "student",
        }
        if token not in roles:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        return {"uid": token, "role": roles[token]}

    @staticmethod
    def headers(uid):
        return {"Authorization": f"Bearer {uid}"}

    def get_account(self, uid):
        try:
            return self.accounts[uid]
        except KeyError:
            raise admin_classes.firebase_auth.UserNotFoundError(
                "user not found", uid
            ) from None

    def add_class(self, class_id="class-1", status="active"):
        data = {
            "name": "Grade 1 - Mabini",
            "grade_level": "Grade 1",
            "section": "Mabini",
            "status": status,
            "lead_teacher_uid": None,
            "created_at": NOW,
            "updated_at": NOW,
        }
        self.database.collection("classes").documents[class_id] = data
        return data

    def add_subject(
        self,
        subject_id="subject-1",
        teacher_ids=None,
        status="active",
        grade_levels=None,
    ):
        self.database.collection("subjects").documents[subject_id] = {
            "name": "Mathematics",
            "code": "MATH",
            "status": status,
            "teacher_ids": teacher_ids if teacher_ids is not None else ["teacher-1"],
            "grade_levels": grade_levels if grade_levels is not None else ["Grade 1"],
        }

    def test_all_routes_require_admin(self):
        self.assertTrue(admin_classes.router.dependencies)
        self.assertIs(
            admin_classes.router.dependencies[0].dependency,
            admin_classes.require_admin,
        )
        self.assertFalse(admin_classes.teacher_router.dependencies)

    def test_teacher_class_route_authorizes_teacher_and_keeps_admin_routes_protected(self):
        teacher_routes = [
            route.path
            for route in admin_classes.teacher_router.routes
            if route.path == "/teacher/classes"
        ]
        self.assertEqual(teacher_routes, ["/teacher/classes"])

        self.add_class("class-1")
        self.add_class("class-2")
        self.add_subject("subject-1", teacher_ids=["teacher-1"])
        self.add_subject("subject-2", teacher_ids=["teacher-2"])
        self.database.collection("class_teacher_assignments").documents.update(
            {
                "tsa-1": {
                    "class_id": "class-1",
                    "subject_id": "subject-1",
                    "teacher_uid": "teacher-1",
                    "status": "active",
                    "created_at": NOW,
                    "updated_at": NOW,
                },
                "tsa-2": {
                    "class_id": "class-2",
                    "subject_id": "subject-2",
                    "teacher_uid": "teacher-2",
                    "status": "active",
                    "created_at": NOW,
                    "updated_at": NOW,
                },
            }
        )

        teacher_response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(teacher_response.status_code, 200)
        self.assertEqual(
            [school_class["id"] for school_class in teacher_response.json()],
            ["class-1"],
        )

        unauthenticated_response = self.client.get("/api/teacher/classes")
        self.assertEqual(unauthenticated_response.status_code, 401)

        non_teacher_response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("student-1"),
        )
        self.assertEqual(non_teacher_response.status_code, 403)

        admin_endpoint_as_teacher = self.client.get(
            "/api/admin/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(admin_endpoint_as_teacher.status_code, 403)

        admin_endpoint_as_admin = self.client.get(
            "/api/admin/classes",
            headers=self.headers("admin-1"),
        )
        self.assertEqual(admin_endpoint_as_admin.status_code, 200)

    def test_create_class_sets_server_timestamps_and_returns_valid_response(self):
        request = class_models.ClassCreateRequest.model_validate(
            {"name": "Class A", "grade_level": "Grade 1", "section": "A"}
        )
        response = admin_classes.create_class(request)

        self.assertEqual(response.id, "generated-1")
        self.assertEqual(response.status, "active")
        self.assertEqual(response.created_at, NOW)
        self.assertEqual(response.updated_at, NOW)

    def test_create_class_validates_optional_lead_teacher(self):
        request = class_models.ClassCreateRequest.model_validate(
            {
                "name": "Class A",
                "grade_level": "Grade 1",
                "section": "A",
                "lead_teacher_uid": "teacher-1",
            }
        )
        response = admin_classes.create_class(request)
        self.assertEqual(response.lead_teacher_uid, "teacher-1")

    def test_create_class_rejects_invalid_lead_teacher(self):
        request = class_models.ClassCreateRequest.model_validate(
            {
                "name": "Class A",
                "grade_level": "Grade 1",
                "section": "A",
                "lead_teacher_uid": "student-1",
            }
        )
        with self.assertRaises(HTTPException) as error:
            admin_classes.create_class(request)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(self.database.collection("classes").documents, {})

    def test_disabled_teacher_cannot_become_lead_teacher(self):
        self.accounts["teacher-1"].disabled = True
        request = class_models.ClassCreateRequest.model_validate(
            {
                "name": "Class A",
                "grade_level": "Grade 1",
                "section": "A",
                "lead_teacher_uid": "teacher-1",
            }
        )

        with self.assertRaises(HTTPException) as error:
            admin_classes.create_class(request)

        self.assertEqual(error.exception.status_code, 422)

    def test_class_list_has_deterministic_order(self):
        self.add_class("class-z")
        second = self.add_class("class-b")
        second.update({"grade_level": "Grade 2", "section": "B"})
        third = self.add_class("class-a")
        third.update({"section": "A"})

        result = admin_classes.list_classes()

        self.assertEqual([item.id for item in result], ["class-a", "class-z", "class-b"])

    def test_teacher_class_list_returns_only_active_teacher_classes(self):
        self.add_class("class-1")
        self.add_class("class-2")
        self.add_subject("subject-1", teacher_ids=["teacher-1"])
        self.add_subject("subject-2", teacher_ids=["teacher-2"])
        self.database.collection("class_teacher_assignments").documents["tsa-1"] = {
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_uid": "teacher-1",
            "status": "active",
            "created_at": NOW,
            "updated_at": NOW,
        }
        self.database.collection("class_teacher_assignments").documents["tsa-2"] = {
            "class_id": "class-2",
            "subject_id": "subject-2",
            "teacher_uid": "teacher-2",
            "status": "active",
            "created_at": NOW,
            "updated_at": NOW,
        }
        self.database.collection("class_memberships").documents["mem-1"] = {
            "class_id": "class-1",
            "student_uid": "student-1",
            "status": "active",
            "created_at": NOW,
            "updated_at": NOW,
        }
        self.database.collection("users").documents["student-1"] = {
            "uid": "student-1",
            "name": "Student One",
            "role": "student",
            "status": "active",
            "grade_level": "Grade 1",
            "section": "Mabini",
        }

        result = admin_classes.list_teacher_classes({"uid": "teacher-1", "role": "teacher"})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "class-1")
        self.assertFalse(result[0]["is_adviser"])
        self.assertEqual(result[0]["student_count"], 1)
        self.assertEqual(result[0]["assigned_subjects"][0]["code"], "MATH")

    def test_teacher_can_advise_one_section_and_teach_another(self):
        advisory_class = self.add_class("class-rizal")
        advisory_class.update(
            {
                "name": "Grade 1 - Rizal",
                "grade_level": "Grade 1",
                "section": "Rizal",
                "lead_teacher_uid": "teacher-1",
            }
        )
        science_class = self.add_class("class-grade-2")
        science_class.update(
            {
                "name": "Grade 2 - Mabini",
                "grade_level": "Grade 2",
                "section": "Mabini",
            }
        )
        self.add_subject(
            "science",
            teacher_ids=["teacher-1"],
            grade_levels=["Grade 2"],
        )
        self.database.collection("subjects").documents["science"].update(
            {"name": "Science", "code": "101"}
        )

        assignment_response = self.client.post(
            "/api/admin/classes/class-grade-2/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": "class-grade-2",
                "subject_id": "science",
                "teacher_uid": "teacher-1",
            },
        )
        self.assertEqual(assignment_response.status_code, 200)

        for class_id, student_uid in (
            ("class-rizal", "student-1"),
            ("class-grade-2", "student-1"),
            ("class-grade-2", "student-2"),
        ):
            membership_response = self.client.post(
                f"/api/admin/classes/{class_id}/memberships",
                headers=self.headers("admin-1"),
                json={
                    "class_id": class_id,
                    "student_uid": student_uid,
                    "status": "active",
                },
            )
            self.assertEqual(membership_response.status_code, 200)

        self.database.collection("class_memberships").documents[
            "legacy-duplicate-membership"
        ] = {
            "class_id": "class-grade-2",
            "student_uid": "student-2",
            "status": "active",
            "created_at": NOW,
            "updated_at": NOW,
        }

        response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(response.status_code, 200)
        classes = {school_class["id"]: school_class for school_class in response.json()}
        self.assertEqual(set(classes), {"class-rizal", "class-grade-2"})
        self.assertTrue(classes["class-rizal"]["is_adviser"])
        self.assertEqual(classes["class-rizal"]["assigned_subjects"], [])
        self.assertFalse(classes["class-grade-2"]["is_adviser"])
        self.assertEqual(classes["class-grade-2"]["student_count"], 2)
        self.assertEqual(
            [subject["id"] for subject in classes["class-grade-2"]["assigned_subjects"]],
            ["science"],
        )

    def test_assignment_deactivation_and_reassignment_update_dashboard(self):
        self.add_class("class-1")
        self.add_subject(
            teacher_ids=["teacher-1", "teacher-2"],
            grade_levels=["Grade 1"],
        )
        create_response = self.client.post(
            "/api/admin/classes/class-1/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            },
        )
        assignment_id = create_response.json()["id"]
        teacher_one_before = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(len(teacher_one_before.json()), 1)

        deactivate_response = self.client.delete(
            f"/api/admin/classes/class-1/teacher-assignments/{assignment_id}",
            headers=self.headers("admin-1"),
        )
        self.assertEqual(deactivate_response.status_code, 200)
        teacher_one_after = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(teacher_one_after.json(), [])

        reassignment_response = self.client.post(
            "/api/admin/classes/class-1/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-2",
            },
        )
        self.assertEqual(reassignment_response.status_code, 200)
        teacher_two = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-2"),
        )
        self.assertEqual(
            [school_class["id"] for school_class in teacher_two.json()],
            ["class-1"],
        )
        self.assertEqual(
            [subject["id"] for subject in teacher_two.json()[0]["assigned_subjects"]],
            ["subject-1"],
        )

    def test_teacher_can_have_multiple_subjects_across_multiple_sections(self):
        self.add_class("class-grade-1")
        grade_two = self.add_class("class-grade-2")
        grade_two.update(
            {
                "name": "Grade 2 - Mabini",
                "grade_level": "Grade 2",
                "section": "Mabini",
            }
        )
        self.add_subject(
            "english",
            teacher_ids=["teacher-1"],
            grade_levels=["Grade 1"],
        )
        self.add_subject(
            "science",
            teacher_ids=["teacher-1"],
            grade_levels=["Grade 2"],
        )

        payloads = (
            ("class-grade-1", "english"),
            ("class-grade-2", "science"),
        )
        for class_id, subject_id in payloads:
            response = self.client.post(
                f"/api/admin/classes/{class_id}/teacher-assignments",
                headers=self.headers("admin-1"),
                json={
                    "class_id": class_id,
                    "subject_id": subject_id,
                    "teacher_uid": "teacher-1",
                },
            )
            self.assertEqual(response.status_code, 200)

        response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(response.status_code, 200)
        teacher_classes = response.json()
        self.assertEqual(
            {school_class["id"] for school_class in teacher_classes},
            {"class-grade-1", "class-grade-2"},
        )
        self.assertEqual(
            {
                subject["id"]
                for school_class in teacher_classes
                for subject in school_class["assigned_subjects"]
            },
            {"english", "science"},
        )

    def test_teacher_endpoint_excludes_invalid_subject_ownership_or_grade(self):
        self.add_class("class-1")
        self.add_subject(teacher_ids=["teacher-1"], grade_levels=["Grade 1"])
        assignment = self.client.post(
            "/api/admin/classes/class-1/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            },
        )
        self.assertEqual(assignment.status_code, 200)

        subject = self.database.collection("subjects").documents["subject-1"]
        subject["teacher_ids"] = ["teacher-2"]
        response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(response.json(), [])

        subject["teacher_ids"] = ["teacher-1"]
        subject["grade_levels"] = ["Grade 2"]
        response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(response.json(), [])

    def test_advisory_classes_are_distinct_from_subject_teaching_classes(self):
        self.add_subject(
            teacher_ids=["teacher-1", "teacher-2"],
            grade_levels=["Grade 1", "Grade 2"],
        )
        advisory_response = self.client.post(
            "/api/admin/classes",
            headers=self.headers("admin-1"),
            json={
                "name": "Grade 1 - Mabini",
                "grade_level": "Grade 1",
                "section": "Mabini",
                "status": "active",
                "lead_teacher_uid": "teacher-1",
            },
        )
        self.assertEqual(advisory_response.status_code, 201)
        advisory_class_id = advisory_response.json()["id"]

        subject_class_response = self.client.post(
            "/api/admin/classes",
            headers=self.headers("admin-1"),
            json={
                "name": "Grade 2 - Rizal",
                "grade_level": "Grade 2",
                "section": "Rizal",
                "status": "active",
            },
        )
        self.assertEqual(subject_class_response.status_code, 201)
        subject_class_id = subject_class_response.json()["id"]

        teacher_one_subject_assignment = self.client.post(
            f"/api/admin/classes/{subject_class_id}/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": subject_class_id,
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
                "status": "active",
            },
        )
        self.assertEqual(teacher_one_subject_assignment.status_code, 200)
        teacher_two_subject_assignment = self.client.post(
            f"/api/admin/classes/{advisory_class_id}/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": advisory_class_id,
                "subject_id": "subject-1",
                "teacher_uid": "teacher-2",
                "status": "active",
            },
        )
        self.assertEqual(teacher_two_subject_assignment.status_code, 200)

        teacher_one_classes = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        ).json()
        teacher_one_by_id = {item["id"]: item for item in teacher_one_classes}
        self.assertTrue(teacher_one_by_id[advisory_class_id]["is_adviser"])
        self.assertEqual(
            teacher_one_by_id[advisory_class_id]["assigned_subjects"],
            [],
        )
        self.assertFalse(teacher_one_by_id[subject_class_id]["is_adviser"])
        self.assertEqual(
            [item["id"] for item in teacher_one_by_id[subject_class_id]["assigned_subjects"]],
            ["subject-1"],
        )

        teacher_two_classes = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-2"),
        ).json()
        teacher_two_advisory_class = next(
            item for item in teacher_two_classes if item["id"] == advisory_class_id
        )
        self.assertFalse(teacher_two_advisory_class["is_adviser"])
        self.assertEqual(
            [item["id"] for item in teacher_two_advisory_class["assigned_subjects"]],
            ["subject-1"],
        )

    def test_admin_created_class_and_relationships_are_visible_to_assigned_teacher(self):
        self.add_subject(teacher_ids=["teacher-1", "teacher-2"])
        self.add_subject(
            "subject-inactive",
            teacher_ids=["teacher-1"],
            status="inactive",
        )

        create_response = self.client.post(
            "/api/admin/classes",
            headers=self.headers("admin-1"),
            json={
                "name": "Grade 1 - Mabini",
                "grade_level": "Grade 1",
                "section": "Mabini",
                "status": "active",
                "lead_teacher_uid": "teacher-1",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        class_id = create_response.json()["id"]

        schedule_response = self.client.patch(
            f"/api/admin/classes/{class_id}",
            headers=self.headers("admin-1"),
            json={
                "schedule": [
                    {
                        "id": "schedule-1",
                        "day": "Monday",
                        "start_time": "09:00",
                        "end_time": "10:00",
                        "subject_id": "subject-1",
                        "teacher_uid": "teacher-1",
                    }
                ]
            },
        )
        self.assertEqual(schedule_response.status_code, 200)
        self.assertEqual(
            schedule_response.json()["schedule"][0]["subject_id"],
            "subject-1",
        )
        self.assertEqual(
            schedule_response.json()["schedule"][0]["start_time"],
            "09:00",
        )

        active_assignment = self.client.post(
            f"/api/admin/classes/{class_id}/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": class_id,
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
                "status": "active",
            },
        )
        self.assertEqual(active_assignment.status_code, 200)
        inactive_assignment = self.client.post(
            f"/api/admin/classes/{class_id}/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": class_id,
                "subject_id": "subject-1",
                "teacher_uid": "teacher-2",
                "status": "inactive",
            },
        )
        self.assertEqual(inactive_assignment.status_code, 200)

        active_membership = self.client.post(
            f"/api/admin/classes/{class_id}/memberships",
            headers=self.headers("admin-1"),
            json={
                "class_id": class_id,
                "student_uid": "student-1",
                "status": "active",
            },
        )
        self.assertEqual(active_membership.status_code, 200)
        inactive_membership = self.client.post(
            f"/api/admin/classes/{class_id}/memberships",
            headers=self.headers("admin-1"),
            json={
                "class_id": class_id,
                "student_uid": "student-2",
                "status": "inactive",
            },
        )
        self.assertEqual(inactive_membership.status_code, 200)

        self.database.collection("class_teacher_assignments").documents[
            "inactive-subject-assignment"
        ] = {
            "class_id": class_id,
            "subject_id": "subject-inactive",
            "teacher_uid": "teacher-1",
            "status": "active",
            "created_at": NOW,
            "updated_at": NOW,
        }

        teacher_one_response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(teacher_one_response.status_code, 200)
        teacher_one_classes = teacher_one_response.json()
        self.assertEqual([item["id"] for item in teacher_one_classes], [class_id])
        self.assertEqual(teacher_one_classes[0]["student_count"], 1)
        self.assertTrue(teacher_one_classes[0]["is_adviser"])
        self.assertEqual(
            [item["id"] for item in teacher_one_classes[0]["assigned_subjects"]],
            ["subject-1"],
        )

        reassign_response = self.client.patch(
            f"/api/admin/classes/{class_id}",
            headers=self.headers("admin-1"),
            json={"lead_teacher_uid": "teacher-2"},
        )
        self.assertEqual(reassign_response.status_code, 200)

        deactivate_assignment = self.client.delete(
            f"/api/admin/classes/{class_id}/teacher-assignments/{active_assignment.json()['id']}",
            headers=self.headers("admin-1"),
        )
        self.assertEqual(deactivate_assignment.status_code, 200)
        deactivate_inactive_subject_assignment = self.client.delete(
            f"/api/admin/classes/{class_id}/teacher-assignments/inactive-subject-assignment",
            headers=self.headers("admin-1"),
        )
        self.assertEqual(deactivate_inactive_subject_assignment.status_code, 200)
        teacher_one_after_reassignment = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(teacher_one_after_reassignment.json(), [])

        teacher_two_before_assignment = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-2"),
        )
        self.assertEqual(teacher_two_before_assignment.status_code, 200)
        self.assertEqual(
            teacher_two_before_assignment.json()[0]["assigned_subjects"],
            [],
        )
        self.assertTrue(
            teacher_two_before_assignment.json()[0]["is_adviser"]
        )

        reactivate_assignment = self.client.post(
            f"/api/admin/classes/{class_id}/teacher-assignments",
            headers=self.headers("admin-1"),
            json={
                "class_id": class_id,
                "subject_id": "subject-1",
                "teacher_uid": "teacher-2",
                "status": "active",
            },
        )
        self.assertEqual(reactivate_assignment.status_code, 200)
        teacher_two_response = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-2"),
        )
        self.assertEqual(teacher_two_response.status_code, 200)
        self.assertTrue(teacher_two_response.json()[0]["is_adviser"])
        self.assertEqual(
            [item["id"] for item in teacher_two_response.json()[0]["assigned_subjects"]],
            ["subject-1"],
        )
        self.assertEqual(teacher_two_response.json()[0]["student_count"], 1)

        deactivate_class = self.client.patch(
            f"/api/admin/classes/{class_id}",
            headers=self.headers("admin-1"),
            json={"status": "inactive"},
        )
        self.assertEqual(deactivate_class.status_code, 200)
        teacher_two_after_deactivation = self.client.get(
            "/api/teacher/classes",
            headers=self.headers("teacher-2"),
        )
        self.assertEqual(teacher_two_after_deactivation.status_code, 200)
        self.assertEqual(teacher_two_after_deactivation.json(), [])

    def test_api_rejects_disabled_or_non_teacher_adviser(self):
        create_payload = {
            "name": "Grade 1 - Mabini",
            "grade_level": "Grade 1",
            "section": "Mabini",
            "status": "active",
        }

        non_teacher_response = self.client.post(
            "/api/admin/classes",
            headers=self.headers("admin-1"),
            json={**create_payload, "lead_teacher_uid": "student-1"},
        )
        self.assertEqual(non_teacher_response.status_code, 422)

        self.accounts["teacher-1"].disabled = True
        disabled_teacher_response = self.client.post(
            "/api/admin/classes",
            headers=self.headers("admin-1"),
            json={**create_payload, "lead_teacher_uid": "teacher-1"},
        )
        self.assertEqual(disabled_teacher_response.status_code, 422)

    def test_get_class_returns_not_found_for_missing_document(self):
        with self.assertRaises(HTTPException) as error:
            admin_classes.get_class("missing-class")
        self.assertEqual(error.exception.status_code, 404)

    def test_invalid_firestore_document_id_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            admin_classes.get_class("nested/class")
        self.assertEqual(error.exception.status_code, 422)

    def test_update_class_preserves_omitted_fields_and_sets_timestamp(self):
        self.add_class()
        request = class_models.ClassUpdateRequest.model_validate(
            {"section": "Rizal"}
        )

        response = admin_classes.update_class("class-1", request)

        self.assertEqual(response.section, "Rizal")
        self.assertEqual(response.name, "Grade 1 - Mabini")
        self.assertEqual(response.updated_at, NOW)

    def test_schedule_update_rejects_overlapping_entries(self):
        self.add_class()
        self.add_subject()
        request = class_models.ClassUpdateRequest.model_validate(
            {
                "schedule": [
                    {
                        "id": "schedule-1",
                        "day": "Monday",
                        "start_time": "09:00",
                        "end_time": "10:00",
                        "subject_id": "subject-1",
                        "teacher_uid": "teacher-1",
                    },
                    {
                        "id": "schedule-2",
                        "day": "Monday",
                        "start_time": "09:30",
                        "end_time": "10:30",
                        "subject_id": "subject-1",
                        "teacher_uid": "teacher-1",
                    },
                ]
            }
        )

        with self.assertRaises(HTTPException) as error:
            admin_classes.update_class("class-1", request)

        self.assertEqual(error.exception.status_code, 422)
        self.assertNotIn(
            "schedule",
            self.database.collection("classes").documents["class-1"],
        )

    def test_update_class_validates_changed_lead_teacher(self):
        self.add_class()
        request = class_models.ClassUpdateRequest.model_validate(
            {"lead_teacher_uid": "student-1"}
        )
        with self.assertRaises(HTTPException) as error:
            admin_classes.update_class("class-1", request)
        self.assertEqual(error.exception.status_code, 422)

    def test_assignment_creation_and_repeat_are_idempotent(self):
        self.add_class()
        self.add_subject()
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )

        first = admin_classes.create_teacher_assignment("class-1", request)
        repeated = admin_classes.create_teacher_assignment("class-1", request)

        self.assertEqual(first.id, repeated.id)
        self.assertEqual(first.status, "active")
        self.assertEqual(
            len(self.database.collection("class_teacher_assignments").documents),
            1,
        )

    def test_assignment_can_be_reactivated_without_creating_a_duplicate(self):
        self.add_class()
        self.add_subject()
        request_data = {
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_uid": "teacher-1",
        }
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            request_data
        )
        assignment = admin_classes.create_teacher_assignment("class-1", request)
        admin_classes.deactivate_teacher_assignment("class-1", assignment.id)

        reactivated = admin_classes.create_teacher_assignment("class-1", request)

        self.assertEqual(reactivated.id, assignment.id)
        self.assertEqual(reactivated.status, "active")
        self.assertEqual(
            len(self.database.collection("class_teacher_assignments").documents),
            1,
        )

    def test_assignment_rejects_teacher_not_assigned_to_subject(self):
        self.add_class()
        self.add_subject(teacher_ids=["teacher-2"])
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )
        with self.assertRaises(HTTPException) as error:
            admin_classes.create_teacher_assignment("class-1", request)
        self.assertEqual(error.exception.status_code, 422)

    def test_assignment_rejects_inactive_class_or_subject(self):
        self.add_class(status="inactive")
        self.add_subject()
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )
        with self.assertRaises(HTTPException) as inactive_class:
            admin_classes.create_teacher_assignment("class-1", request)
        self.assertEqual(inactive_class.exception.status_code, 409)

        self.add_class(status="active")
        self.add_subject(status="inactive")
        with self.assertRaises(HTTPException) as inactive_subject:
            admin_classes.create_teacher_assignment("class-1", request)
        self.assertEqual(inactive_subject.exception.status_code, 422)

    def test_assignment_rejects_subject_for_another_grade_level(self):
        self.add_class()
        self.add_subject(grade_levels=["Grade 2"])
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )

        with self.assertRaises(HTTPException) as error:
            admin_classes.create_teacher_assignment("class-1", request)

        self.assertEqual(error.exception.status_code, 422)

    def test_assignment_path_and_request_class_must_match(self):
        self.add_class()
        self.add_subject()
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "different-class",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )
        with self.assertRaises(HTTPException) as error:
            admin_classes.create_teacher_assignment("class-1", request)
        self.assertEqual(error.exception.status_code, 422)

    def test_assignment_listing_is_scoped_to_class(self):
        self.add_class()
        self.add_subject()
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )
        admin_classes.create_teacher_assignment("class-1", request)
        self.add_class("class-2")

        result = admin_classes.list_teacher_assignments("class-2")

        self.assertEqual(result, [])

    def test_global_assignment_listing_is_admin_only_and_includes_status_history(self):
        self.add_class("class-1")
        self.add_subject()
        active = admin_classes.create_teacher_assignment(
            "class-1",
            class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
                {
                    "class_id": "class-1",
                    "subject_id": "subject-1",
                    "teacher_uid": "teacher-1",
                }
            ),
        )
        inactive = admin_classes.deactivate_teacher_assignment(
            "class-1", active.id
        )

        admin_response = self.client.get(
            "/api/admin/teacher-assignments",
            headers=self.headers("admin-1"),
        )
        self.assertEqual(admin_response.status_code, 200)
        self.assertEqual(len(admin_response.json()), 1)
        self.assertEqual(admin_response.json()[0]["id"], active.id)
        self.assertEqual(admin_response.json()[0]["status"], "inactive")

        teacher_response = self.client.get(
            "/api/admin/teacher-assignments",
            headers=self.headers("teacher-1"),
        )
        self.assertEqual(teacher_response.status_code, 403)
        unauthenticated_response = self.client.get(
            "/api/admin/teacher-assignments",
        )
        self.assertEqual(unauthenticated_response.status_code, 401)
        self.assertEqual(inactive.status, "inactive")

    def test_assignment_delete_deactivates_and_is_idempotent(self):
        self.add_class()
        self.add_subject()
        request = class_models.TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": "class-1",
                "subject_id": "subject-1",
                "teacher_uid": "teacher-1",
            }
        )
        assignment = admin_classes.create_teacher_assignment("class-1", request)

        first = admin_classes.deactivate_teacher_assignment(
            "class-1", assignment.id
        )
        second = admin_classes.deactivate_teacher_assignment(
            "class-1", assignment.id
        )

        self.assertEqual(first.status, "inactive")
        self.assertEqual(second.status, "inactive")

    def test_membership_creation_and_repeat_are_idempotent(self):
        self.add_class()
        request = class_models.StudentMembershipCreateRequest.model_validate(
            {"class_id": "class-1", "student_uid": "student-1"}
        )

        first = admin_classes.create_membership("class-1", request)
        repeated = admin_classes.create_membership("class-1", request)

        self.assertEqual(first.id, repeated.id)
        self.assertEqual(first.status, "active")
        self.assertEqual(
            len(self.database.collection("class_memberships").documents),
            1,
        )

    def test_membership_can_be_reactivated_without_creating_a_duplicate(self):
        self.add_class()
        request = class_models.StudentMembershipCreateRequest.model_validate(
            {"class_id": "class-1", "student_uid": "student-1"}
        )
        membership = admin_classes.create_membership("class-1", request)
        admin_classes.deactivate_membership("class-1", membership.id)

        reactivated = admin_classes.create_membership("class-1", request)

        self.assertEqual(reactivated.id, membership.id)
        self.assertEqual(reactivated.status, "active")
        self.assertEqual(
            len(self.database.collection("class_memberships").documents),
            1,
        )

    def test_membership_rejects_wrong_role_and_inactive_class(self):
        self.add_class()
        request = class_models.StudentMembershipCreateRequest.model_validate(
            {"class_id": "class-1", "student_uid": "teacher-1"}
        )
        with self.assertRaises(HTTPException) as wrong_role:
            admin_classes.create_membership("class-1", request)
        self.assertEqual(wrong_role.exception.status_code, 422)

        self.add_class(status="inactive")
        request = class_models.StudentMembershipCreateRequest.model_validate(
            {"class_id": "class-1", "student_uid": "student-1"}
        )
        with self.assertRaises(HTTPException) as inactive_class:
            admin_classes.create_membership("class-1", request)
        self.assertEqual(inactive_class.exception.status_code, 409)

    def test_membership_path_and_request_class_must_match(self):
        self.add_class()
        request = class_models.StudentMembershipCreateRequest.model_validate(
            {"class_id": "other-class", "student_uid": "student-1"}
        )
        with self.assertRaises(HTTPException) as error:
            admin_classes.create_membership("class-1", request)
        self.assertEqual(error.exception.status_code, 422)

    def test_membership_delete_deactivates_and_is_idempotent(self):
        self.add_class()
        request = class_models.StudentMembershipCreateRequest.model_validate(
            {"class_id": "class-1", "student_uid": "student-1"}
        )
        membership = admin_classes.create_membership("class-1", request)

        first = admin_classes.deactivate_membership("class-1", membership.id)
        second = admin_classes.deactivate_membership("class-1", membership.id)

        self.assertEqual(first.status, "inactive")
        self.assertEqual(second.status, "inactive")


if __name__ == "__main__":
    unittest.main()
