from typing import Any

from app.extraction.lesson_text import ExtractedLessonContent
from app.models.generation import (
    GeneratedQuiz,
    QuestionValidationReport,
    QuizValidationReport,
    ValidationIssue,
    ValidationStatus,
)
from app.validation.answer_correctness import AnswerCorrectnessValidator
from app.validation.source_grounding import SourceGroundingValidator


class QuizValidator:
    """
    Coordinates independent source grounding and answer correctness validation for generated quizzes.
    Produces an actionable QuizValidationReport.
    """

    def __init__(
        self,
        grounding_validator: SourceGroundingValidator | None = None,
        correctness_validator: AnswerCorrectnessValidator | None = None,
    ):
        self.grounding_validator = grounding_validator or SourceGroundingValidator()
        self.correctness_validator = correctness_validator or AnswerCorrectnessValidator()

    def validate_quiz(
        self,
        quiz: GeneratedQuiz,
        lesson: ExtractedLessonContent,
    ) -> QuizValidationReport:
        """
        Validates all questions in the quiz against the source lesson.
        A question is only marked 'passed' if both grounding and correctness checks pass cleanly.
        """
        question_reports: list[QuestionValidationReport] = []
        general_issues: list[ValidationIssue] = []

        if not quiz.questions:
            general_issues.append(
                ValidationIssue(
                    severity="error",
                    stage="schema",
                    message="Quiz contains no questions to validate.",
                )
            )
            return QuizValidationReport(
                status="failed",
                is_valid=False,
                grounding_passed=False,
                correctness_passed=False,
                question_reports=[],
                general_issues=general_issues,
            )

        all_grounding_passed = True
        all_correctness_passed = True

        for idx, question in enumerate(quiz.questions):
            # 1. Source grounding validation
            (
                quote_valid,
                block_ref_valid,
                evidence_status,
                grounding_issues,
            ) = self.grounding_validator.validate_question_grounding(question, idx, lesson)

            # 2. Answer correctness validation
            (
                correctness_status,
                correctness_issues,
            ) = self.correctness_validator.validate_question_correctness(question, idx, lesson)

            all_issues = grounding_issues + correctness_issues

            # Determine individual question statuses
            has_error = any(issue.severity == "error" for issue in all_issues)
            has_warning = any(issue.severity == "warning" for issue in all_issues)

            if has_error or evidence_status == "failed" or correctness_status == "failed":
                q_status: ValidationStatus = "failed"
            elif has_warning or evidence_status == "needs_review" or correctness_status == "needs_review":
                q_status = "needs_review"
            else:
                q_status = "passed"

            grounding_passed = (
                quote_valid and block_ref_valid and evidence_status != "failed"
            )
            correctness_passed = correctness_status != "failed"

            if not grounding_passed:
                all_grounding_passed = False
            if not correctness_passed:
                all_correctness_passed = False

            question_reports.append(
                QuestionValidationReport(
                    question_index=idx,
                    status=q_status,
                    schema_valid=True,
                    quote_valid=quote_valid,
                    block_reference_valid=block_ref_valid,
                    evidence_supported=evidence_status,
                    answer_correct=correctness_status,
                    grounding_passed=grounding_passed,
                    correctness_passed=correctness_passed,
                    issues=all_issues,
                )
            )

        # Overall quiz evaluation
        any_failed = any(qr.status == "failed" for qr in question_reports)
        any_needs_review = any(qr.status == "needs_review" for qr in question_reports)

        if any_failed:
            overall_status: ValidationStatus = "failed"
            is_valid = False
        elif any_needs_review:
            overall_status = "needs_review"
            # Needs review means cannot automatically consider valid
            is_valid = False
        else:
            overall_status = "passed"
            is_valid = True

        return QuizValidationReport(
            status=overall_status,
            is_valid=is_valid,
            grounding_passed=all_grounding_passed,
            correctness_passed=all_correctness_passed,
            question_reports=question_reports,
            general_issues=general_issues,
        )
