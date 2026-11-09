from typing import Any

from app.extraction.lesson_text import ExtractedLessonContent, evidence_id_for_passage
from app.models.generation import QuizGenerationRequest

SYSTEM_PROMPT = """You are an expert assessment generator for an accredited academic Learning Management System.
Your job is to generate high-quality quiz questions strictly grounded in the provided lesson text.

CRITICAL GROUNDING RULES:
1. Sole Factual Source: Base all questions, options, answer keys, rubrics, and explanations EXCLUSIVELY on the supplied lesson text.
2. No Extrapolation: Do NOT introduce outside facts, dates, theories, or assumptions not explicitly taught in the lesson.
3. Source Evidence Required: For EVERY question, you MUST provide an evidence ID from the supplied lesson in the "evidence.evidence_id" field.
4. Evidence Selection Rules: Select an evidence ID exactly as shown beside a source passage. Do NOT write an evidence quote, paraphrase a passage, invent a passage, or create an evidence ID. The backend will supply the original evidence quote after resolving your selected ID.
5. Student-Friendly Wording: Questions and answer explanations may use simple wording appropriate for elementary students, but every factual claim must remain directly supported by the supplied lesson text.
6. Exact Types & Counts: You must generate the EXACT count requested for each question type. Never substitute one type for another.
7. Strict JSON Output: Output only a single valid JSON object following the specified schema without any markdown commentary outside the JSON.
"""


def build_quiz_prompt(
    lesson: ExtractedLessonContent,
    request: QuizGenerationRequest,
) -> tuple[str, str]:
    """
    Constructs the system instruction and user prompt for quiz generation.
    Returns (system_instruction, user_prompt).
    Raises ValueError if lesson content or requested counts are invalid.
    """
    if not lesson or not lesson.full_text or not lesson.full_text.strip():
        raise ValueError("Cannot build prompt: lesson content is empty.")

    if not request or request.total_questions < 1:
        raise ValueError("Cannot build prompt: no questions requested.")

    # Format passages with block markers for exact evidence citing
    annotated_passages: list[str] = []
    for passage in lesson.passages:
        evidence_id = evidence_id_for_passage(lesson.lesson_id, passage.block_index)
        prefix = f"[Evidence ID: {evidence_id}] [Block {passage.block_index}]"
        annotated_passages.append(f"{prefix} {passage.text}")
    lesson_body = "\n\n".join(annotated_passages)

    # Breakdown of requested counts
    counts_lines: list[str] = []
    for q_type, count in request.question_counts.items():
        if count > 0:
            counts_lines.append(f"- {q_type}: {count}")
    requested_breakdown = "\n".join(counts_lines)

    user_prompt_parts = [
        f"LESSON TITLE: {lesson.title}",
        f"TOPIC: {lesson.topic}",
        "",
        "--- START OF LESSON TEXT ---",
        lesson_body,
        "--- END OF LESSON TEXT ---",
        "",
        "REQUESTED QUESTIONS BREAKDOWN:",
        requested_breakdown,
        f"Total questions requested: {request.total_questions}",
    ]

    if request.instructions and request.instructions.strip():
        user_prompt_parts.extend([
            "",
            "TEACHER INSTRUCTIONS / FOCUS:",
            request.instructions.strip(),
        ])

    user_prompt_parts.extend([
        "",
        "OUTPUT FORMAT REQUIREMENTS:",
        "Return a single JSON object with the following schema:",
        '{',
        '  "title": "string (descriptive quiz title)",',
        '  "topic": "string (topic name)",',
        '  "questions": [',
        '    {"type": "multiple_choice or true_false or identification or essay", "...": "..."}',
        '  ]',
        '}',
        "",
        "QUESTION TYPE SPECIFICATIONS:",
        '1. Multiple-choice ("type": "multiple_choice"):',
        '   - "prompt": string (clear question)',
        '   - "options": [string, string, string, string] (EXACTLY 4 distinct options)',
        '   - "correct_option_index": integer from 0 to 3 (0-based position of the correct option)',
        '   - Do NOT output a separate "correct_answer"; the backend derives it from the selected option',
        '   - "explanation": string that explicitly states why the designated correct answer is correct, connecting it to the relevant lesson concept or evidence; do not merely repeat the answer or introduce facts absent from the lesson',
        '   - "evidence": {"evidence_id": "ID copied from the supplied lesson"}',
        "",
        '2. True/False ("type": "true_false"):',
        '   - "prompt": string (unambiguous declarative statement)',
        '   - "correct_answer": boolean (true or false)',
        '   - "explanation": for a true statement, explain why the lesson supports it; for a false statement, identify what is incorrect and provide a correction supported by the lesson. Do not merely say the statement is false or invent an unsupported correction',
        '   - "evidence": {"evidence_id": "ID copied from the supplied lesson"}',
        "",
        '3. Identification ("type": "identification"):',
        '   - "prompt": string (direct question expecting a specific term or concept)',
        '   - "correct_answer": string (primary expected answer)',
        '   - "accepted_alternatives": [string] (list of acceptable alternative spellings/terms; omit or empty if none)',
        '   - "explanation": string (definition or context from lesson)',
        '   - "evidence": {"evidence_id": "ID copied from the supplied lesson"}',
        "",
        '4. Essay ("type": "essay"):',
        '   - "prompt": string (open-ended conceptual question)',
        '   - "rubric": [string] (list of key concepts required for full credit; minimum 1 item)',
        '   - "sample_solution": string or null (example comprehensive answer)',
        '   - "explanation": string (pedagogical background from lesson)',
        '   - "evidence": {"evidence_id": "ID copied from the supplied lesson"}',
        "",
        "EVIDENCE REMINDER: Return only an evidence_id copied exactly from the evidence IDs shown beside the supplied lesson passages. Do not return evidence.quote, do not paraphrase or summarize evidence, and do not invent or modify an evidence ID. The backend will resolve the ID to the original lesson passage.",
        "REMINDER: Do NOT invent facts. Every question, correct answer, and rubric element MUST be directly supported by the lesson text above. Simple student-friendly wording is allowed for questions and explanations, but factual claims must remain supported by the lesson.",
    ])

    user_prompt = "\n".join(user_prompt_parts)
    return SYSTEM_PROMPT.strip(), user_prompt
