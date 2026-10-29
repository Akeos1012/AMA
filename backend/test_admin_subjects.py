import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.api import admin_subjects


class FakeProfileSnapshot:
    def __init__(self, data):
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return self._data


class FakeProfileReference:
    def __init__(self, collection, document_id):
        self.collection = collection
        self.document_id = document_id

    def get(self):
        return FakeProfileSnapshot(
            self.collection.profiles.get(self.document_id)
        )


class FakeProfileCollection:
    def __init__(self, profiles):
        self.profiles = profiles

    def document(self, document_id):
        return FakeProfileReference(self, document_id)


class FakeDatabase:
    def __init__(self, profiles):
        self.profiles = profiles

    def collection(self, name):
        if name != "users":
            raise AssertionError(f"Unexpected collection: {name}")
        return FakeProfileCollection(self.profiles)


class AdminSubjectEligibilityTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase(
            {
                "teacher-1": {
                    "role": "teacher",
                    "status": "active",
                }
            }
        )
        self.account = SimpleNamespace(
            disabled=False,
            custom_claims={"role": "teacher"},
        )
        self.get_user_patch = patch.object(
            admin_subjects.firebase_auth,
            "get_user",
            return_value=self.account,
        )
        self.get_user_patch.start()
        self.addCleanup(self.get_user_patch.stop)

    def test_only_active_teacher_profiles_can_be_subject_eligible(self):
        result = admin_subjects.validate_teacher_ids(
            self.database,
            ["teacher-1", "teacher-1"],
        )
        self.assertEqual(result, ["teacher-1"])

        self.database.profiles["teacher-1"]["status"] = "inactive"
        with self.assertRaises(HTTPException) as error:
            admin_subjects.validate_teacher_ids(
                self.database,
                ["teacher-1"],
            )
        self.assertEqual(error.exception.status_code, 422)

    def test_disabled_accounts_and_non_teacher_profiles_are_rejected(self):
        self.account.disabled = True
        with self.assertRaises(HTTPException) as disabled:
            admin_subjects.validate_teacher_ids(
                self.database,
                ["teacher-1"],
            )
        self.assertEqual(disabled.exception.status_code, 422)

        self.account.disabled = False
        self.database.profiles["teacher-1"]["role"] = "student"
        with self.assertRaises(HTTPException) as wrong_role:
            admin_subjects.validate_teacher_ids(
                self.database,
                ["teacher-1"],
            )
        self.assertEqual(wrong_role.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
