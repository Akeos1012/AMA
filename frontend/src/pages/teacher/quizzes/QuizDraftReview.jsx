import React, { useRef, useState } from "react";
import { auth } from "../../../services/firebase.js";
import { authenticatedFetch } from "../../../services/api.js";

function updateQuestion(setDraft, questionIndex, field, value) {
  setDraft((current) => ({
    ...current,
    questions: current.questions.map((question, index) =>
      index === questionIndex ? { ...question, [field]: value } : question,
    ),
  }));
}

function formatQuizDraftUpdateRequest(draft) {
  const payload = {
    title: typeof draft.title === "string" ? draft.title.trim() : draft.title,
    questions: (draft.questions || []).map((question) => {
      const formatted = { ...question };
      if (formatted.type === "essay" && typeof formatted.sample_solution === "string") {
        formatted.sample_solution = formatted.sample_solution.trim() || null;
      }
      return formatted;
    }),
  };

  if (draft.description !== undefined) {
    payload.description =
      typeof draft.description === "string"
        ? draft.description.trim() || null
        : draft.description;
  }
  if (draft.opening_at !== undefined) {
    payload.opening_at = draft.opening_at;
  }
  if (draft.closing_at !== undefined) {
    payload.closing_at = draft.closing_at;
  }

  return payload;
}

function isValidQuizDraft(data) {
  return Boolean(
    data &&
      typeof data.id === "string" &&
      typeof data.title === "string" &&
      Array.isArray(data.questions) &&
      data.questions.length > 0 &&
      typeof data.status === "string",
  );
}

function ValidationIssues({ issues }) {
  if (!issues?.length) return null;
  return (
    <ul className="quiz-issues">
      {issues.map((issue, index) => (
        <li className={`quiz-issue quiz-issue-${issue.severity}`} key={`${issue.stage}-${index}`}>
          <strong>{issue.severity === "warning" ? "Warning" : "Issue"}:</strong>{" "}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ evidence, lesson }) {
  if (!evidence) return null;
  const sourceReference =
    Number.isInteger(evidence.block_index) && evidence.block_index >= 0
      ? `content block ${evidence.block_index + 1}`
      : "lesson content";

  return (
    <div className="quiz-evidence">
      <h5>Lesson evidence</h5>
      <blockquote>{evidence.quote}</blockquote>
      <p>
        Source: <strong>{lesson?.title || "Selected lesson"}</strong>, {sourceReference}.
      </p>
      {evidence.context && <p>{evidence.context}</p>}
    </div>
  );
}

function QuestionReview({ question, index, lesson, setDraft, onEdit, validation }) {
  const number = index + 1;
  const edit = (field, value) => {
    if (onEdit) {
      onEdit();
    }
    updateQuestion(setDraft, index, field, value);
  };

  return (
    <article className="quiz-question-card">
      <header className="quiz-question-heading">
        <div>
          <span className="quiz-type-badge">{question.type.replaceAll("_", " ")}</span>
          <h4>Question {number}</h4>
        </div>
      </header>
      {validation && (
        <p className="quiz-question-validation">
          Question validation: <strong>{validation.status}</strong>
          {" · "}Schema: <strong>{validation.schema_valid ? "passed" : "not passed"}</strong>
          {" · "}Evidence: <strong>{validation.evidence_supported}</strong>
          {" · "}Answer check: <strong>{validation.answer_correct}</strong>
        </p>
      )}

      <label className="quiz-edit-field">
        Question text
        <textarea
          aria-label={`Question ${number} text`}
          rows="3"
          value={question.prompt}
          onChange={(event) => edit("prompt", event.target.value)}
        />
      </label>

      {question.type === "multiple_choice" && (
        <div className="quiz-question-fields">
          <fieldset className="quiz-options">
            <legend>Answer options</legend>
            {question.options.map((option, optionIndex) => (
              <label className="quiz-edit-field" key={optionIndex}>
                Option {optionIndex + 1}
                <input
                  aria-label={`Question ${number} option ${optionIndex + 1}`}
                  value={option}
                  onChange={(event) =>
                    edit(
                      "options",
                      question.options.map((current, currentIndex) =>
                        currentIndex === optionIndex ? event.target.value : current,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </fieldset>
          <label className="quiz-edit-field">
            Correct answer
            <input
              aria-label={`Question ${number} correct answer`}
              value={question.correct_answer}
              onChange={(event) => edit("correct_answer", event.target.value)}
            />
          </label>
        </div>
      )}

      {question.type === "true_false" && (
        <label className="quiz-edit-field">
          Correct answer
          <select
            aria-label={`Question ${number} correct answer`}
            value={String(question.correct_answer)}
            onChange={(event) => edit("correct_answer", event.target.value === "true")}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      )}

      {question.type === "identification" && (
        <>
          <label className="quiz-edit-field">
            Correct answer
            <input
              aria-label={`Question ${number} correct answer`}
              value={question.correct_answer}
              onChange={(event) => edit("correct_answer", event.target.value)}
            />
          </label>
          <label className="quiz-edit-field">
            Accepted alternatives (comma-separated)
            <input
              aria-label={`Question ${number} accepted alternatives`}
              value={(question.accepted_alternatives ?? []).join(", ")}
              onChange={(event) =>
                edit(
                  "accepted_alternatives",
                  event.target.value
                    .split(",")
                    .map((alternative) => alternative.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
        </>
      )}

      {question.type === "essay" && (
        <>
          <fieldset className="quiz-rubric">
            <legend>Rubric</legend>
            {(question.rubric ?? []).map((item, rubricIndex) => (
              <label className="quiz-edit-field" key={rubricIndex}>
                Rubric item {rubricIndex + 1}
                <textarea
                  aria-label={`Question ${number} rubric item ${rubricIndex + 1}`}
                  rows="2"
                  value={item}
                  onChange={(event) =>
                    edit(
                      "rubric",
                      question.rubric.map((current, currentIndex) =>
                        currentIndex === rubricIndex ? event.target.value : current,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              className="secondary-button"
              type="button"
              onClick={() => edit("rubric", [...(question.rubric ?? []), ""])}
            >
              Add rubric item
            </button>
          </fieldset>
          <label className="quiz-edit-field">
            Sample solution
            <textarea
              aria-label={`Question ${number} sample solution`}
              rows="3"
              value={question.sample_solution ?? ""}
              onChange={(event) => edit("sample_solution", event.target.value)}
            />
          </label>
        </>
      )}

      {question.explanation !== undefined && (
        <label className="quiz-edit-field">
          Teacher explanation
          <textarea
            aria-label={`Question ${number} explanation`}
            rows="2"
            value={question.explanation}
            onChange={(event) => edit("explanation", event.target.value)}
          />
        </label>
      )}

      <Evidence evidence={question.evidence} lesson={lesson} />
    </article>
  );
}

export default function DraftReview({ draft, lesson, setDraft, user }) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState("");
  const saveLockRef = useRef(false);

  const isPublished = draft?.status === "published";
  const activeUser = user || auth?.currentUser;

  const handleSaveDraft = async () => {
    if (saveLockRef.current || isSaving || isPublished) {
      return;
    }
    if (!draft?.id) {
      setSaveError("Quiz draft ID is missing.");
      return;
    }
    if (!activeUser) {
      setSaveError("Your teacher access could not be verified. Sign in with an active teacher account.");
      return;
    }
    if (!draft.title || !draft.title.trim()) {
      setSaveError("Quiz title cannot be empty.");
      return;
    }
    if (!Array.isArray(draft.questions) || draft.questions.length === 0) {
      setSaveError("Quiz must contain at least one question.");
      return;
    }

    saveLockRef.current = true;
    setIsSaving(true);
    setSaveError("");
    setSaveSuccess("");

    try {
      const payload = formatQuizDraftUpdateRequest(draft);
      const response = await authenticatedFetch(
        activeUser,
        `/api/quizzes/${encodeURIComponent(draft.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        let errorMessage = "Unable to save this quiz draft right now. Please try again.";
        try {
          const errorData = await response.json();
          if (response.status === 401 || response.status === 403) {
            errorMessage =
              "Your teacher access could not be verified. Sign in with an active teacher account.";
          } else if (response.status === 404) {
            errorMessage = "Quiz draft not found.";
          } else if (response.status === 409) {
            errorMessage = "Only quiz drafts can be modified.";
          } else if (response.status === 422) {
            if (typeof errorData?.detail === "string") {
              errorMessage = errorData.detail;
            } else {
              errorMessage =
                "Draft edits failed validation. Please review your questions and lesson content.";
            }
          }
        } catch {
          // Use default error message
        }
        setSaveError(errorMessage);
        return;
      }

      const savedDraft = await response.json();
      if (!isValidQuizDraft(savedDraft)) {
        setSaveError("The server did not return a valid saved draft. Please try again.");
        return;
      }

      setDraft(savedDraft);
      setSaveSuccess("Draft changes saved.");
    } catch (error) {
      console.error("Save quiz draft failed:", error);
      setSaveError("The request could not be completed. Check your connection and try again.");
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const report = draft.validation_report;
  const generalIssues = report?.general_issues ?? [];
  const questionIssues = (report?.question_reports ?? []).flatMap((questionReport) =>
    (questionReport.issues ?? []).map((issue) => ({
      ...issue,
      question_index: questionReport.question_index,
    })),
  );

  return (
    <section className="quiz-draft-review" aria-labelledby="quiz-draft-title">
      <header className="quiz-draft-header">
        <div>
          <p className="quiz-eyebrow">Saved quiz draft</p>
          <h3 id="quiz-draft-title">{draft.title}</h3>
          <p>
            Status:{" "}
            <strong>
              {isPublished ? "Published" : "Draft — teacher review required"}
            </strong>
          </p>
        </div>
        <div className="quiz-draft-header-actions">
          <span className="quiz-draft-status">{isPublished ? "Published" : "Draft"}</span>
          <button
            type="button"
            className="primary-button quiz-save-button"
            onClick={handleSaveDraft}
            disabled={isSaving || isPublished}
          >
            {isSaving ? "Saving draft..." : "Save Draft"}
          </button>
        </div>
      </header>

      {saveSuccess && (
        <p className="quiz-form-message success" role="status">
          {saveSuccess}
        </p>
      )}
      {saveError && (
        <p className="quiz-form-message error" role="alert">
          {saveError}
        </p>
      )}
      {isSaving && (
        <p className="quiz-loading-message" role="status">
          Saving quiz draft...
        </p>
      )}

      <div className="quiz-review-notice" role="note">
        Review every question before using it with students. This draft is not approved or published.
      </div>

      <div className="quiz-draft-metadata-fields">
        <label className="quiz-edit-field">
          Quiz title
          <input
            aria-label="Quiz title"
            type="text"
            value={draft.title ?? ""}
            onChange={(event) => {
              setSaveSuccess("");
              setDraft((current) => ({ ...current, title: event.target.value }));
            }}
          />
        </label>
        {draft.description !== undefined && (
          <label className="quiz-edit-field">
            Description
            <textarea
              aria-label="Quiz description"
              rows="2"
              value={draft.description ?? ""}
              onChange={(event) => {
                setSaveSuccess("");
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }));
              }}
            />
          </label>
        )}
      </div>

      <section className="quiz-validation" aria-label="Validation results">
        <h4>Validation results</h4>
        <p>
          Overall: <strong>{report?.status || "not reported"}</strong>
          {" · "}Valid: <strong>{report?.is_valid ? "Yes" : "No"}</strong>
          {" · "}Grounding: <strong>{report?.grounding_passed ? "Passed" : "Not passed"}</strong>
          {" · "}Answer checks:{" "}
          <strong>{report?.correctness_passed ? "Passed" : "Not passed"}</strong>
        </p>
        <ValidationIssues issues={generalIssues} />
        {questionIssues.map((issue, index) => (
          <p className={`quiz-issue quiz-issue-${issue.severity}`} key={`question-issue-${index}`}>
            Question {issue.question_index + 1}: {issue.message}
          </p>
        ))}
        {generalIssues.length === 0 && questionIssues.length === 0 && (
          <p>No warnings or issues were reported.</p>
        )}
      </section>

      <div className="quiz-question-list">
        {draft.questions.map((question, index) => (
          <QuestionReview
            index={index}
            key={`${index}-${question.type}`}
            lesson={lesson}
            question={question}
            setDraft={setDraft}
            onEdit={() => setSaveSuccess("")}
            validation={report?.question_reports?.find(
              (questionReport) => questionReport.question_index === index,
            )}
          />
        ))}
      </div>
    </section>
  );
}

