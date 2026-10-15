import unittest
from datetime import datetime, timezone

from pydantic import TypeAdapter, ValidationError

from app.models.lesson import (
    BulletListBlock,
    HeadingBlock,
    LessonContent,
    LessonContentBlock,
    LessonCreateRequest,
    LessonResponse,
    LessonUpdateRequest,
    ParagraphBlock,
)


BLOCK_ADAPTER = TypeAdapter(LessonContentBlock)
VALID_BLOCKS = [
    {"type": "heading", "text": "Introduction", "level": 1},
    {"type": "paragraph", "text": "A lesson paragraph."},
    {"type": "bullet_list", "items": ["First item", "Second item"]},
]
VALID_CONTENT = {"blocks": VALID_BLOCKS}
VALID_CREATE_REQUEST = {
    "title": "Fractions",
    "topic": "Adding fractions",
    "subject_id": "subject-123",
    "class_id": "class-123",
    "content": VALID_CONTENT,
}
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
VALID_RESPONSE = {
    "id": "lesson-123",
    "title": "Fractions",
    "topic": "Adding fractions",
    "subject_id": "subject-123",
    "class_id": "class-123",
    "teacher_id": "teacher-123",
    "status": "draft",
    "content": VALID_CONTENT,
    "created_at": NOW,
    "updated_at": NOW,
}


class LessonContentBlockTests(unittest.TestCase):
    def test_valid_heading_block(self):
        block = BLOCK_ADAPTER.validate_python(VALID_BLOCKS[0])
        self.assertIsInstance(block, HeadingBlock)
        self.assertEqual(block.text, "Introduction")

    def test_valid_paragraph_block(self):
        block = BLOCK_ADAPTER.validate_python(VALID_BLOCKS[1])
        self.assertIsInstance(block, ParagraphBlock)

    def test_valid_bullet_list_block(self):
        block = BLOCK_ADAPTER.validate_python(VALID_BLOCKS[2])
        self.assertIsInstance(block, BulletListBlock)

    def test_heading_and_paragraph_text_must_not_be_blank(self):
        for value in (
            {"type": "heading", "text": "  ", "level": 1},
            {"type": "paragraph", "text": "  "},
        ):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                BLOCK_ADAPTER.validate_python(value)

    def test_heading_level_must_be_between_one_and_three(self):
        for level in (0, 4):
            with self.subTest(level=level), self.assertRaises(ValidationError):
                BLOCK_ADAPTER.validate_python(
                    {"type": "heading", "text": "Heading", "level": level}
                )

    def test_heading_level_does_not_coerce_strings(self):
        with self.assertRaises(ValidationError):
            BLOCK_ADAPTER.validate_python(
                {"type": "heading", "text": "Heading", "level": "1"}
            )

    def test_bullet_list_must_contain_an_item(self):
        with self.assertRaises(ValidationError):
            BLOCK_ADAPTER.validate_python({"type": "bullet_list", "items": []})

    def test_bullet_items_must_not_be_blank(self):
        with self.assertRaises(ValidationError):
            BLOCK_ADAPTER.validate_python(
                {"type": "bullet_list", "items": ["First item", "  "]}
            )

    def test_unknown_block_type_is_rejected(self):
        with self.assertRaises(ValidationError):
            BLOCK_ADAPTER.validate_python({"type": "image", "url": "example"})

    def test_unknown_block_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            BLOCK_ADAPTER.validate_python(
                {"type": "paragraph", "text": "Text", "html": "<p>Text</p>"}
            )

    def test_block_text_is_trimmed(self):
        block = BLOCK_ADAPTER.validate_python(
            {"type": "paragraph", "text": "  Keep these words.  "}
        )
        self.assertEqual(block.text, "Keep these words.")

    def test_bullet_items_are_trimmed(self):
        block = BLOCK_ADAPTER.validate_python(
            {"type": "bullet_list", "items": ["  One  ", " Two "]}
        )
        self.assertEqual(block.items, ["One", "Two"])


class LessonContentTests(unittest.TestCase):
    def test_valid_content_accepts_multiple_block_types(self):
        content = LessonContent.model_validate(VALID_CONTENT)
        self.assertEqual(len(content.blocks), 3)

    def test_empty_blocks_are_rejected(self):
        with self.assertRaises(ValidationError):
            LessonContent.model_validate({"blocks": []})

    def test_schema_version_defaults_to_one(self):
        content = LessonContent.model_validate({"blocks": [VALID_BLOCKS[0]]})
        self.assertEqual(content.schema_version, 1)

    def test_unsupported_schema_versions_are_rejected(self):
        for version in (0, 2):
            with self.subTest(version=version), self.assertRaises(ValidationError):
                LessonContent.model_validate(
                    {"schema_version": version, "blocks": [VALID_BLOCKS[0]]}
                )

    def test_block_order_is_preserved(self):
        content = LessonContent.model_validate(VALID_CONTENT)
        self.assertEqual(
            [block.type for block in content.blocks],
            ["heading", "paragraph", "bullet_list"],
        )

    def test_unknown_content_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            LessonContent.model_validate(
                {"blocks": [VALID_BLOCKS[0]], "html": "<p>Unsafe</p>"}
            )


class LessonStatusTests(unittest.TestCase):
    def test_draft_status_is_accepted(self):
        response = LessonResponse.model_validate(VALID_RESPONSE)
        self.assertEqual(response.status, "draft")

    def test_published_status_is_accepted(self):
        response = LessonResponse.model_validate(
            {**VALID_RESPONSE, "status": "published", "published_at": NOW}
        )
        self.assertEqual(response.status, "published")

    def test_unsupported_statuses_are_rejected(self):
        for status in ("pending", "archived", "other"):
            with self.subTest(status=status), self.assertRaises(ValidationError):
                LessonResponse.model_validate({**VALID_RESPONSE, "status": status})


class LessonCreateRequestTests(unittest.TestCase):
    def test_valid_creation_request_is_accepted(self):
        request = LessonCreateRequest.model_validate(VALID_CREATE_REQUEST)
        self.assertEqual(request.title, "Fractions")

    def test_missing_required_fields_are_rejected(self):
        for field_name in VALID_CREATE_REQUEST:
            request_data = dict(VALID_CREATE_REQUEST)
            del request_data[field_name]
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                LessonCreateRequest.model_validate(request_data)

    def test_blank_required_strings_are_rejected(self):
        for field_name in ("title", "topic", "subject_id", "class_id"):
            request_data = {**VALID_CREATE_REQUEST, field_name: "  "}
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                LessonCreateRequest.model_validate(request_data)

    def test_creation_text_fields_are_trimmed(self):
        request = LessonCreateRequest.model_validate(
            {
                **VALID_CREATE_REQUEST,
                "title": "  Fractions  ",
                "topic": " Adding fractions ",
                "subject_id": " subject-123 ",
                "class_id": " class-123 ",
            }
        )
        self.assertEqual(request.title, "Fractions")
        self.assertEqual(request.topic, "Adding fractions")
        self.assertEqual(request.subject_id, "subject-123")
        self.assertEqual(request.class_id, "class-123")

    def test_owner_and_timestamp_fields_are_rejected(self):
        for field_name in (
            "teacher_id",
            "created_at",
            "updated_at",
            "published_at",
        ):
            request_data = {**VALID_CREATE_REQUEST, field_name: "untrusted"}
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                LessonCreateRequest.model_validate(request_data)

    def test_unknown_creation_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            LessonCreateRequest.model_validate(
                {**VALID_CREATE_REQUEST, "unexpected": "value"}
            )


class LessonUpdateRequestTests(unittest.TestCase):
    def test_title_only_update_is_accepted(self):
        request = LessonUpdateRequest.model_validate(
            {"class_id": "class-123", "title": "New title"}
        )
        self.assertEqual(
            request.model_dump(exclude_unset=True),
            {"class_id": "class-123", "title": "New title"},
        )

    def test_content_only_update_is_accepted(self):
        request = LessonUpdateRequest.model_validate(
            {"class_id": "class-123", "content": VALID_CONTENT}
        )
        self.assertIn("content", request.model_fields_set)
        self.assertNotIn("title", request.model_fields_set)

    def test_multiple_fields_can_be_updated(self):
        request = LessonUpdateRequest.model_validate(
            {"class_id": "class-123", "title": "Updated", "topic": "New topic"}
        )
        self.assertEqual(
            request.model_dump(exclude_unset=True),
            {"class_id": "class-123", "title": "Updated", "topic": "New topic"},
        )

    def test_class_only_update_is_accepted(self):
        request = LessonUpdateRequest.model_validate({"class_id": "class-456"})
        self.assertEqual(request.class_id, "class-456")
        self.assertEqual(request.model_fields_set, {"class_id"})

    def test_invalid_content_is_rejected(self):
        with self.assertRaises(ValidationError):
            LessonUpdateRequest.model_validate(
                {"content": {"blocks": [{"type": "unknown"}]}}
            )

    def test_blank_supplied_strings_are_rejected(self):
        for field_name in ("title", "topic", "subject_id", "class_id"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                LessonUpdateRequest.model_validate({field_name: "  "})

    def test_explicit_null_is_rejected(self):
        for field_name in ("title", "topic", "subject_id", "class_id", "content"):
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                LessonUpdateRequest.model_validate({field_name: None})

    def test_unknown_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            LessonUpdateRequest.model_validate({"teacher_id": "untrusted"})

    def test_empty_update_is_rejected(self):
        with self.assertRaises(ValidationError):
            LessonUpdateRequest.model_validate({})

    def test_omitted_fields_remain_distinguishable(self):
        request = LessonUpdateRequest.model_validate(
            {"class_id": "class-123", "title": "Updated"}
        )
        self.assertEqual(request.model_fields_set, {"class_id", "title"})
        self.assertEqual(
            request.model_dump(exclude_unset=True),
            {"class_id": "class-123", "title": "Updated"},
        )

    def test_class_id_is_required_for_updates(self):
        with self.assertRaises(ValidationError):
            LessonUpdateRequest.model_validate({"title": "Updated"})

    def test_update_class_id_is_trimmed(self):
        request = LessonUpdateRequest.model_validate(
            {"class_id": " class-123 ", "title": "Updated"}
        )
        self.assertEqual(request.class_id, "class-123")


class LessonResponseTests(unittest.TestCase):
    def test_draft_response_can_omit_publication_timestamp(self):
        response = LessonResponse.model_validate(VALID_RESPONSE)
        self.assertIsNone(response.published_at)

    def test_published_response_accepts_publication_timestamp(self):
        response = LessonResponse.model_validate(
            {**VALID_RESPONSE, "status": "published", "published_at": NOW}
        )
        self.assertEqual(response.published_at, NOW)

    def test_missing_required_response_fields_are_rejected(self):
        for field_name in VALID_RESPONSE:
            response_data = dict(VALID_RESPONSE)
            del response_data[field_name]
            with self.subTest(field_name=field_name), self.assertRaises(
                ValidationError
            ):
                LessonResponse.model_validate(response_data)

    def test_invalid_or_blank_lesson_ids_are_rejected(self):
        for lesson_id in ("", "  "):
            with self.subTest(lesson_id=lesson_id), self.assertRaises(
                ValidationError
            ):
                LessonResponse.model_validate({**VALID_RESPONSE, "id": lesson_id})

    def test_response_timestamps_must_be_timezone_aware(self):
        with self.assertRaises(ValidationError):
            LessonResponse.model_validate(
                {**VALID_RESPONSE, "created_at": datetime(2026, 10, 15, 12, 0)}
            )

    def test_response_text_is_trimmed(self):
        response = LessonResponse.model_validate(
            {
                **VALID_RESPONSE,
                "id": "  lesson-123  ",
                "title": " Fractions ",
            }
        )
        self.assertEqual(response.id, "lesson-123")
        self.assertEqual(response.title, "Fractions")


if __name__ == "__main__":
    unittest.main()
