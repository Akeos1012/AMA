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

function formatDraftDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatPhilippineDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila",
      }).format(date);
}

function manilaDateTimeToIso(value) {
  if (!value) return "";
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export default function TeacherQuizzes() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState("");
  const [quizDrafts, setQuizDrafts] = useState([]);
  const [quizDraftsLoading, setQuizDraftsLoading] = useState(false);
  const [quizDraftsError, setQuizDraftsError] = useState("");
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [teacherClassesLoading, setTeacherClassesLoading] = useState(false);
  const [teacherClassesError, setTeacherClassesError] = useState("");
  const [publishedQuizzes, setPublishedQuizzes] = useState([]);
  const [publishedQuizzesLoading, setPublishedQuizzesLoading] = useState(false);
  const [publishedQuizzesError, setPublishedQuizzesError] = useState("");
  const [publishDraft, setPublishDraft] = useState(null);
  const [publishForm, setPublishForm] = useState({
    title: "",
    description: "",
    gradeLevel: "",
    section: "",
    openingLocal: "",
    closingLocal: "",
  });
  const [publishErrors, setPublishErrors] = useState({});
  const [publishError, setPublishError] = useState("");
  const [publishSuccess, setPublishSuccess] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
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

  const loadQuizDrafts = useCallback(async (activeUser) => {
    setQuizDraftsLoading(true);
    setQuizDraftsError("");
    try {
      const response = await authenticatedFetch(activeUser, "/api/quizzes");
      if (!response.ok) {
        setQuizDraftsError(
          response.status === 401 || response.status === 403
            ? "Your teacher access could not be verified. Sign in with an active teacher account."
            : "Unable to load your quiz drafts right now. Please try again.",
        );
        setQuizDrafts([]);
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The quiz draft response was not a list.");
      }
      setQuizDrafts(
        data.filter(
          (savedDraft) =>
            savedDraft &&
            typeof savedDraft.id === "string" &&
            typeof savedDraft.title === "string" &&
            savedDraft.status === "draft" &&
            Array.isArray(savedDraft.questions),
        ),
      );
    } catch (error) {
      console.error("Could not load teacher quiz drafts:", error);
      setQuizDraftsError("Unable to load your quiz drafts right now. Please try again.");
      setQuizDrafts([]);
    } finally {
      setQuizDraftsLoading(false);
    }
  }, []);

  const loadTeacherClasses = useCallback(async (activeUser) => {
    setTeacherClassesLoading(true);
    setTeacherClassesError("");
    try {
      const response = await authenticatedFetch(
        activeUser,
        "/api/teacher/classes?include_students=false",
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}).`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The teacher class response was not a list.");
      }
      setTeacherClasses(data.filter((item) => item && typeof item.id === "string"));
    } catch (error) {
      console.error("Could not load teacher classes:", error);
      setTeacherClassesError("Unable to load your authorized classes right now.");
      setTeacherClasses([]);
    } finally {
      setTeacherClassesLoading(false);
    }
  }, []);

  const loadPublishedQuizzes = useCallback(async (activeUser) => {
    setPublishedQuizzesLoading(true);
    setPublishedQuizzesError("");
    try {
      const response = await authenticatedFetch(activeUser, "/api/quizzes/published");
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}).`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The published quiz response was not a list.");
      }
      setPublishedQuizzes(data.filter((item) => item?.status === "published"));
    } catch (error) {
      console.error("Could not load published teacher quizzes:", error);
      setPublishedQuizzesError("Unable to load your published quizzes right now.");
      setPublishedQuizzes([]);
    } finally {
      setPublishedQuizzesLoading(false);
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
        await Promise.all([
          loadLessons(currentUser),
          loadQuizDrafts(currentUser),
          loadTeacherClasses(currentUser),
          loadPublishedQuizzes(currentUser),
        ]);
      } catch (error) {
        console.error("Teacher authentication check failed:", error);
        if (active) setAuthState("error");
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadLessons, loadQuizDrafts, loadPublishedQuizzes, loadTeacherClasses]);

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
      await loadQuizDrafts(user);
    } catch (error) {
      console.error("Quiz generation request failed:", error);
      setFormError("The request could not be completed. Check your connection and try again.");
    } finally {
      submissionLock.current = false;
      setIsGenerating(false);
    }
  };

  const openPublishForm = (savedDraft) => {
    setPublishDraft(savedDraft);
    setPublishForm({
      title: savedDraft.title || "",
      description: savedDraft.description || "",
      gradeLevel: "",
      section: "",
      openingLocal: "",
      closingLocal: "",
    });
    setPublishErrors({});
    setPublishError("");
    setPublishSuccess("");
  };

  const handlePublish = async (event) => {
    event.preventDefault();
    if (isPublishing || !user || !publishDraft) return;

    const errors = {};
    if (!publishForm.title.trim()) errors.title = "Quiz title is required.";
    const matchingClasses = teacherClasses.filter(
      (item) =>
        item.grade_level === publishForm.gradeLevel &&
        item.section === publishForm.section &&
        (item.assigned_subjects || []).some(
          (subject) => subject.id === publishDraft.subject_id,
        ),
    );
    if (matchingClasses.length !== 1) {
      errors.section = "Select a grade and section you are authorized to manage.";
    }

    const openingAt = manilaDateTimeToIso(publishForm.openingLocal);
    const closingAt = manilaDateTimeToIso(publishForm.closingLocal);
    if (!openingAt) errors.opening = "Opening date and time are required.";
    else if (new Date(openingAt).getTime() <= Date.now()) {
      errors.opening = "Opening time must be in the future.";
    }
    if (!closingAt) errors.closing = "Closing date and time are required.";
    else if (openingAt && new Date(closingAt).getTime() <= new Date(openingAt).getTime()) {
      errors.closing = "Closing time must be later than opening time.";
    }

    setPublishErrors(errors);
    setPublishError("");
    if (Object.keys(errors).length > 0) return;

    if (!window.confirm("Publish this quiz to the selected grade and section?")) return;

    setIsPublishing(true);
    try {
      const response = await authenticatedFetch(
        user,
        `/api/quizzes/${encodeURIComponent(publishDraft.id)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: publishForm.title.trim(),
            description: publishForm.description.trim() || null,
            target_class_id: matchingClasses[0].id,
            opening_at: openingAt,
            closing_at: closingAt,
          }),
        },
      );
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        setPublishError(
          typeof payload?.detail === "string"
            ? payload.detail
            : "Unable to publish this quiz. Please review the schedule and class.",
        );
        return;
      }

      setPublishSuccess(`"${publishForm.title.trim()}" was published.`);
      setPublishDraft(null);
      if (draft?.id === publishDraft.id) setDraft(payload);
      await Promise.all([loadQuizDrafts(user), loadPublishedQuizzes(user)]);
    } catch (error) {
      console.error("Publish quiz request failed:", error);
      setPublishError("The publish request could not be completed. Check your connection.");
    } finally {
      setIsPublishing(false);
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
  const publishableClasses = publishDraft
    ? teacherClasses.filter((item) =>
        (item.assigned_subjects || []).some(
          (subject) => subject.id === publishDraft.subject_id,
        ),
      )
    : [];
  const gradeOptions = [...new Set(publishableClasses.map((item) => item.grade_level))].sort();
  const sectionOptions = [
    ...new Set(
      publishableClasses
        .filter((item) => item.grade_level === publishForm.gradeLevel)
        .map((item) => item.section),
    ),
  ].sort();

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

      <section className="quiz-saved-drafts" aria-labelledby="quiz-saved-drafts-title">
        <div className="quiz-panel-heading">
          <h3 id="quiz-saved-drafts-title">My Quiz Drafts</h3>
          <p>Reopen a saved draft to continue reviewing or editing it.</p>
        </div>

        {quizDraftsLoading && (
          <p className="quiz-loading-message" role="status">
            Loading your quiz drafts...
          </p>
        )}

        {quizDraftsError && (
          <div className="quiz-form-message error" role="alert">
            {quizDraftsError}
            <button
              type="button"
              className="secondary-button"
              onClick={() => loadQuizDrafts(user)}
            >
              Retry
            </button>
          </div>
        )}

        {!quizDraftsLoading && !quizDraftsError && quizDrafts.length === 0 && (
          <p className="quiz-empty-message" role="status">
            You have no saved quiz drafts yet.
          </p>
        )}

        {!quizDraftsLoading && quizDrafts.length > 0 && (
          <ul className="quiz-draft-list">
            {quizDrafts.map((savedDraft) => {
              const lesson = lessons.find((item) => item.id === savedDraft.lesson_id);
              const isSelected = draft?.id === savedDraft.id;
              return (
                <li className="quiz-draft-list-item" key={savedDraft.id}>
                  <div>
                    <h4>{savedDraft.title}</h4>
                    <p>Lesson: {lesson?.title || savedDraft.lesson_id}</p>
                    <p>
                      Updated:{" "}
                      {formatDraftDate(savedDraft.updated_at || savedDraft.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={isSelected ? "secondary-button" : "primary-button"}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setLessonId(savedDraft.lesson_id);
                      setDraft(savedDraft);
                    }}
                  >
                    {isSelected ? "Draft open" : "Reopen draft"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => openPublishForm(savedDraft)}
                  >
                    Publish Quiz
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {publishSuccess && (
        <p className="quiz-form-message success" role="status">
          {publishSuccess}
        </p>
      )}

      <section className="quiz-saved-drafts" aria-labelledby="published-quizzes-title">
        <div className="quiz-panel-heading">
          <h3 id="published-quizzes-title">Published Quizzes</h3>
          <p>Review the target class and scheduled availability of your published quizzes.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => loadPublishedQuizzes(user)}
            disabled={publishedQuizzesLoading}
          >
            {publishedQuizzesLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {teacherClassesError && (
          <p className="quiz-form-message error" role="alert">{teacherClassesError}</p>
        )}
        {publishedQuizzesLoading ? (
          <p className="quiz-loading-message" role="status">Loading published quizzes...</p>
        ) : publishedQuizzesError ? (
          <div className="quiz-form-message error" role="alert">
            {publishedQuizzesError}
            <button
              type="button"
              className="secondary-button"
              onClick={() => loadPublishedQuizzes(user)}
            >
              Retry
            </button>
          </div>
        ) : publishedQuizzes.length === 0 ? (
          <p className="quiz-empty-message">You have no published quizzes yet.</p>
        ) : (
          <ul className="quiz-draft-list">
            {publishedQuizzes.map((publishedQuiz) => (
              <li className="quiz-draft-list-item" key={publishedQuiz.id}>
                <div>
                  <h4>{publishedQuiz.published_title || publishedQuiz.title}</h4>
                  <p>
                    Target: {publishedQuiz.published_grade_level || "Unknown"} —{" "}
                    {publishedQuiz.published_section || "Unknown"}
                  </p>
                  <p>Status: {publishedQuiz.availability_status || "Closed"}</p>
                  <p>Opens: {formatPhilippineDate(publishedQuiz.opening_at)}</p>
                  <p>Closes: {formatPhilippineDate(publishedQuiz.closing_at)}</p>
                </div>
                <span className="quiz-draft-status">
                  {publishedQuiz.availability_status || "Closed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {publishDraft && (
        <div className="quiz-publish-overlay">
          <section
            className="quiz-publish-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quiz-publish-title"
          >
            <header className="quiz-draft-header">
              <div>
                <p className="quiz-eyebrow">Publish quiz</p>
                <h3 id="quiz-publish-title">Configure publication</h3>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPublishDraft(null)}
                disabled={isPublishing}
              >
                Cancel
              </button>
            </header>
            <form className="quiz-generator-form" onSubmit={handlePublish} noValidate>
              <label className="quiz-edit-field">
                Selected quiz draft
                <select
                  aria-label="Selected quiz draft"
                  value={publishDraft.id}
                  onChange={(event) => {
                    const selected = quizDrafts.find(
                      (item) => item.id === event.target.value,
                    );
                    if (selected) openPublishForm(selected);
                  }}
                >
                  {quizDrafts.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="quiz-help-text">
                {publishDraft.questions.length} question
                {publishDraft.questions.length === 1 ? "" : "s"} will be included.
              </p>
              <label className="quiz-edit-field">
                Publication title
                <input
                  aria-label="Publication title"
                  value={publishForm.title}
                  aria-invalid={Boolean(publishErrors.title)}
                  onChange={(event) =>
                    setPublishForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
                {publishErrors.title && (
                  <span className="quiz-field-error" role="alert">
                    {publishErrors.title}
                  </span>
                )}
              </label>
              <label className="quiz-edit-field">
                Publication description (optional)
                <textarea
                  aria-label="Publication description"
                  rows="2"
                  value={publishForm.description}
                  onChange={(event) =>
                    setPublishForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="quiz-count-fields">
                <label className="quiz-edit-field">
                  Grade level
                  <select
                    aria-label="Grade level"
                    value={publishForm.gradeLevel}
                    onChange={(event) =>
                      setPublishForm((current) => ({
                        ...current,
                        gradeLevel: event.target.value,
                        section: "",
                      }))
                    }
                  >
                    <option value="">Select a grade</option>
                    {gradeOptions.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="quiz-edit-field">
                  Section
                  <select
                    aria-label="Section"
                    value={publishForm.section}
                    disabled={!publishForm.gradeLevel}
                    onChange={(event) =>
                      setPublishForm((current) => ({
                        ...current,
                        section: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select a section</option>
                    {sectionOptions.map((section) => (
                      <option key={section} value={section}>
                        {section}
                      </option>
                    ))}
                  </select>
                  {publishErrors.section && (
                    <span className="quiz-field-error" role="alert">
                      {publishErrors.section}
                    </span>
                  )}
                </label>
              </div>
              {teacherClassesLoading && (
                <p className="quiz-loading-message" role="status">
                  Loading authorized classes...
                </p>
              )}
              <p className="quiz-help-text">
                Times use Philippine local time (Asia/Manila).
              </p>
              <label className="quiz-edit-field">
                Opening date and time
                <input
                  aria-label="Opening date and time"
                  type="datetime-local"
                  value={publishForm.openingLocal}
                  onChange={(event) =>
                    setPublishForm((current) => ({
                      ...current,
                      openingLocal: event.target.value,
                    }))
                  }
                />
                {publishErrors.opening && (
                  <span className="quiz-field-error" role="alert">
                    {publishErrors.opening}
                  </span>
                )}
              </label>
              <label className="quiz-edit-field">
                Closing date and time
                <input
                  aria-label="Closing date and time"
                  type="datetime-local"
                  value={publishForm.closingLocal}
                  onChange={(event) =>
                    setPublishForm((current) => ({
                      ...current,
                      closingLocal: event.target.value,
                    }))
                  }
                />
                {publishErrors.closing && (
                  <span className="quiz-field-error" role="alert">
                    {publishErrors.closing}
                  </span>
                )}
              </label>
              <p className="quiz-help-text">
                Students see Scheduled before opening, Open during the availability
                window, and Closed after closing.
              </p>
              {publishError && (
                <p className="quiz-form-message error" role="alert">
                  {publishError}
                </p>
              )}
              <button
                type="submit"
                className="primary-button"
                disabled={isPublishing}
              >
                {isPublishing ? "Publishing..." : "Confirm and Publish"}
              </button>
            </form>
          </section>
        </div>
      )}

      {draft && (
        <DraftReview
          draft={draft}
          lesson={selectedLesson}
          setDraft={setDraft}
          user={user}
          onSaved={() => loadQuizDrafts(user)}
        />
      )}
    </PortalLayout>
  );
}
