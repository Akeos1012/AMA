import re
from typing import Any

from app.extraction.lesson_text import ExtractedLessonContent
from app.models.generation import (
    GeneratedQuestion,
    MultipleChoiceQuestion,
    IdentificationQuestion,
    TrueFalseQuestion,
    EssayQuestion,
    ValidationIssue,
    ValidationStatus,
)

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
    "to", "was", "were", "will", "with", "this", "these", "which",
}


def normalize_whitespace(text: str) -> str:
    """Collapses consecutive whitespace, tabs, and newlines into a single space and strips ends."""
    return re.sub(r"\s+", " ", text or "").strip()


def extract_keywords(text: str) -> set[str]:
    """Extracts alphanumeric words of length >= 3 excluding common English stopwords."""
    tokens = re.findall(r"\b[a-zA-Z0-9_-]+\b", text.lower())
    return {t for t in tokens if len(t) >= 3 and t not in STOPWORDS}


class SourceGroundingValidator:
    """
    Independent validator for source-evidence grounding.
    Verifies that cited quotes exist verbatim in the source lesson blocks,
    checks block index fidelity, and checks substantive support for answers.
    """

    def validate_question_grounding(
        self,
        question: GeneratedQuestion,
        question_index: int,
        lesson: ExtractedLessonContent,
    ) -> tuple[bool, bool, ValidationStatus, list[ValidationIssue]]:
        """
        Validates source grounding for a single question.
        Returns:
            quote_valid (bool): Whether the quote was found in the lesson.
            block_ref_valid (bool): Whether the block index correctly matches where quote lives.
            evidence_status (ValidationStatus): "passed", "failed", or "needs_review".
            issues (list[ValidationIssue]): Detailed validation issues.
        """
        issues: list[ValidationIssue] = []
        evidence = getattr(question, "evidence", None)

        if not evidence or not getattr(evidence, "quote", None) or not evidence.quote.strip():
            issues.append(
                ValidationIssue(
                    severity="error",
                    stage="grounding",
                    message="Evidence quote is missing or empty.",
                    question_index=question_index,
                )
            )
            return False, False, "failed", issues

        raw_quote = evidence.quote.strip()
        norm_quote = normalize_whitespace(raw_quote)
        block_index = evidence.block_index

        quote_valid = False
        block_ref_valid = False
        evidence_status: ValidationStatus = "passed"

        # Check block index
        if block_index is None:
            issues.append(
                ValidationIssue(
                    severity="warning",
                    stage="grounding",
                    message="Evidence does not specify a block_index.",
                    question_index=question_index,
                )
            )
        elif block_index < 0 or block_index >= len(lesson.passages):
            issues.append(
                ValidationIssue(
                    severity="error",
                    stage="grounding",
                    message=f"Cited block_index {block_index} is out of range for lesson with {len(lesson.passages)} blocks.",
                    question_index=question_index,
                )
            )

        # 1. Programmatic quote verification in cited block
        passage = lesson.get_passage_by_index(block_index) if block_index is not None else None
        if passage:
            norm_passage = normalize_whitespace(passage.text)
            if norm_quote.lower() in norm_passage.lower():
                quote_valid = True
                block_ref_valid = True
            else:
                # Quote not in cited block; check if it exists in any OTHER block
                found_in_other = False
                for other_p in lesson.passages:
                    if other_p.block_index != block_index:
                        if norm_quote.lower() in normalize_whitespace(other_p.text).lower():
                            quote_valid = True
                            block_ref_valid = False
                            found_in_other = True
                            issues.append(
                                ValidationIssue(
                                    severity="error",
                                    stage="grounding",
                                    message=(
                                        f"Evidence quote was not found in cited block {block_index}, "
                                        f"but exists in block {other_p.block_index} (block reference mismatch)."
                                    ),
                                    question_index=question_index,
                                )
                            )
                            break
                if not found_in_other:
                    quote_valid = False
                    block_ref_valid = False
                    issues.append(
                        ValidationIssue(
                            severity="error",
                            stage="grounding",
                            message="Evidence quote does not appear in the lesson text (fabricated or modified quote).",
                            question_index=question_index,
                        )
                    )
        else:
            # Block was not found/invalid, search globally across all passages
            found_globally = False
            for p in lesson.passages:
                if norm_quote.lower() in normalize_whitespace(p.text).lower():
                    found_globally = True
                    quote_valid = True
                    issues.append(
                        ValidationIssue(
                            severity="warning",
                            stage="grounding",
                            message=f"Quote found in block {p.block_index}, but cited block was invalid or missing.",
                            question_index=question_index,
                        )
                    )
                    break
            if not found_globally:
                quote_valid = False
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="grounding",
                        message="Evidence quote does not appear in the lesson text.",
                        question_index=question_index,
                    )
                )

        if not quote_valid or not block_ref_valid:
            evidence_status = "failed"
            return quote_valid, block_ref_valid, evidence_status, issues

        # 2. Substantive answer-support check (checking evidence actually supports the answer)
        quote_keywords = extract_keywords(raw_quote)

        if isinstance(question, MultipleChoiceQuestion):
            answer_keywords = extract_keywords(question.correct_answer)
            # Check if answer keywords intersect with quote keywords
            if answer_keywords and not (answer_keywords & quote_keywords):
                # Also check if explanation or prompt provides bridge
                prompt_keywords = extract_keywords(question.prompt)
                if not (prompt_keywords & quote_keywords):
                    issues.append(
                        ValidationIssue(
                            severity="error",
                            stage="grounding",
                            message=(
                                f"Evidence quote does not support the correct answer '{question.correct_answer}'. "
                                "Neither the answer terms nor question prompt intersect with the cited quote."
                            ),
                            question_index=question_index,
                        )
                    )
                    evidence_status = "failed"
                else:
                    issues.append(
                        ValidationIssue(
                            severity="warning",
                            stage="grounding",
                            message="Evidence quote relates to the prompt topic, but does not explicitly mention the correct answer term.",
                            question_index=question_index,
                        )
                    )
                    evidence_status = "needs_review"

        elif isinstance(question, IdentificationQuestion):
            answer_keywords = extract_keywords(question.correct_answer)
            norm_ans = normalize_whitespace(question.correct_answer).lower()
            # In identification, the answer term or its keywords should appear in the evidence
            if norm_ans not in norm_quote.lower() and not (answer_keywords & quote_keywords):
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="grounding",
                        message=f"Identification answer '{question.correct_answer}' is not supported by the cited quote.",
                        question_index=question_index,
                    )
                )
                evidence_status = "failed"

        elif isinstance(question, TrueFalseQuestion):
            prompt_keywords = extract_keywords(question.prompt)
            shared = prompt_keywords & quote_keywords
            if len(shared) < 1:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="grounding",
                        message="Evidence quote shares no substantive keywords with the true/false statement.",
                        question_index=question_index,
                    )
                )
                evidence_status = "failed"

        elif isinstance(question, EssayQuestion):
            rubric_text = " ".join(question.rubric)
            rubric_keywords = extract_keywords(rubric_text)
            prompt_keywords = extract_keywords(question.prompt)
            if not ((rubric_keywords | prompt_keywords) & quote_keywords):
                issues.append(
                    ValidationIssue(
                        severity="warning",
                        stage="grounding",
                        message="Essay question rubric and prompt have weak lexical overlap with the cited quote.",
                        question_index=question_index,
                    )
                )
                evidence_status = "needs_review"

        return quote_valid, block_ref_valid, evidence_status, issues
