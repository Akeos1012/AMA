import importlib
import unittest
from datetime import datetime, timezone

from pydantic import ValidationError


class_models = importlib.import_module("app.models.class")
ClassCreateRequest = class_models.ClassCreateRequest
ClassUpdateRequest = class_models.ClassUpdateRequest
ClassResponse = class_models.ClassResponse
TeacherSubjectAssignmentCreateRequest = (
    class_models.TeacherSubjectAssignmentCreateRequest
)
TeacherSubjectAssignmentResponse = class_models.TeacherSubjectAssignmentResponse
StudentMembershipCreateRequest = class_models.StudentMembershipCreateRequest
StudentMembershipResponse = class_models.StudentMembershipResponse

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
VALID_CLASS_CREATE = {
    "name": "Grade 1 - Mabini",
    "grade_level": "Grade 1",
    "section": "Mabini",
}
VALID_CLASS_RESPONSE = {
    "id": "class-123",
    "name": "Grade 1 - Mabini",
    "grade_level": "Grade 1",
    "section": "Mabini",
    "status": "active",
    "lead_teacher_uid": "teacher-123",
    "created_at": NOW,
    "updated_at": NOW,
}
VALID_ASSIGNMENT = {
    "class_id": "class-123",
    "subject_id": "subject-123",
    "teacher_uid": "teacher-123",
}
VALID_ASSIGNMENT_RESPONSE = {
    "id": "assignment-123",
    **VALID_ASSIGNMENT,
    "status": "active",
    "created_at": NOW,
    "updated_at": NOW,
}
VALID_MEMBERSHIP = {
    "class_id": "class-123",
    "student_uid": "student-123",
}
VALID_MEMBERSHIP_RESPONSE = {
    "id": "membership-123",
    **VALID_MEMBERSHIP,
    "status": "active",
    "created_at": NOW,
    "updated_at": NOW,
}


class ClassCreateRequestTests(unittest.TestCase):
    def test_valid_class_request_is_accepted(self):
        request = ClassCreateRequest.model_validate(VALID_CLASS_CREATE)
        self.assertEqual(request.name, "Grade 1 - Mabini")

    def test_missing_required_fields_are_rejected(self):
        for field_name in ("name", "grade_level", "section"):
            request_data = dict(VALID_CLASS_CREATE)
            del request_data[field_name]
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassCreateRequest.model_validate(request_data)

    def test_blank_class_fields_are_rejected(self):
        for field_name in ("name", "grade_level", "section"):
            for blank in ("", "  "):
                with self.subTest(field_name=field_name, blank=blank):
                    with self.assertRaises(ValidationError):
                        ClassCreateRequest.model_validate(
                            {**VALID_CLASS_CREATE, field_name: blank}
                        )

    def test_class_fields_are_trimmed(self):
        request = ClassCreateRequest.model_validate(
            {
                "name": " Grade One ",
                "grade_level": " Grade 1 ",
                "section": " Mabini ",
                "lead_teacher_uid": " teacher-123 ",
            }
        )
        self.assertEqual(request.name, "Grade One")
        self.assertEqual(request.grade_level, "Grade 1")
        self.assertEqual(request.section, "Mabini")
        self.assertEqual(request.lead_teacher_uid, "teacher-123")

    def test_status_defaults_to_active(self):
        request = ClassCreateRequest.model_validate(VALID_CLASS_CREATE)
        self.assertEqual(request.status, "active")

    def test_unsupported_status_is_rejected(self):
        with self.assertRaises(ValidationError):
            ClassCreateRequest.model_validate(
                {**VALID_CLASS_CREATE, "status": "pending"}
            )

    def test_blank_lead_teacher_uid_is_rejected(self):
        with self.assertRaises(ValidationError):
            ClassCreateRequest.model_validate(
                {**VALID_CLASS_CREATE, "lead_teacher_uid": "  "}
            )

    def test_unknown_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            ClassCreateRequest.model_validate(
                {**VALID_CLASS_CREATE, "unexpected": "value"}
            )

    def test_document_ids_and_persisted_timestamps_are_rejected(self):
        for field_name, value in (
            ("id", "class-123"),
            ("class_id", "class-123"),
            ("created_at", NOW),
            ("updated_at", NOW),
        ):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassCreateRequest.model_validate(
                    {**VALID_CLASS_CREATE, field_name: value}
                )


class ClassUpdateRequestTests(unittest.TestCase):
    def test_name_only_update_is_accepted(self):
        request = ClassUpdateRequest.model_validate({"name": "New name"})
        self.assertEqual(request.model_dump(exclude_unset=True), {"name": "New name"})

    def test_status_only_update_is_accepted(self):
        request = ClassUpdateRequest.model_validate({"status": "inactive"})
        self.assertEqual(request.status, "inactive")
        self.assertEqual(request.model_fields_set, {"status"})

    def test_multiple_fields_can_be_updated(self):
        request = ClassUpdateRequest.model_validate(
            {"name": "New name", "section": "Rizal"}
        )
        self.assertEqual(
            request.model_dump(exclude_unset=True),
            {"name": "New name", "section": "Rizal"},
        )

    def test_omitted_fields_remain_distinguishable(self):
        request = ClassUpdateRequest.model_validate({"name": "New name"})
        self.assertEqual(request.model_fields_set, {"name"})
        self.assertNotIn("section", request.model_dump(exclude_unset=True))

    def test_invalid_status_is_rejected(self):
        with self.assertRaises(ValidationError):
            ClassUpdateRequest.model_validate({"status": "deleted"})

    def test_blank_supplied_strings_are_rejected(self):
        for field_name in ("name", "grade_level", "section", "lead_teacher_uid"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassUpdateRequest.model_validate({field_name: "  "})

    def test_unknown_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            ClassUpdateRequest.model_validate({"teacher_uid": "teacher-123"})

    def test_empty_update_is_rejected(self):
        with self.assertRaises(ValidationError):
            ClassUpdateRequest.model_validate({})

    def test_nullable_lead_teacher_can_be_cleared(self):
        request = ClassUpdateRequest.model_validate({"lead_teacher_uid": None})
        self.assertEqual(request.model_fields_set, {"lead_teacher_uid"})
        self.assertIsNone(request.lead_teacher_uid)

    def test_other_explicit_nulls_are_rejected(self):
        for field_name in ("name", "grade_level", "section", "status"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassUpdateRequest.model_validate({field_name: None})

    def test_ids_and_timestamps_are_rejected(self):
        for field_name, value in (
            ("id", "class-123"),
            ("class_id", "class-123"),
            ("created_at", NOW),
            ("updated_at", NOW),
        ):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassUpdateRequest.model_validate({field_name: value})


class ClassResponseTests(unittest.TestCase):
    def test_valid_class_response_is_accepted(self):
        response = ClassResponse.model_validate(VALID_CLASS_RESPONSE)
        self.assertEqual(response.id, "class-123")
        self.assertEqual(response.created_at, NOW)

    def test_missing_required_fields_are_rejected(self):
        for field_name in (
            "id",
            "name",
            "grade_level",
            "section",
            "status",
            "created_at",
            "updated_at",
        ):
            response_data = dict(VALID_CLASS_RESPONSE)
            del response_data[field_name]
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassResponse.model_validate(response_data)

    def test_blank_identifiers_and_names_are_rejected(self):
        for field_name in ("id", "name", "grade_level", "section"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                ClassResponse.model_validate(
                    {**VALID_CLASS_RESPONSE, field_name: "  "}
                )

    def test_blank_lead_teacher_uid_is_rejected(self):
        with self.assertRaises(ValidationError):
            ClassResponse.model_validate(
                {**VALID_CLASS_RESPONSE, "lead_teacher_uid": "  "}
            )

    def test_unsupported_status_is_rejected(self):
        with self.assertRaises(ValidationError):
            ClassResponse.model_validate(
                {**VALID_CLASS_RESPONSE, "status": "deleted"}
            )

    def test_timestamps_must_be_timezone_aware(self):
        with self.assertRaises(ValidationError):
            ClassResponse.model_validate(
                {**VALID_CLASS_RESPONSE, "created_at": datetime(2026, 10, 15, 12)}
            )


class TeacherSubjectAssignmentTests(unittest.TestCase):
    def test_valid_assignment_request_is_accepted(self):
        request = TeacherSubjectAssignmentCreateRequest.model_validate(
            VALID_ASSIGNMENT
        )
        self.assertEqual(request.status, "active")

    def test_missing_assignment_identifiers_are_rejected(self):
        for field_name in ("class_id", "subject_id", "teacher_uid"):
            request_data = dict(VALID_ASSIGNMENT)
            del request_data[field_name]
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                TeacherSubjectAssignmentCreateRequest.model_validate(request_data)

    def test_blank_assignment_identifiers_are_rejected(self):
        for field_name in ("class_id", "subject_id", "teacher_uid"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                TeacherSubjectAssignmentCreateRequest.model_validate(
                    {**VALID_ASSIGNMENT, field_name: "  "}
                )

    def test_assignment_identifiers_are_trimmed(self):
        request = TeacherSubjectAssignmentCreateRequest.model_validate(
            {
                "class_id": " class-123 ",
                "subject_id": " subject-123 ",
                "teacher_uid": " teacher-123 ",
            }
        )
        self.assertEqual(request.class_id, "class-123")
        self.assertEqual(request.subject_id, "subject-123")
        self.assertEqual(request.teacher_uid, "teacher-123")

    def test_unsupported_assignment_status_is_rejected(self):
        with self.assertRaises(ValidationError):
            TeacherSubjectAssignmentCreateRequest.model_validate(
                {**VALID_ASSIGNMENT, "status": "pending"}
            )

    def test_valid_assignment_response_is_accepted(self):
        response = TeacherSubjectAssignmentResponse.model_validate(
            VALID_ASSIGNMENT_RESPONSE
        )
        self.assertEqual(response.id, "assignment-123")
        self.assertEqual(response.teacher_uid, "teacher-123")

    def test_invalid_assignment_response_is_rejected(self):
        for field_name in ("id", "class_id", "subject_id", "teacher_uid"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                TeacherSubjectAssignmentResponse.model_validate(
                    {**VALID_ASSIGNMENT_RESPONSE, field_name: " "}
                )

    def test_assignment_response_requires_aware_timestamps(self):
        with self.assertRaises(ValidationError):
            TeacherSubjectAssignmentResponse.model_validate(
                {
                    **VALID_ASSIGNMENT_RESPONSE,
                    "updated_at": datetime(2026, 10, 15, 12),
                }
            )


class StudentMembershipTests(unittest.TestCase):
    def test_valid_membership_request_is_accepted(self):
        request = StudentMembershipCreateRequest.model_validate(VALID_MEMBERSHIP)
        self.assertEqual(request.status, "active")

    def test_missing_membership_identifiers_are_rejected(self):
        for field_name in ("class_id", "student_uid"):
            request_data = dict(VALID_MEMBERSHIP)
            del request_data[field_name]
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                StudentMembershipCreateRequest.model_validate(request_data)

    def test_blank_membership_identifiers_are_rejected(self):
        for field_name in ("class_id", "student_uid"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                StudentMembershipCreateRequest.model_validate(
                    {**VALID_MEMBERSHIP, field_name: "  "}
                )

    def test_membership_identifiers_are_trimmed(self):
        request = StudentMembershipCreateRequest.model_validate(
            {"class_id": " class-123 ", "student_uid": " student-123 "}
        )
        self.assertEqual(request.class_id, "class-123")
        self.assertEqual(request.student_uid, "student-123")

    def test_membership_status_defaults_to_active(self):
        request = StudentMembershipCreateRequest.model_validate(VALID_MEMBERSHIP)
        self.assertEqual(request.status, "active")

    def test_unsupported_membership_status_is_rejected(self):
        with self.assertRaises(ValidationError):
            StudentMembershipCreateRequest.model_validate(
                {**VALID_MEMBERSHIP, "status": "pending"}
            )

    def test_valid_membership_response_is_accepted(self):
        response = StudentMembershipResponse.model_validate(
            VALID_MEMBERSHIP_RESPONSE
        )
        self.assertEqual(response.id, "membership-123")
        self.assertEqual(response.status, "active")

    def test_invalid_membership_response_is_rejected(self):
        for field_name in ("id", "class_id", "student_uid"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                StudentMembershipResponse.model_validate(
                    {**VALID_MEMBERSHIP_RESPONSE, field_name: " "}
                )

    def test_membership_response_rejects_invalid_status_and_timestamps(self):
        with self.assertRaises(ValidationError):
            StudentMembershipResponse.model_validate(
                {**VALID_MEMBERSHIP_RESPONSE, "status": "pending"}
            )
        with self.assertRaises(ValidationError):
            StudentMembershipResponse.model_validate(
                {
                    **VALID_MEMBERSHIP_RESPONSE,
                    "created_at": datetime(2026, 10, 15, 12),
                }
            )

    def test_membership_request_does_not_accept_persisted_fields(self):
        for field_name, value in (
            ("id", "membership-123"),
            ("created_at", NOW),
            ("updated_at", NOW),
        ):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                StudentMembershipCreateRequest.model_validate(
                    {**VALID_MEMBERSHIP, field_name: value}
                )


if __name__ == "__main__":
    unittest.main()
