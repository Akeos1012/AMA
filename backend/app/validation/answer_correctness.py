import re
from typing import Any

from app.extraction.lesson_text import ExtractedLessonContent
from app.models.generation import (
    EssayQuestion,
    GeneratedQuestion,
    IdentificationQuestion,
    MultipleChoiceQuestion,
    TrueFalseQuestion,
    ValidationIssue,
    ValidationStatus,
)
from app.validation.source_grounding import extract_keywords, normalize_whitespace


class AnswerCorrectnessValidator:
    """
    Independent validator for answer correctness, option fidelity,
    rubric alignment, and explanation consistency.
    """

    def validate_question_correctness(
        self,
        question: GeneratedQuestion,
        question_index: int,
        lesson: ExtractedLessonContent,
    ) -> tuple[ValidationStatus, list[ValidationIssue]]:
        """
        Validates answer correctness and pedagogical integrity for a single question.
        Returns:
            status: "passed", "failed", or "needs_review".
            issues: Detailed validation issues.
        """
        issues: list[ValidationIssue] = []
        status: ValidationStatus = "passed"

        if isinstance(question, MultipleChoiceQuestion):
            # 1. Option count
            if len(question.options) != 4:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message=f"Multiple choice question must have exactly 4 options, got {len(question.options)}.",
                        question_index=question_index,
                    )
                )
                status = "failed"

            # 2. Distinct options check
            norm_options = [normalize_whitespace(opt).lower() for opt in question.options]
            if len(set(norm_options)) != len(norm_options):
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="Multiple choice options contain duplicates or case-insensitive duplicates.",
                        question_index=question_index,
                    )
                )
                status = "failed"

            # 3. Designated correct answer matches an option
            norm_answer = normalize_whitespace(question.correct_answer).lower()
            if norm_answer not in norm_options:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message=f"Designated correct answer '{question.correct_answer}' is not among the options.",
                        question_index=question_index,
                    )
                )
                status = "failed"

            # 4. Explanation consistency
            if not question.explanation or not question.explanation.strip():
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="Explanation is missing or empty.",
                        question_index=question_index,
                    )
                )
                status = "failed"
            else:
                exp_keywords = extract_keywords(question.explanation)
                ans_keywords = extract_keywords(question.correct_answer)
                prompt_keywords = extract_keywords(question.prompt)
                evidence_keywords = extract_keywords(question.evidence.quote)
                answer_is_explained = bool(ans_keywords & exp_keywords)
                explanation_adds_lesson_support = bool(
                    (exp_keywords & evidence_keywords) - ans_keywords
                )
                question_concept_is_explained = bool(
                    exp_keywords
                    & ((prompt_keywords & evidence_keywords) - ans_keywords)
                )
                if (
                    not answer_is_explained
                    or not explanation_adds_lesson_support
                    or not question_concept_is_explained
                ):
                    issues.append(
                        ValidationIssue(
                            severity="warning",
                            stage="correctness",
                            message=(
                                "Explanation does not meaningfully connect the designated "
                                "correct answer to supporting lesson content."
                            ),
                            question_index=question_index,
                        )
                    )
                    if status != "failed":
                        status = "needs_review"

        elif isinstance(question, TrueFalseQuestion):
            if not isinstance(question.correct_answer, bool):
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="True/False question correct_answer must be a boolean (true or false).",
                        question_index=question_index,
                    )
                )
                status = "failed"

            if not question.explanation or not question.explanation.strip():
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="True/False question must provide an explanation supporting its truth value.",
                        question_index=question_index,
                    )
                )
                status = "failed"
            else:
                exp_keywords = extract_keywords(question.explanation)
                prompt_keywords = extract_keywords(question.prompt)
                evidence_keywords = extract_keywords(question.evidence.quote)
                explanation_support = exp_keywords & evidence_keywords
                statement_support = exp_keywords & prompt_keywords & evidence_keywords

                if question.correct_answer is False:
                    correction_support = explanation_support - prompt_keywords
                    explanation_is_supported = (
                        bool(statement_support)
                        and len(explanation_support) >= 2
                        and bool(correction_support)
                    )
                    warning_message = (
                        "Explanation for false statement does not identify a correction "
                        "supported by the lesson evidence."
                    )
                else:
                    explanation_is_supported = (
                        bool(statement_support) and len(explanation_support) >= 2
                    )
                    warning_message = (
                        "Explanation does not meaningfully connect the true statement "
                        "to supporting lesson content."
                    )

                if not explanation_is_supported:
                    issues.append(
                        ValidationIssue(
                            severity="warning",
                            stage="correctness",
                            message=warning_message,
                            question_index=question_index,
                        )
                    )
                    if status != "failed":
                        status = "needs_review"

        elif isinstance(question, IdentificationQuestion):
            if not question.correct_answer or not question.correct_answer.strip():
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="Identification question has empty correct_answer.",
                        question_index=question_index,
                    )
                )
                status = "failed"

            # Check accepted alternatives
            norm_canonical = normalize_whitespace(question.correct_answer).lower()
            norm_alts = [normalize_whitespace(alt).lower() for alt in question.accepted_alternatives]

            if norm_canonical in norm_alts:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="Canonical answer is duplicated in accepted_alternatives.",
                        question_index=question_index,
                    )
                )
                status = "failed"

            if len(norm_alts) != len(set(norm_alts)):
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="Duplicate entries found in accepted_alternatives.",
                        question_index=question_index,
                    )
                )
                status = "failed"

        elif isinstance(question, EssayQuestion):
            if not question.rubric or len(question.rubric) < 1:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        stage="correctness",
                        message="Essay question must have at least one evaluation rubric criterion.",
                        question_index=question_index,
                    )
                )
                status = "failed"
            else:
                for r_idx, criterion in enumerate(question.rubric):
                    if not criterion or len(criterion.strip()) < 5:
                        issues.append(
                            ValidationIssue(
                                severity="error",
                                stage="correctness",
                                message=f"Rubric item {r_idx} is too vague or empty: '{criterion}'.",
                                question_index=question_index,
                            )
                        )
                        status = "failed"

                # Check rubric alignment with prompt
                prompt_keywords = extract_keywords(question.prompt)
                rubric_keywords = extract_keywords(" ".join(question.rubric))
                if prompt_keywords and not (prompt_keywords & rubric_keywords):
                    issues.append(
                        ValidationIssue(
                            severity="warning",
                            stage="correctness",
                            message="Rubric criteria have minimal topical alignment with the essay question prompt.",
                            question_index=question_index,
                        )
                    )
                    if status != "failed":
                        status = "needs_review"

        return status, issues
