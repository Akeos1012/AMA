import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import TeacherNavigation from "../../components/navigation/TeacherNavigation.jsx";
import DraftReview from "./quizzes/QuizDraftReview.jsx";
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
      if (
        !["draft", "published"].includes(generatedDraft?.status) ||
        !Array.isArray(generatedDraft.questions)
      ) {
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
        <DraftReview
          draft={draft}
          lesson={selectedLesson}
          setDraft={setDraft}
          user={user}
        />
      )}
    </PortalLayout>
  );
}
