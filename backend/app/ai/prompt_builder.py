from typing import Any

from app.extraction.lesson_text import ExtractedLessonContent
from app.models.generation import QuizGenerationRequest

SYSTEM_PROMPT = """You are an expert assessment generator for an accredited academic Learning Management System.
Your job is to generate high-quality quiz questions strictly grounded in the provided lesson text.

CRITICAL GROUNDING RULES:
1. Sole Factual Source: Base all questions, options, answer keys, rubrics, and explanations EXCLUSIVELY on the supplied lesson text.
2. No Extrapolation: Do NOT introduce outside facts, dates, theories, or assumptions not explicitly taught in the lesson.
3. Source Evidence Required: For EVERY question, you MUST provide an exact verbatim excerpt from the lesson text in the "evidence.quote" field, along with the source block index in "evidence.block_index".
4. Exact Types & Counts: You must generate the EXACT count requested for each question type. Never substitute one type for another.
5. Strict JSON Output: Output only a single valid JSON object following the specified schema without any markdown commentary outside the JSON.
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
        prefix = f"[Block {passage.block_index}]"
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
        '   - "correct_answer": string (EXACT match to one of the options)',
        '   - "explanation": string (justification citing the lesson)',
        '   - "evidence": {"quote": "verbatim sentence from lesson", "block_index": int}',
        "",
        '2. True/False ("type": "true_false"):',
        '   - "prompt": string (unambiguous declarative statement)',
        '   - "correct_answer": boolean (true or false)',
        '   - "explanation": string (why statement is true or false)',
        '   - "evidence": {"quote": "verbatim sentence from lesson", "block_index": int}',
        "",
        '3. Identification ("type": "identification"):',
        '   - "prompt": string (direct question expecting a specific term or concept)',
        '   - "correct_answer": string (primary expected answer)',
        '   - "accepted_alternatives": [string] (list of acceptable alternative spellings/terms; omit or empty if none)',
        '   - "explanation": string (definition or context from lesson)',
        '   - "evidence": {"quote": "verbatim sentence from lesson", "block_index": int}',
        "",
        '4. Essay ("type": "essay"):',
        '   - "prompt": string (open-ended conceptual question)',
        '   - "rubric": [string] (list of key concepts required for full credit; minimum 1 item)',
        '   - "sample_solution": string or null (example comprehensive answer)',
        '   - "explanation": string (pedagogical background from lesson)',
        '   - "evidence": {"quote": "verbatim sentence from lesson", "block_index": int}',
        "",
        "REMINDER: Do NOT invent facts. Every question, correct answer, and rubric element MUST be directly supported by the lesson text above.",
    ])

    user_prompt = "\n".join(user_prompt_parts)
    return SYSTEM_PROMPT.strip(), user_prompt
