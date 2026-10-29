import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import TeacherNavigation from "../../components/navigation/TeacherNavigation.jsx";
import "./Quizzes.css";

const QUESTION_TYPES = [
  ["multiple_choice", "Multiple-choice"],
  ["true_false", "True/false"],
  ["identification", "Identification"],
  ["essay", "Essay"],
];

const EMPTY_COUNTS = Object.fromEntries(QUESTION_TYPES.map(([type]) => [type, "0"]));

function validateCounts(counts) {
  const errors = {};
  const parsedCounts = {};

  for (const [type, label] of QUESTION_TYPES) {
    const rawCount = counts[type];
    const count = Number(rawCount);
    if (rawCount.trim() === "" || !Number.isInteger(count) || count < 0 || count > 50) {
      errors[type] = `${label} count must be a whole number from 0 to 50.`;
    } else {
      parsedCounts[type] = count;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, parsedCounts: null };
  }

  const total = Object.values(parsedCounts).reduce((sum, count) => sum + count, 0);
  if (total < 1) {
    errors.multiple_choice = "Request at least one question across all types.";
  } else if (total > 50) {
    errors.multiple_choice = "The total request cannot exceed 50 questions.";
  }

  return {
    errors,
    parsedCounts: Object.keys(errors).length === 0 ? parsedCounts : null,
  };
}

function fieldErrorsFromResponse(payload) {
  if (!Array.isArray(payload?.detail)) return {};

  const fields = {};
  for (const issue of payload.detail) {
    const location = Array.isArray(issue?.loc) ? issue.loc : [];
    const type = location.find((part) =>
      QUESTION_TYPES.some(([questionType]) => questionType === part),
    );
    if (type) {
      fields[type] = "The server rejected this count. Enter a whole number from 0 to 50.";
    }
  }
  return fields;
}

function responseMessage(status) {
  if (status === 401 || status === 403) {
    return "Your teacher access could not be verified. Sign in with an active teacher account.";
  }
  if (status === 422) {
    return "Generation failed validation. Check the question counts and selected lesson content.";
  }
  if (status === 502 || status === 503) {
    return "The AI generation service is unavailable right now. Please try again later.";
  }
  if (status >= 500) {
    return "The draft could not be generated or saved. Please try again later.";
  }
  return "The request could not be completed. Please check your selection and try again.";
}

function readValidationPayload(response) {
  return response.json().catch(() => null);
}

function updateQuestion(setDraft, questionIndex, field, value) {
  setDraft((current) => ({
    ...current,
    questions: current.questions.map((question, index) =>
      index === questionIndex ? { ...question, [field]: value } : question,
    ),
  }));
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

function QuestionReview({ question, index, lesson, setDraft, validation }) {
  const number = index + 1;
  const edit = (field, value) => updateQuestion(setDraft, index, field, value);

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

function DraftReview({ draft, lesson, setDraft }) {
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
            Status: <strong>Draft — teacher review required</strong>
          </p>
        </div>
        <span className="quiz-draft-status">Draft</span>
      </header>

      <div className="quiz-review-notice" role="note">
        Review every question before using it with students. This draft is not approved or
        published. Changes below are local to this page and are not saved; the backend
        currently has no authorized draft-edit endpoint.
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
            validation={report?.question_reports?.find(
              (questionReport) => questionReport.question_index === index,
            )}
          />
        ))}
      </div>
    </section>
  );
}

export default function TeacherQuizzes() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [instructions, setInstructions] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [draft, setDraft] = useState(null);
  const submissionLock = useRef(false);

  const loadLessons = useCallback(async (activeUser) => {
    setLessonsLoading(true);
    setLessonsError("");
    try {
      const response = await authenticatedFetch(activeUser, "/api/lessons");
      if (!response.ok) {
        setLessonsError(
          response.status === 401 || response.status === 403
            ? "Your teacher access could not be verified. Sign in with an active teacher account."
            : "Unable to load your lessons right now. Please try again.",
        );
        setLessons([]);
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The lesson response was not a list.");
      }
      setLessons(data.filter((lesson) => lesson && typeof lesson.id === "string"));
    } catch (error) {
      console.error("Could not load teacher lessons:", error);
      setLessonsError("Unable to load your lessons right now. Please try again.");
      setLessons([]);
    } finally {
      setLessonsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        if (active) setAuthState("unauthenticated");
        return;
      }

      try {
        const tokenResult = await getIdTokenResult(currentUser, true);
        if (!active) return;
        if (tokenResult.claims.role !== "teacher") {
          setAuthState("forbidden");
          return;
        }
        setUser(currentUser);
        setAuthState("authorized");
        await loadLessons(currentUser);
      } catch (error) {
        console.error("Teacher authentication check failed:", error);
        if (active) setAuthState("error");
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadLessons]);

  const handleGenerate = async (event) => {
    event.preventDefault();
    if (submissionLock.current || !user) return;

    const { errors, parsedCounts } = validateCounts(counts);
    setFieldErrors(errors);
    setFormError("");
    if (!lessonId) {
      setFormError("Select a lesson before generating a quiz.");
      return;
    }
    if (!parsedCounts) return;

    submissionLock.current = true;
    setIsGenerating(true);
    setDraft(null);
    try {
      const response = await authenticatedFetch(
        user,
        `/api/lessons/${encodeURIComponent(lessonId)}/generate-quiz`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_counts: parsedCounts,
            instructions: instructions.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        const payload =
          response.status === 422 ? await readValidationPayload(response) : null;
        const apiFieldErrors = fieldErrorsFromResponse(payload);
        if (Object.keys(apiFieldErrors).length > 0) {
          setFieldErrors(apiFieldErrors);
        }
        setFormError(responseMessage(response.status));
        return;
      }

      const generatedDraft = await response.json();
      if (generatedDraft?.status !== "draft" || !Array.isArray(generatedDraft.questions)) {
        setFormError("The server did not return a valid saved draft. Please try again.");
        return;
      }

      setDraft(generatedDraft);
    } catch (error) {
      console.error("Quiz generation request failed:", error);
      setFormError("The request could not be completed. Check your connection and try again.");
    } finally {
      submissionLock.current = false;
      setIsGenerating(false);
    }
  };

  if (authState !== "authorized") {
    const message = {
      checking: "Verifying teacher access...",
      unauthenticated: "Sign in to access teacher quiz generation.",
      forbidden: "Teacher access is required to generate and review quizzes.",
      error: "Your teacher account could not be verified. Please sign in again.",
    }[authState];

    return (
      <main className="teacher-quiz-access" aria-live="polite">
        <p role={authState === "error" ? "alert" : "status"}>{message}</p>
        {(authState === "unauthenticated" || authState === "error") && (
          <a href="/login">Go to sign in</a>
        )}
      </main>
    );
  }

  const selectedLesson = lessons.find((lesson) => lesson.id === lessonId) ?? null;

  return (
    <PortalLayout
      role="teacher"
      pageClassName="page-teacher-quizzes"
      title="Quizzes"
      description="Generate and review lesson-based quiz drafts."
      navigation={<TeacherNavigation activePath="/teacher/quizzes" />}
    >
      <section className="quiz-generator-panel" aria-labelledby="quiz-generator-title">
        <div className="quiz-panel-heading">
          <h3 id="quiz-generator-title">Generate a quiz draft</h3>
          <p>Questions and answers must be grounded in the selected lesson.</p>
        </div>

        {lessonsError && (
          <div className="quiz-form-message error" role="alert">
            {lessonsError}
            <button type="button" className="secondary-button" onClick={() => loadLessons(user)}>
              Retry
            </button>
          </div>
        )}

        <form className="quiz-generator-form" onSubmit={handleGenerate} noValidate>
          <label className="quiz-edit-field">
            Lesson
            <select
              aria-label="Lesson"
              value={lessonId}
              disabled={lessonsLoading || lessons.length === 0}
              onChange={(event) => setLessonId(event.target.value)}
            >
              <option value="">
                {lessonsLoading
                  ? "Loading lessons..."
                  : lessons.length === 0
                    ? "No accessible lessons available"
                    : "Select a lesson"}
              </option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.title}
                  {lesson.topic ? ` — ${lesson.topic}` : ""}
                  {lesson.status ? ` (${lesson.status})` : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="quiz-count-fields">
            <legend>Number of questions by type</legend>
            {QUESTION_TYPES.map(([type, label]) => (
              <label className="quiz-edit-field" key={type}>
                {label}
                <input
                  aria-label={`${label} count`}
                  aria-invalid={Boolean(fieldErrors[type])}
                  aria-describedby={fieldErrors[type] ? `${type}-error` : undefined}
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={counts[type]}
                  onChange={(event) => {
                    setCounts((current) => ({ ...current, [type]: event.target.value }));
                    setFieldErrors((current) => ({ ...current, [type]: undefined }));
                  }}
                />
                {fieldErrors[type] && (
                  <span className="quiz-field-error" id={`${type}-error`} role="alert">
                    {fieldErrors[type]}
                  </span>
                )}
              </label>
            ))}
          </fieldset>

          <label className="quiz-edit-field">
            Optional focus instructions
            <textarea
              aria-label="Optional focus instructions"
              rows="3"
              maxLength="2000"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="For example: emphasize the key terms introduced in this lesson."
            />
            <span className="quiz-help-text">
              Instructions guide emphasis only and cannot override the lesson as the factual
              source.
            </span>
          </label>

          {formError && (
            <p className="quiz-form-message error" role="alert">
              {formError}
            </p>
          )}

          <button
            className="primary-button"
            type="submit"
            disabled={isGenerating || lessonsLoading || lessons.length === 0}
          >
            {isGenerating ? "Generating draft..." : "Generate quiz draft"}
          </button>
        </form>

        {isGenerating && (
          <p className="quiz-loading-message" role="status">
            Generating and validating questions. This may take a moment...
          </p>
        )}
      </section>

      {draft && (
        <DraftReview draft={draft} lesson={selectedLesson} setDraft={setDraft} />
      )}
    </PortalLayout>
  );
}
