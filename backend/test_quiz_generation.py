import json
import unittest
from datetime import datetime, timezone
from pydantic import ValidationError

from app.models.generation import (
    EssayQuestion,
    GeneratedQuiz,
    IdentificationQuestion,
    MultipleChoiceQuestion,
    QuestionValidationReport,
    QuizDraft,
    QuizGenerationRequest,
    QuizValidationReport,
    SourceEvidence,
    TrueFalseQuestion,
    ValidationIssue,
)
from app.extraction.lesson_text import (
    ExtractedLessonContent,
    InsufficientLessonContentError,
    extract_lesson_text,
)
from app.models.lesson import HeadingBlock, ParagraphBlock, BulletListBlock, LessonContent


class TestGenerationDataContracts(unittest.TestCase):
    def setUp(self):
        self.evidence = SourceEvidence(
            quote="Photosynthesis produces glucose and oxygen from sunlight.",
            block_index=1,
            context="Section 2: Plant Physiology",
        )

    def test_valid_multiple_choice_question(self):
        mcq = MultipleChoiceQuestion(
            prompt="What gas is released during photosynthesis?",
            options=["Oxygen", "Carbon Dioxide", "Nitrogen", "Methane"],
            correct_answer="Oxygen",
            explanation="Plants release oxygen as a byproduct of photolysis.",
            evidence=self.evidence,
        )
        self.assertEqual(mcq.type, "multiple_choice")
        self.assertEqual(len(mcq.options), 4)
        self.assertEqual(mcq.correct_answer, "Oxygen")

    def test_mcq_rejects_non_four_options(self):
        with self.assertRaises(ValidationError):
            MultipleChoiceQuestion(
                prompt="Question?",
                options=["A", "B", "C"],  # 3 options
                correct_answer="A",
                explanation="Exp",
                evidence=self.evidence,
            )

        with self.assertRaises(ValidationError):
            MultipleChoiceQuestion(
                prompt="Question?",
                options=["A", "B", "C", "D", "E"],  # 5 options
                correct_answer="A",
                explanation="Exp",
                evidence=self.evidence,
            )

    def test_mcq_rejects_duplicate_options(self):
        with self.assertRaises(ValidationError):
            MultipleChoiceQuestion(
                prompt="Question?",
                options=["Oxygen", "Carbon Dioxide", "oxygen", "Nitrogen"],  # duplicate Oxygen
                correct_answer="Oxygen",
                explanation="Exp",
                evidence=self.evidence,
            )

    def test_mcq_rejects_correct_answer_not_in_options(self):
        with self.assertRaises(ValidationError):
            MultipleChoiceQuestion(
                prompt="Question?",
                options=["A", "B", "C", "D"],
                correct_answer="E",
                explanation="Exp",
                evidence=self.evidence,
            )

    def test_valid_true_false_question(self):
        tf = TrueFalseQuestion(
            prompt="Plants absorb green light for energy.",
            correct_answer=False,
            explanation="Plants reflect green light, which is why they appear green.",
            evidence=self.evidence,
        )
        self.assertEqual(tf.type, "true_false")
        self.assertFalse(tf.correct_answer)

    def test_valid_identification_question(self):
        ident = IdentificationQuestion(
            prompt="What is the primary green pigment in plants?",
            correct_answer="Chlorophyll",
            accepted_alternatives=["Chlorophyll A", "Chlorophyll B"],
            explanation="Chlorophyll absorbs sunlight.",
            evidence=self.evidence,
        )
        self.assertEqual(ident.correct_answer, "Chlorophyll")
        self.assertEqual(len(ident.accepted_alternatives), 2)

    def test_identification_rejects_correct_answer_in_alternatives(self):
        with self.assertRaises(ValidationError):
            IdentificationQuestion(
                prompt="Question?",
                correct_answer="Chlorophyll",
                accepted_alternatives=["Chlorophyll", "Other"],
                explanation="Exp",
                evidence=self.evidence,
            )

    def test_identification_rejects_duplicate_alternatives(self):
        with self.assertRaises(ValidationError):
            IdentificationQuestion(
                prompt="Question?",
                correct_answer="Chlorophyll",
                accepted_alternatives=["Alt 1", "alt 1"],
                explanation="Exp",
                evidence=self.evidence,
            )

    def test_valid_essay_question(self):
        essay = EssayQuestion(
            prompt="Explain the light-dependent reactions of photosynthesis.",
            rubric=[
                "Mentions photon absorption by chlorophyll",
                "Explains water splitting and oxygen release",
                "Identifies ATP and NADPH generation",
            ],
            sample_solution="During the light reactions, photons excite chlorophyll...",
            explanation="Key mechanisms in the thylakoid membrane.",
            evidence=self.evidence,
        )
        self.assertEqual(essay.type, "essay")
        self.assertEqual(len(essay.rubric), 3)

    def test_essay_rejects_empty_rubric(self):
        with self.assertRaises(ValidationError):
            EssayQuestion(
                prompt="Explain photosynthesis.",
                rubric=[],
                explanation="Exp",
                evidence=self.evidence,
            )

    def test_quiz_generation_request_validation(self):
        # Valid request
        req = QuizGenerationRequest(
            lesson_id="lesson-123",
            question_counts={"multiple_choice": 5, "true_false": 3},
            instructions="Focus on cellular respiration.",
        )
        self.assertEqual(req.total_questions, 8)

        # Empty question_counts
        with self.assertRaises(ValidationError):
            QuizGenerationRequest(
                lesson_id="lesson-123",
                question_counts={},
            )

        # Negative count
        with self.assertRaises(ValidationError):
            QuizGenerationRequest(
                lesson_id="lesson-123",
                question_counts={"multiple_choice": -1},
            )

        # Zero total questions
        with self.assertRaises(ValidationError):
            QuizGenerationRequest(
                lesson_id="lesson-123",
                question_counts={"multiple_choice": 0},
            )

        # Over 50 questions
        with self.assertRaises(ValidationError):
            QuizGenerationRequest(
                lesson_id="lesson-123",
                question_counts={"multiple_choice": 51},
            )

    def test_quiz_draft_schema(self):
        now = datetime.now(timezone.utc)
        mcq = MultipleChoiceQuestion(
            prompt="Which cell organelle produces ATP?",
            options=["Mitochondria", "Nucleus", "Ribosome", "Golgi"],
            correct_answer="Mitochondria",
            explanation="Mitochondria are the powerhouse of the cell.",
            evidence=self.evidence,
        )
        report = QuizValidationReport(
            is_valid=True,
            grounding_passed=True,
            correctness_passed=True,
            question_reports=[
                QuestionValidationReport(
                    question_index=0,
                    grounding_passed=True,
                    correctness_passed=True,
                    issues=[],
                )
            ],
            general_issues=[],
        )
        draft = QuizDraft(
            id="draft-1",
            lesson_id="lesson-1",
            class_id="class-1",
            subject_id="subject-1",
            teacher_id="teacher-1",
            title="Cell Biology Quiz",
            status="draft",
            questions=[mcq],
            validation_report=report,
            model_id="qwen2.5:3b",
            created_at=now,
            updated_at=now,
        )
        self.assertEqual(draft.status, "draft")
        self.assertEqual(draft.questions[0].type, "multiple_choice")


class TestLessonTextExtraction(unittest.TestCase):
    def test_extract_mixed_blocks_successfully(self):
        lesson_data = {
            "id": "lesson-bio-1",
            "title": "Cell Structure and Organelles",
            "topic": "Cell Biology",
            "content": {
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Overview of Eukaryotic Cells"},
                    {
                        "type": "paragraph",
                        "text": "Eukaryotic cells contain membrane-bound organelles that perform specialized metabolic tasks.",
                    },
                    {"type": "heading", "level": 2, "text": "Key Organelles"},
                    {
                        "type": "bullet_list",
                        "items": [
                            "Mitochondria generate cellular ATP through oxidative phosphorylation.",
                            "Ribosomes synthesize polypeptides based on mRNA templates.",
                            "The nucleus encapsulates genetic material and directs cell growth.",
                        ],
                    },
                ]
            },
        }

        extracted = extract_lesson_text(lesson_data, min_word_count=15)
        self.assertEqual(extracted.lesson_id, "lesson-bio-1")
        self.assertIn("Lesson Title: Cell Structure and Organelles", extracted.full_text)
        self.assertIn("# Overview of Eukaryotic Cells", extracted.full_text)
        self.assertIn("## Key Organelles", extracted.full_text)
        self.assertIn("- Mitochondria generate cellular ATP", extracted.full_text)
        self.assertGreater(extracted.word_count, 15)
        self.assertEqual(len(extracted.passages), 4)

        # Check block indexing
        self.assertEqual(extracted.passages[0].block_index, 0)
        self.assertEqual(extracted.passages[1].block_index, 1)
        self.assertEqual(extracted.passages[2].block_index, 2)
        self.assertEqual(extracted.passages[3].block_index, 3)

        repeated = extract_lesson_text(lesson_data, min_word_count=15)
        self.assertEqual(repeated.full_text, extracted.full_text)
        self.assertEqual(
            [
                (passage.block_index, passage.block_type, passage.text)
                for passage in repeated.passages
            ],
            [
                (passage.block_index, passage.block_type, passage.text)
                for passage in extracted.passages
            ],
        )

    def test_extract_pydantic_blocks_support(self):
        blocks = [
            HeadingBlock(type="heading", level=1, text="Photosynthesis"),
            ParagraphBlock(
                type="paragraph",
                text="Photosynthesis is the chemical process by which autotrophs convert light energy into glucose.",
            ),
        ]
        lesson_data = {
            "id": "lesson-pydantic-1",
            "title": "Photosynthesis",
            "topic": "Bioenergetics",
            "content": LessonContent(blocks=blocks),
        }
        extracted = extract_lesson_text(lesson_data, min_word_count=10)
        self.assertEqual(len(extracted.passages), 2)
        self.assertEqual(extracted.passages[0].block_type, "heading")
        self.assertEqual(extracted.passages[1].block_type, "paragraph")

    def test_empty_blocks_raises_insufficient_content(self):
        lesson_data = {
            "id": "lesson-empty",
            "title": "Empty Lesson",
            "topic": "None",
            "content": {"blocks": []},
        }
        with self.assertRaises(InsufficientLessonContentError) as ctx:
            extract_lesson_text(lesson_data)
        self.assertEqual(ctx.exception.details["word_count"], 0)

    def test_whitespace_only_blocks_raises_insufficient_content(self):
        lesson_data = {
            "id": "lesson-whitespace",
            "title": "Whitespace Lesson",
            "topic": "None",
            "content": {
                "blocks": [
                    {"type": "heading", "level": 1, "text": "   "},
                    {"type": "paragraph", "text": "  \n  \t  "},
                    {"type": "bullet_list", "items": ["  ", "   "]},
                ]
            },
        }
        with self.assertRaises(InsufficientLessonContentError):
            extract_lesson_text(lesson_data)

    def test_substantive_word_threshold_enforced(self):
        lesson_data = {
            "id": "lesson-short",
            "title": "Short",
            "topic": "Short",
            "content": {
                "blocks": [
                    {"type": "paragraph", "text": "Only four words here."},
                ]
            },
        }
        with self.assertRaises(InsufficientLessonContentError) as ctx:
            extract_lesson_text(lesson_data, min_word_count=15)
        self.assertEqual(ctx.exception.details["word_count"], 4)

    def test_unsupported_block_types_skipped_gracefully(self):
        lesson_data = {
            "id": "lesson-unsupported",
            "title": "Unsupported",
            "topic": "Test",
            "content": {
                "blocks": [
                    {"type": "video_player", "url": "http://example.com/video"},  # unsupported
                    {
                        "type": "paragraph",
                        "text": "This substantive paragraph explains the fundamental theory of relativity in extensive detail.",
                    },
                ]
            },
        }
        extracted = extract_lesson_text(lesson_data, min_word_count=10)
        self.assertEqual(len(extracted.passages), 1)
        self.assertEqual(extracted.passages[0].block_index, 1)


import httpx
from app.ai.client import (
    BaseLLMClient,
    LLMConnectionError,
    LLMMalformedResponseError,
    LLMModelNotFoundError,
    LLMProviderError,
    LLMResponse,
    LLMTimeoutError,
)
from app.ai.ollama_client import OllamaClient


class TestOllamaClient(unittest.TestCase):
    def test_successful_structured_generation(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/api/chat")
            body = json.loads(request.content.decode("utf-8"))
            self.assertEqual(body["model"], "qwen2.5:3b")
            self.assertEqual(body["format"], "json")
            return httpx.Response(
                200,
                json={
                    "model": "qwen2.5:3b",
                    "message": {"role": "assistant", "content": '{"title": "Test Quiz", "questions": []}'},
                    "total_duration": 500_000_000,
                    "prompt_eval_count": 42,
                    "eval_count": 88,
                },
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, model="qwen2.5:3b")
        response = ollama.generate_structured(prompt="Generate a quiz")

        self.assertIsInstance(response, LLMResponse)
        self.assertEqual(response.model, "qwen2.5:3b")
        self.assertEqual(response.parsed_json, {"title": "Test Quiz", "questions": []})
        self.assertEqual(response.prompt_tokens, 42)
        self.assertEqual(response.completion_tokens, 88)
        self.assertEqual(response.duration_ms, 500.0)

    def test_strip_markdown_code_fences(self):
        fenced_content = "```json\n{\"answer\": 42}\n```"
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "model": "qwen2.5:3b",
                    "message": {"role": "assistant", "content": fenced_content},
                },
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client)
        response = ollama.generate_structured(prompt="Test prompt")
        self.assertEqual(response.parsed_json, {"answer": 42})

    def test_empty_content_raises_malformed_response_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"model": "qwen2.5:3b", "message": {"role": "assistant", "content": "   "}},
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client)
        with self.assertRaises(LLMMalformedResponseError):
            ollama.generate_structured(prompt="Test")

    def test_invalid_json_raises_malformed_response_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"model": "qwen2.5:3b", "message": {"role": "assistant", "content": "Not a JSON object"}},
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client)
        with self.assertRaises(LLMMalformedResponseError):
            ollama.generate_structured(prompt="Test")

    def test_http_404_raises_model_not_found_without_retry(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(404, text="model 'missing:model' not found")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, model="missing:model", max_retries=2)

        with self.assertRaises(LLMModelNotFoundError):
            ollama.generate_structured(prompt="Test")

        # 404 is a permanent error; should NOT retry
        self.assertEqual(call_count, 1)

    def test_http_400_raises_provider_error_without_retry(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(400, text="Bad Request")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, max_retries=2)

        with self.assertRaises(LLMProviderError) as ctx:
            ollama.generate_structured(prompt="Test")

        self.assertFalse(ctx.exception.retryable)
        self.assertEqual(call_count, 1)

    def test_transient_connection_error_retries_and_succeeds(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.ConnectError("Connection refused")
            return httpx.Response(
                200,
                json={"model": "qwen2.5:3b", "message": {"role": "assistant", "content": '{"ok": true}'}},
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, max_retries=2)
        response = ollama.generate_structured(prompt="Test")
        self.assertEqual(call_count, 2)
        self.assertEqual(response.parsed_json, {"ok": True})

    def test_connection_error_exhausts_retries(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            raise httpx.ConnectError("Connection refused")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, max_retries=2)

        with self.assertRaises(LLMConnectionError):
            ollama.generate_structured(prompt="Test")

        # 1 initial attempt + 2 retries = 3 attempts total
        self.assertEqual(call_count, 3)

    def test_timeout_error_exhausts_retries(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            raise httpx.ReadTimeout("Read timed out")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, max_retries=1)

        with self.assertRaises(LLMTimeoutError):
            ollama.generate_structured(prompt="Test")

        self.assertEqual(call_count, 2)

    def test_server_500_error_exhausts_retries(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(500, text="Internal Server Error")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, max_retries=1)

        with self.assertRaises(LLMProviderError) as ctx:
            ollama.generate_structured(prompt="Test")

        self.assertTrue(ctx.exception.retryable)
        self.assertEqual(call_count, 2)

    def test_custom_configuration_options(self):
        ollama = OllamaClient(
            base_url="http://custom-host:8000",
            model="custom-model:latest",
            timeout_seconds=45.0,
            max_retries=5,
        )
        self.assertEqual(ollama.base_url, "http://custom-host:8000")
        self.assertEqual(ollama.model, "custom-model:latest")
        self.assertEqual(ollama.timeout_seconds, 45.0)
        self.assertEqual(ollama.max_retries, 5)


from app.ai.prompt_builder import build_quiz_prompt
from app.services.quiz_generation_service import (
    QuizGenerationService,
    QuizGenerationResult,
    QuizGenerationServiceError,
    SchemaValidationError,
    QuestionCountMismatchError,
)
from app.extraction.lesson_text import ExtractedPassage


class MockLLMClient(BaseLLMClient):
    def __init__(self, response_json=None, error_to_raise=None, model="mock-model"):
        self.response_json = response_json
        self.error_to_raise = error_to_raise
        self.model = model
        self.last_prompt = None
        self.last_system_instruction = None

    def generate_structured(self, prompt, system_instruction=None, schema=None, temperature=0.2):
        self.last_prompt = prompt
        self.last_system_instruction = system_instruction
        if self.error_to_raise:
            raise self.error_to_raise
        return LLMResponse(
            raw_text=json.dumps(self.response_json),
            parsed_json=self.response_json,
            model=self.model,
            duration_ms=120.0,
            prompt_tokens=50,
            completion_tokens=100,
        )


class TestPromptBuilder(unittest.TestCase):
    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-42",
            title="Newtonian Mechanics",
            topic="Physics",
            passages=[
                ExtractedPassage(block_index=0, block_type="heading", heading_level=1, text="Newton's Laws"),
                ExtractedPassage(
                    block_index=1,
                    block_type="paragraph",
                    text="Newton's first law states that an object remains at rest unless acted upon by a net external force.",
                ),
            ],
            full_text="# Newton's Laws\n\nNewton's first law states that an object remains at rest unless acted upon by a net external force.",
            word_count=20,
        )
        self.request = QuizGenerationRequest(
            lesson_id="lesson-42",
            question_counts={"multiple_choice": 2, "true_false": 1},
            instructions="Focus on inertia.",
        )

    def test_build_prompt_includes_lesson_content_and_breakdown(self):
        system_instruction, user_prompt = build_quiz_prompt(self.lesson, self.request)

        # Check system grounding rules
        self.assertIn("CRITICAL GROUNDING RULES", system_instruction)
        self.assertIn("Sole Factual Source", system_instruction)

        # Check user prompt contents
        self.assertIn("LESSON TITLE: Newtonian Mechanics", user_prompt)
        self.assertIn("TOPIC: Physics", user_prompt)
        self.assertIn("[Block 0] Newton's Laws", user_prompt)
        self.assertIn("[Block 1] Newton's first law states", user_prompt)
        self.assertIn("- multiple_choice: 2", user_prompt)
        self.assertIn("- true_false: 1", user_prompt)
        self.assertIn("Total questions requested: 3", user_prompt)
        self.assertIn("TEACHER INSTRUCTIONS / FOCUS:\nFocus on inertia.", user_prompt)

    def test_build_prompt_rejects_empty_lesson(self):
        empty_lesson = ExtractedLessonContent(
            lesson_id="empty",
            title="Empty",
            topic="None",
            passages=[],
            full_text="   ",
            word_count=0,
        )
        with self.assertRaises(ValueError):
            build_quiz_prompt(empty_lesson, self.request)


class TestQuizGenerationService(unittest.TestCase):
    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-bio",
            title="Cellular Biology",
            topic="Cytology",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="The mitochondrion is the powerhouse of the cell, generating adenosine triphosphate (ATP).",
                ),
                ExtractedPassage(
                    block_index=1,
                    block_type="paragraph",
                    text="Plant cells possess a rigid cell wall composed primarily of cellulose.",
                ),
            ],
            full_text="The mitochondrion is the powerhouse of the cell... Plant cells possess a cell wall.",
            word_count=25,
        )

    def test_successful_mixed_quiz_generation(self):
        model_payload = {
            "title": "Cellular Biology Assessment",
            "topic": "Cytology",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria synthesize ATP.",
                    "evidence": {
                        "quote": "The mitochondrion is the powerhouse of the cell, generating adenosine triphosphate (ATP).",
                        "block_index": 0,
                    },
                },
                {
                    "type": "true_false",
                    "prompt": "Plant cells possess a rigid cell wall composed of cellulose.",
                    "correct_answer": True,
                    "explanation": "The text explicitly states plant cells have a cellulose wall.",
                    "evidence": {
                        "quote": "Plant cells possess a rigid cell wall composed primarily of cellulose.",
                        "block_index": 1,
                    },
                },
                {
                    "type": "identification",
                    "prompt": "What molecule is generated by mitochondria for cellular energy?",
                    "correct_answer": "ATP",
                    "accepted_alternatives": ["Adenosine Triphosphate"],
                    "explanation": "ATP is the energy currency.",
                    "evidence": {
                        "quote": "generating adenosine triphosphate (ATP).",
                        "block_index": 0,
                    },
                },
                {
                    "type": "essay",
                    "prompt": "Describe the functional importance of the cell wall in plants.",
                    "rubric": [
                        "Mentions structural rigidity",
                        "Mentions cellulose composition",
                    ],
                    "sample_solution": "The plant cell wall provides structural support...",
                    "explanation": "Supported by the structural discussion in paragraph 2.",
                    "evidence": {
                        "quote": "Plant cells possess a rigid cell wall composed primarily of cellulose.",
                        "block_index": 1,
                    },
                },
            ],
        }

        mock_client = MockLLMClient(response_json=model_payload, model="test-qwen")
        service = QuizGenerationService(llm_client=mock_client)

        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={
                "multiple_choice": 1,
                "true_false": 1,
                "identification": 1,
                "essay": 1,
            },
        )

        result = service.generate_quiz(self.lesson, request)

        self.assertIsInstance(result, QuizGenerationResult)
        self.assertEqual(result.model, "test-qwen")
        self.assertEqual(result.quiz.title, "Cellular Biology Assessment")
        self.assertEqual(len(result.quiz.questions), 4)
        self.assertEqual(result.quiz.questions[0].type, "multiple_choice")
        self.assertEqual(result.quiz.questions[1].type, "true_false")
        self.assertEqual(result.quiz.questions[2].type, "identification")
        self.assertEqual(result.quiz.questions[3].type, "essay")

    def test_rejects_empty_lesson_content(self):
        mock_client = MockLLMClient(response_json={})
        service = QuizGenerationService(llm_client=mock_client)
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 1},
        )
        empty_lesson = ExtractedLessonContent(
            lesson_id="empty",
            title="Empty",
            topic="None",
            passages=[],
            full_text="",
            word_count=0,
        )
        with self.assertRaises(QuizGenerationServiceError):
            service.generate_quiz(empty_lesson, request)

    def test_rejects_non_dict_model_response(self):
        mock_client = MockLLMClient(response_json=["not", "a", "dict"])
        service = QuizGenerationService(llm_client=mock_client)
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 1},
        )
        with self.assertRaises(SchemaValidationError):
            service.generate_quiz(self.lesson, request)

    def test_rejects_missing_questions_array(self):
        mock_client = MockLLMClient(response_json={"title": "Quiz", "no_questions_here": True})
        service = QuizGenerationService(llm_client=mock_client)
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 1},
        )
        with self.assertRaises(SchemaValidationError):
            service.generate_quiz(self.lesson, request)

    def test_rejects_invalid_question_schema(self):
        invalid_mcq_payload = {
            "title": "Quiz",
            "topic": "Bio",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "What organelle?",
                    "options": ["A", "B", "C"],  # only 3 options (violates 4 options requirement)
                    "correct_answer": "A",
                    "explanation": "Exp",
                    "evidence": {"quote": "Evidence text", "block_index": 0},
                }
            ],
        }
        mock_client = MockLLMClient(response_json=invalid_mcq_payload)
        service = QuizGenerationService(llm_client=mock_client)
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 1},
        )
        with self.assertRaises(SchemaValidationError):
            service.generate_quiz(self.lesson, request)

    def test_rejects_question_count_mismatch(self):
        model_payload = {
            "title": "Quiz",
            "topic": "Bio",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Q1",
                    "options": ["A", "B", "C", "D"],
                    "correct_answer": "A",
                    "explanation": "Exp",
                    "evidence": {"quote": "Evidence", "block_index": 0},
                }
            ],
        }
        mock_client = MockLLMClient(response_json=model_payload)
        service = QuizGenerationService(llm_client=mock_client)
        # Requested 2 multiple_choice, model only returned 1
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 2},
        )
        with self.assertRaises(QuestionCountMismatchError):
            service.generate_quiz(self.lesson, request)

    def test_rejects_unrequested_question_type_substitution(self):
        model_payload = {
            "title": "Quiz",
            "topic": "Bio",
            "questions": [
                {
                    "type": "true_false",  # Substituted TF when only MCQ requested
                    "prompt": "Statement?",
                    "correct_answer": True,
                    "explanation": "Exp",
                    "evidence": {"quote": "Evidence", "block_index": 0},
                }
            ],
        }
        mock_client = MockLLMClient(response_json=model_payload)
        service = QuizGenerationService(llm_client=mock_client)
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 1},
        )
        with self.assertRaises(QuestionCountMismatchError):
            service.generate_quiz(self.lesson, request)

    def test_propagates_provider_exceptions_cleanly(self):
        mock_client = MockLLMClient(
            error_to_raise=LLMConnectionError("Failed to connect to provider")
        )
        service = QuizGenerationService(llm_client=mock_client)
        request = QuizGenerationRequest(
            lesson_id="lesson-bio",
            question_counts={"multiple_choice": 1},
        )
        with self.assertRaises(LLMConnectionError):
            service.generate_quiz(self.lesson, request)


from app.validation import SourceGroundingValidator, AnswerCorrectnessValidator, QuizValidator


class TestValidation(unittest.TestCase):
    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-bio-val",
            title="Cellular Energy and Organelles",
            topic="Biology",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                ),
                ExtractedPassage(
                    block_index=1,
                    block_type="paragraph",
                    text="Ribosomes are macromolecular machines found within all cells that perform biological protein synthesis.",
                ),
            ],
            full_text="Mitochondria generate ATP... Ribosomes perform protein synthesis.",
            word_count=28,
        )
        self.validator = QuizValidator()

    def test_valid_grounding_and_correctness_passes(self):
        mcq = MultipleChoiceQuestion(
            prompt="Which organelle generates chemical energy in the form of ATP?",
            options=["Mitochondria", "Ribosome", "Nucleus", "Endoplasmic Reticulum"],
            correct_answer="Mitochondria",
            explanation="Mitochondria generate chemical energy in the form of ATP.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[mcq],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertTrue(report.is_valid)
        self.assertEqual(report.status, "passed")
        self.assertTrue(report.grounding_passed)
        self.assertTrue(report.correctness_passed)
        self.assertEqual(len(report.question_reports), 1)
        self.assertEqual(report.question_reports[0].status, "passed")
        self.assertTrue(report.question_reports[0].quote_valid)
        self.assertTrue(report.question_reports[0].block_reference_valid)

    def test_fabricated_quote_fails_validation(self):
        mcq = MultipleChoiceQuestion(
            prompt="What is ATP?",
            options=["Energy molecule", "A protein", "A lipid", "A sugar"],
            correct_answer="Energy molecule",
            explanation="ATP is an energy molecule.",
            evidence=SourceEvidence(
                quote="This fabricated sentence was never written in the lesson text.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[mcq],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")
        self.assertFalse(report.grounding_passed)
        self.assertFalse(report.question_reports[0].quote_valid)
        self.assertEqual(report.question_reports[0].status, "failed")

    def test_quote_in_wrong_block_fails_block_reference(self):
        # Quote is in block 1 (Ribosomes), but evidence cites block 0 (Mitochondria)
        mcq = MultipleChoiceQuestion(
            prompt="Which machines perform protein synthesis?",
            options=["Ribosomes", "Mitochondria", "Lysosomes", "Vacuoles"],
            correct_answer="Ribosomes",
            explanation="Ribosomes perform biological protein synthesis.",
            evidence=SourceEvidence(
                quote="Ribosomes are macromolecular machines found within all cells that perform biological protein synthesis.",
                block_index=0,  # Cited block 0, but it is actually in block 1!
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[mcq],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")
        self.assertTrue(report.question_reports[0].quote_valid)  # Quote text exists in lesson
        self.assertFalse(report.question_reports[0].block_reference_valid)  # But block index was wrong
        self.assertIn("block reference mismatch", [issue.message for issue in report.question_reports[0].issues][0].lower())

    def test_invalid_block_index_out_of_range(self):
        mcq = MultipleChoiceQuestion(
            prompt="Which organelle generates ATP?",
            options=["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
            correct_answer="Mitochondria",
            explanation="Mitochondria generate ATP.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                block_index=99,  # Out of range
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[mcq],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")

    def test_evidence_quote_does_not_support_answer(self):
        # Quote is from block 1 (about Ribosomes), question asks about mitochondria and ATP
        mcq = MultipleChoiceQuestion(
            prompt="Which organelle generates cellular ATP?",
            options=["Mitochondria", "Chloroplast", "Golgi", "Peroxisome"],
            correct_answer="Mitochondria",
            explanation="Mitochondria synthesize ATP.",
            evidence=SourceEvidence(
                quote="Ribosomes are macromolecular machines found within all cells that perform biological protein synthesis.",
                block_index=1,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[mcq],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")
        self.assertEqual(report.question_reports[0].evidence_supported, "failed")

    def test_true_false_unsupported_statement(self):
        tf = TrueFalseQuestion(
            prompt="The planet Mars has two moons named Phobos and Deimos.",
            correct_answer=True,
            explanation="Astronomical fact about Mars.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[tf],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")

    def test_identification_unsupported_answer(self):
        ident = IdentificationQuestion(
            prompt="What is the nuclear envelope?",
            correct_answer="Nuclear Envelope",
            accepted_alternatives=["Karyotheca"],
            explanation="Membrane surrounding nucleus.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[ident],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")
        self.assertEqual(report.question_reports[0].evidence_supported, "failed")

    def test_essay_vague_rubric_fails_correctness(self):
        essay = EssayQuestion(
            prompt="Explain the structure and primary energetic function of mitochondria.",
            rubric=["ok"],  # Rubric item is too short / vague (< 5 chars)
            sample_solution="Mitochondria are double-membraned...",
            explanation="Mitochondrial energetic function.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[essay],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")
        self.assertEqual(report.question_reports[0].answer_correct, "failed")

    def test_overall_quiz_rejection_when_any_question_fails(self):
        # 1 valid MCQ and 1 invalid MCQ
        mcq_valid = MultipleChoiceQuestion(
            prompt="Which organelle generates ATP?",
            options=["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
            correct_answer="Mitochondria",
            explanation="Mitochondria generate ATP.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of ATP.",
                block_index=0,
            ),
        )
        mcq_invalid = MultipleChoiceQuestion(
            prompt="What performs protein synthesis?",
            options=["Ribosomes", "Mitochondria", "Nucleus", "Golgi"],
            correct_answer="Ribosomes",
            explanation="Ribosomes synthesize proteins.",
            evidence=SourceEvidence(
                quote="Fabricated text not in lesson.",
                block_index=1,
            ),
        )
        quiz = GeneratedQuiz(
            title="Bio Quiz",
            topic="Biology",
            lesson_id="lesson-bio-val",
            questions=[mcq_valid, mcq_invalid],
        )

        report = self.validator.validate_quiz(quiz, self.lesson)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.status, "failed")
        self.assertEqual(report.question_reports[0].status, "passed")
        self.assertEqual(report.question_reports[1].status, "failed")


from app.services.quiz_generation_orchestrator import (
    QuizGenerationOrchestrator,
    QuizOrchestrationError,
    MaxAttemptsExceededError,
)


class SequenceMockLLMClient(BaseLLMClient):
    def __init__(self, responses):
        self.responses = list(responses)
        self.call_count = 0
        self.prompts = []

    def generate_structured(self, prompt, system_instruction=None, schema=None, temperature=0.2):
        self.call_count += 1
        self.prompts.append((system_instruction, prompt))
        if not self.responses:
            raise Exception("No more responses in mock sequence")
        resp = self.responses.pop(0)
        if isinstance(resp, Exception):
            raise resp
        return LLMResponse(
            raw_text=json.dumps(resp),
            parsed_json=resp,
            model="mock-seq-qwen",
            duration_ms=100.0,
            prompt_tokens=40,
            completion_tokens=60,
        )


class TestOrchestrator(unittest.TestCase):
    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-orch",
            title="Cell Energetics",
            topic="Cytology",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Mitochondria are organelles that generate chemical energy in the form of ATP.",
                ),
            ],
            full_text="Mitochondria are organelles that generate chemical energy in the form of ATP.",
            word_count=18,
        )
        self.request = QuizGenerationRequest(
            lesson_id="lesson-orch",
            question_counts={"multiple_choice": 1},
        )
        self.valid_mcq_payload = {
            "title": "Energetics Quiz",
            "topic": "Cytology",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria generate ATP.",
                    "evidence": {
                        "quote": "Mitochondria are organelles that generate chemical energy in the form of ATP.",
                        "block_index": 0,
                    },
                }
            ],
        }
        self.invalid_quote_payload = {
            "title": "Energetics Quiz",
            "topic": "Cytology",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria generate ATP.",
                    "evidence": {
                        "quote": "This sentence is completely fabricated.",
                        "block_index": 0,
                    },
                }
            ],
        }

    def test_first_attempt_succeeds(self):
        mock_client = SequenceMockLLMClient([self.valid_mcq_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=2)

        result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertTrue(result.success)
        self.assertIsNotNone(result.quiz)
        self.assertEqual(result.attempts, 1)
        self.assertEqual(mock_client.call_count, 1)
        self.assertEqual(result.validation_report.status, "passed")

    def test_first_attempt_fails_validation_second_attempt_succeeds(self):
        # First attempt produces fabricated quote; second attempt fixes it
        mock_client = SequenceMockLLMClient([self.invalid_quote_payload, self.valid_mcq_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=2)

        result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertTrue(result.success)
        self.assertIsNotNone(result.quiz)
        self.assertEqual(result.attempts, 2)
        self.assertEqual(mock_client.call_count, 2)
        # Ensure corrective feedback was sent to attempt 2 prompt
        second_prompt = mock_client.prompts[1][1]
        self.assertIn("CORRECTIVE DIRECTIVE FOR RETRY ATTEMPT 2", second_prompt)
        self.assertIn("fabricated", second_prompt.lower())

    def test_all_attempts_fail_validation_returns_clean_failure(self):
        # Both attempts produce invalid quotes
        mock_client = SequenceMockLLMClient([self.invalid_quote_payload, self.invalid_quote_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=2)

        result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertFalse(result.success)
        # Crucial safety check: NEVER return unverified quiz on failure!
        self.assertIsNone(result.quiz)
        self.assertEqual(result.attempts, 2)
        self.assertEqual(mock_client.call_count, 2)
        self.assertIsNotNone(result.validation_report)
        self.assertEqual(result.validation_report.status, "failed")

    def test_raise_on_failure_flag(self):
        mock_client = SequenceMockLLMClient([self.invalid_quote_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=1)

        with self.assertRaises(MaxAttemptsExceededError):
            orchestrator.orchestrate_generation(self.lesson, self.request, raise_on_failure=True)

    def test_invalid_max_attempts_configuration_rejected(self):
        service = QuizGenerationService(llm_client=SequenceMockLLMClient([]))
        with self.assertRaises(ValueError):
            QuizGenerationOrchestrator(generation_service=service, max_attempts=0)

    def test_permanent_provider_error_not_retried(self):
        mock_client = SequenceMockLLMClient([
            LLMModelNotFoundError("Model 'qwen:99b' not found on Ollama")
        ])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=3)

        with self.assertRaises(LLMModelNotFoundError):
            orchestrator.orchestrate_generation(self.lesson, self.request)

        # Permanent error must immediately fail without executing attempts 2 or 3
        self.assertEqual(mock_client.call_count, 1)

    def test_transient_provider_error_retries_and_succeeds(self):
        mock_client = SequenceMockLLMClient([
            LLMTimeoutError("Request timed out"),
            self.valid_mcq_payload,
        ])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=2)

        result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertTrue(result.success)
        self.assertEqual(result.attempts, 2)
        self.assertEqual(mock_client.call_count, 2)

    def test_insufficient_lesson_content_fails_without_llm_call(self):
        empty_lesson_data = {
            "id": "empty",
            "title": "Empty",
            "topic": "None",
            "content": {"blocks": []},
        }
        mock_client = SequenceMockLLMClient([self.valid_mcq_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=2)

        with self.assertRaises(InsufficientLessonContentError):
            orchestrator.orchestrate_generation(empty_lesson_data, self.request)

        # LLM must not be called when content is insufficient
        self.assertEqual(mock_client.call_count, 0)

    def test_question_counts_do_not_change_during_retries(self):
        mock_client = SequenceMockLLMClient([self.invalid_quote_payload, self.valid_mcq_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(generation_service=service, max_attempts=2)

        req = QuizGenerationRequest(
            lesson_id="lesson-orch",
            question_counts={"multiple_choice": 1},
        )
        result = orchestrator.orchestrate_generation(self.lesson, req)

        self.assertTrue(result.success)
        self.assertEqual(len(result.quiz.questions), 1)
        self.assertEqual(result.quiz.questions[0].type, "multiple_choice")


from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from test_lessons import FakeDatabase, NOW
from app.api import lessons
from app.models.generation import GenerateQuizRequestBody, OrchestrationResult


class TestQuizGenerationAPI(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase()
        self.accounts = {
            "teacher-1": SimpleNamespace(disabled=False),
            "teacher-2": SimpleNamespace(disabled=False),
            "teacher-disabled": SimpleNamespace(disabled=True),
            "student-1": SimpleNamespace(disabled=False),
        }

        # Seed users
        self.database.collection("users").documents["teacher-1"] = {
            "role": "teacher",
            "status": "active",
        }
        self.database.collection("users").documents["teacher-2"] = {
            "role": "teacher",
            "status": "active",
        }
        self.database.collection("users").documents["teacher-disabled"] = {
            "role": "teacher",
            "status": "inactive",
        }
        self.database.collection("users").documents["student-1"] = {
            "role": "student",
            "status": "active",
        }

        # Seed active class, subject, assignment
        self.database.collection("classes").documents["class-1"] = {
            "name": "Class 101",
            "grade_level": "Grade 1",
            "status": "active",
        }
        self.database.collection("subjects").documents["subject-1"] = {
            "name": "Biology",
            "code": "BIO101",
            "status": "active",
            "teacher_ids": ["teacher-1"],
        }
        self.database.collection("class_teacher_assignments").documents["assign-1"] = {
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_uid": "teacher-1",
            "status": "active",
        }

        # Seed valid lesson
        self.database.collection("lessons").documents["lesson-1"] = {
            "title": "Cell Biology",
            "topic": "Cytology",
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_id": "teacher-1",
            "status": "draft",
            "content": {
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of adenosine triphosphate (ATP) for cellular processes.",
                    }
                ]
            },
            "created_at": NOW,
            "updated_at": NOW,
            "published_at": None,
        }

        # Seed empty lesson
        self.database.collection("lessons").documents["lesson-empty"] = {
            "title": "Empty Lesson",
            "topic": "None",
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_id": "teacher-1",
            "status": "draft",
            "content": {"blocks": []},
            "created_at": NOW,
            "updated_at": NOW,
            "published_at": None,
        }

        # Seed other teacher's lesson
        self.database.collection("lessons").documents["lesson-other-teacher"] = {
            "title": "Other Teacher Lesson",
            "topic": "None",
            "class_id": "class-1",
            "subject_id": "subject-1",
            "teacher_id": "teacher-2",
            "status": "draft",
            "content": {
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "Some substantive paragraph here for testing other teacher.",
                    }
                ]
            },
            "created_at": NOW,
            "updated_at": NOW,
            "published_at": None,
        }

        self.mock_orchestrator = MagicMock()

        self.app = FastAPI()
        self.app.include_router(lessons.router)
        self.app.dependency_overrides[lessons.verify_firebase_token] = self.mock_verify_token
        self.app.dependency_overrides[lessons.get_quiz_orchestrator] = lambda: self.mock_orchestrator

        self.database_patch = patch.object(lessons, "get_database", return_value=self.database)
        self.database_patch.start()
        self.auth_patch = patch.object(lessons.firebase_auth, "get_user", side_effect=self.get_account)
        self.auth_patch.start()
        self.addCleanup(self.database_patch.stop)
        self.addCleanup(self.auth_patch.stop)
        self.addCleanup(self.app.dependency_overrides.clear)

        self.client = TestClient(self.app)

    def mock_verify_token(self, request: Request):
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing bearer token")
        token = auth_header.removeprefix("Bearer ").strip()
        roles = {
            "teacher-1": "teacher",
            "teacher-2": "teacher",
            "teacher-disabled": "teacher",
            "student-1": "student",
        }
        if token not in roles:
            raise HTTPException(status_code=401, detail="Invalid Firebase ID token")
        return {"uid": token, "role": roles[token]}

    def get_account(self, uid):
        try:
            return self.accounts[uid]
        except KeyError:
            raise lessons.firebase_auth.UserNotFoundError("User not found", uid)

    def test_missing_auth_header_rejected(self):
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 401)

    def test_student_role_rejected(self):
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer student-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("Insufficient permissions", res.json()["detail"])

    def test_inactive_teacher_account_rejected(self):
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-disabled"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("active account is required", res.json()["detail"].lower())

    def test_teacher_unauthorized_lesson_returns_404(self):
        # Teacher 1 requesting lesson belonging to Teacher 2
        res = self.client.post(
            "/lessons/lesson-other-teacher/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 404)
        self.assertIn("Lesson not found", res.json()["detail"])

    def test_inactive_class_rejected(self):
        self.database.collection("classes").documents["class-1"]["status"] = "inactive"
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 403)

    def test_inactive_subject_rejected(self):
        self.database.collection("subjects").documents["subject-1"]["status"] = "inactive"
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 403)

    def test_unassigned_teacher_rejected(self):
        self.database.collection("class_teacher_assignments").documents["assign-1"]["status"] = "inactive"
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 403)

    def test_empty_lesson_rejected_before_model_invocation(self):
        res = self.client.post(
            "/lessons/lesson-empty/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("substantive", res.json()["detail"].lower())
        self.mock_orchestrator.orchestrate_generation.assert_not_called()

    def test_invalid_question_counts_rejected(self):
        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 0}},
        )
        self.assertEqual(res.status_code, 422)
        self.mock_orchestrator.orchestrate_generation.assert_not_called()

    def test_successful_quiz_generation_and_persistence(self):
        mcq = MultipleChoiceQuestion(
            prompt="Which organelle generates ATP?",
            options=["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
            correct_answer="Mitochondria",
            explanation="Mitochondria generate ATP.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound cell organelles that generate chemical energy in the form of adenosine triphosphate (ATP) for cellular processes.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Cell Energy Quiz",
            topic="Cytology",
            lesson_id="lesson-1",
            questions=[mcq],
        )
        report = QuizValidationReport(
            status="passed",
            is_valid=True,
            grounding_passed=True,
            correctness_passed=True,
            question_reports=[
                QuestionValidationReport(
                    question_index=0,
                    status="passed",
                    grounding_passed=True,
                    correctness_passed=True,
                )
            ],
            general_issues=[],
        )

        self.mock_orchestrator.orchestrate_generation.return_value = OrchestrationResult(
            success=True,
            quiz=quiz,
            validation_report=report,
            attempts=1,
            model="qwen2.5:3b",
        )

        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}, "instructions": "Focus on ATP"},
        )

        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["lesson_id"], "lesson-1")
        self.assertEqual(data["teacher_id"], "teacher-1")
        self.assertEqual(data["title"], "Cell Energy Quiz")
        self.assertEqual(len(data["questions"]), 1)
        self.assertEqual(data["questions"][0]["type"], "multiple_choice")
        self.assertEqual(data["model_id"], "qwen2.5:3b")
        generated_lesson = self.mock_orchestrator.orchestrate_generation.call_args.kwargs[
            "lesson"
        ]
        self.assertIn(
            "Mitochondria are membrane-bound cell organelles",
            generated_lesson.full_text,
        )
        self.assertEqual(len(generated_lesson.passages), 1)
        self.assertEqual(generated_lesson.passages[0].block_index, 0)

        # Verify exactly one document written to quizzes collection
        quizzes = self.database.documents.get("quizzes", {})
        self.assertEqual(len(quizzes), 1)
        persisted_draft = list(quizzes.values())[0]
        self.assertEqual(persisted_draft["status"], "draft")
        self.assertEqual(persisted_draft["lesson_id"], "lesson-1")
        self.assertEqual(persisted_draft["teacher_id"], "teacher-1")
        self.assertEqual(persisted_draft["class_id"], "class-1")
        self.assertEqual(persisted_draft["subject_id"], "subject-1")

        # Verify original lesson was NOT overwritten or modified
        orig_lesson = self.database.documents["lessons"]["lesson-1"]
        self.assertEqual(orig_lesson["title"], "Cell Biology")

    def test_failed_validation_never_persists_draft(self):
        report = QuizValidationReport(
            status="failed",
            is_valid=False,
            grounding_passed=False,
            correctness_passed=False,
            question_reports=[],
            general_issues=[],
        )
        self.mock_orchestrator.orchestrate_generation.return_value = OrchestrationResult(
            success=False,
            quiz=None,
            validation_report=report,
            attempts=2,
            error_message="Validation failed completely.",
        )

        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )

        self.assertEqual(res.status_code, 422)
        quizzes = self.database.documents.get("quizzes", {})
        self.assertEqual(len(quizzes), 0)

    def test_needs_review_validation_never_persists_draft(self):
        mcq = MultipleChoiceQuestion(
            prompt="Which organelle generates ATP?",
            options=["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
            correct_answer="Mitochondria",
            explanation="Mitochondria generate ATP.",
            evidence=SourceEvidence(
                quote="Mitochondria are membrane-bound organelles that generate chemical energy in the form of ATP.",
                block_index=0,
            ),
        )
        quiz = GeneratedQuiz(
            title="Cell Energy Quiz",
            topic="Cytology",
            lesson_id="lesson-1",
            questions=[mcq],
        )
        report = QuizValidationReport(
            status="needs_review",
            is_valid=False,  # needs_review is NOT valid
            grounding_passed=True,
            correctness_passed=True,
            question_reports=[],
            general_issues=[],
        )
        self.mock_orchestrator.orchestrate_generation.return_value = OrchestrationResult(
            success=True,
            quiz=quiz,
            validation_report=report,
            attempts=1,
        )

        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )

        self.assertEqual(res.status_code, 422)
        quizzes = self.database.documents.get("quizzes", {})
        self.assertEqual(len(quizzes), 0)

    def test_llm_provider_error_returns_clean_502(self):
        from app.ai.client import LLMConnectionError
        self.mock_orchestrator.orchestrate_generation.side_effect = LLMConnectionError("Connection refused")

        res = self.client.post(
            "/lessons/lesson-1/generate-quiz",
            headers={"Authorization": "Bearer teacher-1"},
            json={"question_counts": {"multiple_choice": 1}},
        )

        self.assertEqual(res.status_code, 502)
        self.assertIn("unavailable", res.json()["detail"].lower())
        # Confirm no raw exception text was leaked to client
        self.assertNotIn("Connection refused", res.json()["detail"])


from app.models.generation import (
    build_quiz_response_schema,
    _MC_QUESTION_SCHEMA,
    _TF_QUESTION_SCHEMA,
    _IDENT_QUESTION_SCHEMA,
    _ESSAY_QUESTION_SCHEMA,
    _QUESTION_TYPE_ENUM,
)


class TestQuizResponseSchema(unittest.TestCase):
    """Regression tests for the Ollama JSON schema (Phase 7)."""

    def setUp(self):
        self.schema = build_quiz_response_schema()

    def test_schema_requires_title_topic_questions(self):
        self.assertEqual(self.schema["type"], "object")
        self.assertIn("title", self.schema["properties"])
        self.assertIn("topic", self.schema["properties"])
        self.assertIn("questions", self.schema["properties"])
        self.assertEqual(sorted(self.schema["required"]), ["questions", "title", "topic"])

    def test_questions_items_use_anyOf_with_four_types(self):
        items = self.schema["properties"]["questions"]["items"]
        self.assertIn("anyOf", items)
        self.assertEqual(len(items["anyOf"]), 4)

    def test_every_question_subschema_requires_type(self):
        """Each of the four question sub-schemas MUST list 'type' as required."""
        for sub in [_MC_QUESTION_SCHEMA, _TF_QUESTION_SCHEMA, _IDENT_QUESTION_SCHEMA, _ESSAY_QUESTION_SCHEMA]:
            self.assertIn("type", sub["required"], f"'type' not required in {sub}")

    def test_type_enum_values_match_allowed_types(self):
        """Each sub-schema restricts 'type' to exactly its own literal value."""
        expected_map = {
            "multiple_choice": _MC_QUESTION_SCHEMA,
            "true_false": _TF_QUESTION_SCHEMA,
            "identification": _IDENT_QUESTION_SCHEMA,
            "essay": _ESSAY_QUESTION_SCHEMA,
        }
        for type_val, sub in expected_map.items():
            self.assertEqual(sub["properties"]["type"]["enum"], [type_val])

    def test_question_type_enum_covers_all_allowed(self):
        self.assertEqual(
            sorted(_QUESTION_TYPE_ENUM),
            sorted(["multiple_choice", "true_false", "identification", "essay"]),
        )

    def test_optional_fields_not_required(self):
        """accepted_alternatives, sample_solution, context must NOT be required."""
        self.assertNotIn("accepted_alternatives", _IDENT_QUESTION_SCHEMA["required"])
        self.assertNotIn("sample_solution", _ESSAY_QUESTION_SCHEMA["required"])

    def test_schema_is_fresh_copy_each_call(self):
        """build_quiz_response_schema returns a new dict each time (no mutation risk)."""
        s1 = build_quiz_response_schema()
        s2 = build_quiz_response_schema()
        self.assertEqual(s1, s2)
        s1["extra_key"] = True
        s3 = build_quiz_response_schema()
        self.assertNotIn("extra_key", s3)


class TestOllamaSchemaPassthrough(unittest.TestCase):
    """Verifies the Ollama client receives the schema in the HTTP request payload."""

    def test_schema_sent_in_format_field(self):
        """When schema is provided, it should appear as 'format' instead of 'json'."""
        captured_payloads = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_payloads.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(
                200,
                json={
                    "model": "qwen2.5:3b",
                    "message": {
                        "role": "assistant",
                        "content": '{"title":"Q","topic":"T","questions":[]}',
                    },
                },
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client, model="qwen2.5:3b")
        test_schema = build_quiz_response_schema()
        ollama.generate_structured(prompt="Generate a quiz", schema=test_schema)

        self.assertEqual(len(captured_payloads), 1)
        payload = captured_payloads[0]
        # Must use the schema dict, not the string "json"
        self.assertIsInstance(payload["format"], dict)
        self.assertEqual(payload["format"], test_schema)

    def test_no_schema_falls_back_to_json_string(self):
        """Without schema, format should remain 'json' for backward compatibility."""
        captured_payloads = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_payloads.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(
                200,
                json={
                    "model": "qwen2.5:3b",
                    "message": {"role": "assistant", "content": '{"ok": true}'},
                },
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        ollama = OllamaClient(client=client)
        ollama.generate_structured(prompt="Test")

        self.assertEqual(captured_payloads[0]["format"], "json")


class TestServicePassesSchema(unittest.TestCase):
    """Verifies the QuizGenerationService passes a schema to the LLM client."""

    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-schema-test",
            title="Schema Test Lesson",
            topic="Testing",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Mitochondria are organelles that generate ATP for cellular energy.",
                ),
            ],
            full_text="Mitochondria are organelles that generate ATP for cellular energy.",
            word_count=10,
        )
        self.valid_payload = {
            "title": "Schema Test Quiz",
            "topic": "Testing",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria generate ATP.",
                    "evidence": {
                        "quote": "Mitochondria are organelles that generate ATP for cellular energy.",
                        "block_index": 0,
                    },
                }
            ],
        }

    def test_generate_quiz_passes_schema_to_client(self):
        """generate_quiz must call generate_structured with schema= kwarg."""
        received_schemas = []

        class SchemaCapturingClient(BaseLLMClient):
            def generate_structured(self, prompt, system_instruction=None, schema=None, temperature=0.2):
                received_schemas.append(schema)
                return LLMResponse(
                    raw_text=json.dumps(self.payload),
                    parsed_json=self.payload,
                    model="test-model",
                    duration_ms=50.0,
                    prompt_tokens=10,
                    completion_tokens=20,
                )

        client = SchemaCapturingClient()
        client.payload = self.valid_payload
        service = QuizGenerationService(llm_client=client)
        request = QuizGenerationRequest(
            lesson_id="lesson-schema-test",
            question_counts={"multiple_choice": 1},
        )
        service.generate_quiz(self.lesson, request)

        self.assertEqual(len(received_schemas), 1)
        schema = received_schemas[0]
        self.assertIsNotNone(schema)
        self.assertIsInstance(schema, dict)
        # Verify it matches the canonical schema
        self.assertEqual(schema, build_quiz_response_schema())


class TestMissingNullUnsupportedTypeRejection(unittest.TestCase):
    """Verifies that _parse_question rejects missing, null, and unsupported type values."""

    def setUp(self):
        self.service = QuizGenerationService(llm_client=MockLLMClient(response_json={}))
        self.base_question = {
            "prompt": "Which organelle generates ATP?",
            "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
            "correct_answer": "Mitochondria",
            "explanation": "Mitochondria generate ATP.",
            "evidence": {"quote": "Evidence text", "block_index": 0},
        }

    def test_missing_type_rejected(self):
        raw_q = dict(self.base_question)  # No 'type' key
        with self.assertRaises(SchemaValidationError) as ctx:
            self.service._parse_question(raw_q, 0)
        self.assertIn("unsupported type", ctx.exception.message.lower())
        self.assertIn("None", ctx.exception.message)

    def test_null_type_rejected(self):
        raw_q = dict(self.base_question, type=None)
        with self.assertRaises(SchemaValidationError) as ctx:
            self.service._parse_question(raw_q, 0)
        self.assertIn("unsupported type", ctx.exception.message.lower())
        self.assertIn("None", ctx.exception.message)

    def test_unsupported_type_rejected(self):
        raw_q = dict(self.base_question, type="fill_in_the_blank")
        with self.assertRaises(SchemaValidationError) as ctx:
            self.service._parse_question(raw_q, 0)
        self.assertIn("unsupported type", ctx.exception.message.lower())
        self.assertIn("fill_in_the_blank", ctx.exception.message)

    def test_empty_string_type_rejected(self):
        raw_q = dict(self.base_question, type="")
        with self.assertRaises(SchemaValidationError) as ctx:
            self.service._parse_question(raw_q, 0)
        self.assertIn("unsupported type", ctx.exception.message.lower())

    def test_valid_types_accepted(self):
        """All four valid types should parse without SchemaValidationError."""
        valid_questions = [
            {
                "type": "multiple_choice",
                "prompt": "Q?",
                "options": ["A", "B", "C", "D"],
                "correct_answer": "A",
                "explanation": "E",
                "evidence": {"quote": "Evidence", "block_index": 0},
            },
            {
                "type": "true_false",
                "prompt": "Statement?",
                "correct_answer": True,
                "explanation": "E",
                "evidence": {"quote": "Evidence", "block_index": 0},
            },
            {
                "type": "identification",
                "prompt": "Name?",
                "correct_answer": "Answer",
                "explanation": "E",
                "evidence": {"quote": "Evidence", "block_index": 0},
            },
            {
                "type": "essay",
                "prompt": "Describe?",
                "rubric": ["Point 1"],
                "explanation": "E",
                "evidence": {"quote": "Evidence", "block_index": 0},
            },
        ]
        for i, raw_q in enumerate(valid_questions):
            parsed = self.service._parse_question(raw_q, i)
            self.assertEqual(parsed.type, raw_q["type"])


class TestOrchestratorMalformedRetryAndFailure(unittest.TestCase):
    """
    Regression tests for retry recovery from malformed responses and
    failure after repeated malformed responses with no draft persistence.
    """

    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-retry",
            title="Retry Test",
            topic="Testing",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Mitochondria are organelles that generate chemical energy in the form of ATP.",
                ),
            ],
            full_text="Mitochondria are organelles that generate chemical energy in the form of ATP.",
            word_count=12,
        )
        self.request = QuizGenerationRequest(
            lesson_id="lesson-retry",
            question_counts={"multiple_choice": 1},
        )
        self.valid_payload = {
            "title": "Retry Quiz",
            "topic": "Testing",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria generate ATP.",
                    "evidence": {
                        "quote": "Mitochondria are organelles that generate chemical energy in the form of ATP.",
                        "block_index": 0,
                    },
                }
            ],
        }
        self.malformed_no_type_payload = {
            "title": "Bad Quiz",
            "topic": "Testing",
            "questions": [
                {
                    # Missing 'type' key entirely
                    "prompt": "Which organelle generates ATP?",
                    "options": ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
                    "correct_answer": "Mitochondria",
                    "explanation": "Mitochondria generate ATP.",
                    "evidence": {
                        "quote": "Mitochondria are organelles that generate chemical energy in the form of ATP.",
                        "block_index": 0,
                    },
                }
            ],
        }

    def test_recovery_when_first_attempt_missing_type_second_valid(self):
        """First attempt omits type (SchemaValidationError), retry succeeds."""
        mock_client = SequenceMockLLMClient([
            self.malformed_no_type_payload,
            self.valid_payload,
        ])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(
            generation_service=service, max_attempts=2
        )

        result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertTrue(result.success)
        self.assertIsNotNone(result.quiz)
        self.assertEqual(result.attempts, 2)
        self.assertEqual(mock_client.call_count, 2)
        self.assertEqual(len(result.quiz.questions), 1)
        self.assertEqual(result.quiz.questions[0].type, "multiple_choice")

    def test_failure_after_repeated_malformed_no_draft(self):
        """Both attempts have missing type -> clean failure, quiz is None."""
        mock_client = SequenceMockLLMClient([
            self.malformed_no_type_payload,
            self.malformed_no_type_payload,
        ])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(
            generation_service=service, max_attempts=2
        )

        result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertFalse(result.success)
        self.assertIsNone(result.quiz)  # NEVER persist failed drafts
        self.assertEqual(result.attempts, 2)
        self.assertEqual(mock_client.call_count, 2)
        self.assertIn("unsupported type", result.error_message.lower())

    def test_failure_after_repeated_malformed_raises_when_requested(self):
        """With raise_on_failure=True, repeated malformed raises MaxAttemptsExceededError."""
        mock_client = SequenceMockLLMClient([
            self.malformed_no_type_payload,
        ])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(
            generation_service=service, max_attempts=1
        )

        with self.assertRaises(MaxAttemptsExceededError) as ctx:
            orchestrator.orchestrate_generation(
                self.lesson, self.request, raise_on_failure=True
            )
        self.assertIn("unsupported type", str(ctx.exception).lower())


class TestPromptJsonValidity(unittest.TestCase):
    """Verifies the JSON example in the prompt does not contain comments."""

    def test_prompt_json_example_has_no_comments(self):
        lesson = ExtractedLessonContent(
            lesson_id="lesson-prompt-test",
            title="Prompt JSON Test",
            topic="Testing",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Test content with enough words for the prompt builder to accept it.",
                ),
            ],
            full_text="Test content with enough words for the prompt builder to accept it.",
            word_count=12,
        )
        request = QuizGenerationRequest(
            lesson_id="lesson-prompt-test",
            question_counts={"multiple_choice": 1},
        )
        _, user_prompt = build_quiz_prompt(lesson, request)

        # The old prompt had "// Array of question objects..." which is an
        # invalid JS-style comment inside what is presented as JSON
        self.assertNotIn("//", user_prompt)

    def test_prompt_includes_type_guidance(self):
        """Prompt should mention all four allowed type values."""
        lesson = ExtractedLessonContent(
            lesson_id="lesson-type-guide",
            title="Type Guide Test",
            topic="Testing",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Sufficient lesson content for building a valid prompt for quiz generation.",
                ),
            ],
            full_text="Sufficient lesson content for building a valid prompt for quiz generation.",
            word_count=11,
        )
        request = QuizGenerationRequest(
            lesson_id="lesson-type-guide",
            question_counts={"multiple_choice": 1},
        )
        _, user_prompt = build_quiz_prompt(lesson, request)

        for qt in ["multiple_choice", "true_false", "identification", "essay"]:
            self.assertIn(qt, user_prompt)


class TestValidationDiagnostics(unittest.TestCase):
    """Server-side validation diagnostics must be useful and safe."""

    def setUp(self):
        self.lesson = ExtractedLessonContent(
            lesson_id="lesson-diag",
            title="Diag Lesson",
            topic="Testing",
            passages=[
                ExtractedPassage(
                    block_index=0,
                    block_type="paragraph",
                    text="Mitochondria generate ATP.",
                ),
            ],
            full_text="Mitochondria generate ATP.",
            word_count=4,
        )
        self.request = QuizGenerationRequest(
            lesson_id="lesson-diag",
            question_counts={"multiple_choice": 1},
        )
        self.bad_payload = {
            "title": "Bad Quiz",
            "topic": "Testing",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Which organelle generates ATP?",
                    "options": ["SecretAnswer", "B", "C", "D"],
                    "correct_answer": "SecretAnswer",
                    "explanation": "Explanation text.",
                    "evidence": {
                        "quote": "Fabricated quote not in lesson.",
                        "block_index": 0,
                    },
                }
            ],
        }

    def test_both_attempts_are_diagnosed_independently(self):
        mock_client = SequenceMockLLMClient([self.bad_payload, self.bad_payload])
        service = QuizGenerationService(llm_client=mock_client)
        orchestrator = QuizGenerationOrchestrator(
            generation_service=service, max_attempts=2
        )

        with self.assertLogs(
            "app.services.quiz_generation_orchestrator", level="WARNING"
        ) as cm:
            result = orchestrator.orchestrate_generation(self.lesson, self.request)

        self.assertFalse(result.success)
        self.assertIsNone(result.quiz)
        log_text = "\n".join(cm.output)
        self.assertIn("attempt=1", log_text)
        self.assertIn("attempt=2", log_text)
        self.assertIn("status=failed", log_text)
        self.assertIn("grounding_passed=False", log_text)
        self.assertIn("question_index=0", log_text)
        self.assertIn("stage=grounding", log_text)
        self.assertIn("severity=error", log_text)
        self.assertNotIn("SecretAnswer", log_text)


class TestQuizGenerationAPIDiagnostics(TestQuizGenerationAPI):
    """API validation failures stay generic while diagnostics are logged."""

    def test_validation_failure_response_generic_and_logged(self):
        report = QuizValidationReport(
            status="failed",
            is_valid=False,
            grounding_passed=False,
            correctness_passed=False,
            question_reports=[],
            general_issues=[],
        )
        self.mock_orchestrator.orchestrate_generation.return_value = (
            OrchestrationResult(
                success=False,
                quiz=None,
                validation_report=report,
                attempts=2,
                error_message="Generated quiz failed validation after 2 attempt(s).",
            )
        )

        with self.assertLogs("app.api.lessons", level="WARNING") as cm:
            res = self.client.post(
                "/lessons/lesson-1/generate-quiz",
                headers={"Authorization": "Bearer teacher-1"},
                json={"question_counts": {"multiple_choice": 1}},
            )

        self.assertEqual(res.status_code, 422)
        self.assertEqual(
            res.json()["detail"],
            "Generated quiz failed validation after 2 attempt(s).",
        )
        self.assertEqual(len(self.database.documents.get("quizzes", {})), 0)
        self.assertTrue(
            any("Quiz generation failed validation" in line for line in cm.output)
        )
if __name__ == "__main__":
    unittest.main()

