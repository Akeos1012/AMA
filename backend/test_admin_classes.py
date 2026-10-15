import importlib
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

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

    def add_subject(self, subject_id="subject-1", teacher_ids=None, status="active"):
        self.database.collection("subjects").documents[subject_id] = {
            "name": "Mathematics",
            "code": "MATH",
            "status": status,
            "teacher_ids": teacher_ids if teacher_ids is not None else ["teacher-1"],
        }

    def test_all_routes_require_admin(self):
        self.assertTrue(admin_classes.router.dependencies)
        self.assertIs(
            admin_classes.router.dependencies[0].dependency,
            admin_classes.require_admin,
        )

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
