import React, { useEffect, useState } from "react";
import PortalLayout from "../../components/PortalLayout.jsx";
import StudentNavigation from "../../components/navigation/StudentNavigation.jsx";
import { authenticatedFetch } from "../../services/api.js";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import "./StudentQuizzes.css";

async function parseResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : `Request failed (${response.status}).`,
    );
  }
  return data;
}

function formatAvailability(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

function QuizAvailability({ openingAt, closingAt }) {
  const opening = formatAvailability(openingAt);
  const closing = formatAvailability(closingAt);

  if (!opening && !closing) {
    return <p className="student-quiz-availability">Available now</p>;
  }

  return (
    <dl className="student-quiz-availability">
      {opening && (
        <div>
          <dt>Opens</dt>
          <dd>{opening}</dd>
        </div>
      )}
      {closing && (
        <div>
          <dt>Closes</dt>
          <dd>{closing}</dd>
        </div>
      )}
    </dl>
  );
}

export default function StudentQuizzes() {
  const [quizzes, setQuizzes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [activeUser, setActiveUser] = useState(null);
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [quizError, setQuizError] = useState("");
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadQuizzes = async (user) => {
      try {
        const tokenResult = await getIdTokenResult(user, true);
        if (tokenResult.claims.role !== "student") {
          window.location.replace("/login?notice=unconfigured");
          return;
        }

        if (isMounted) setActiveUser(user);
        const response = await authenticatedFetch(user, "/api/student/quizzes");
        const data = await parseResponse(response);
        if (!Array.isArray(data)) {
          throw new Error("The quizzes endpoint returned unexpected data.");
        }

        if (isMounted) {
          setQuizzes(data);
          setError("");
        }
      } catch (loadError) {
        console.error("Could not load student quizzes:", loadError);
        if (isMounted) {
          setError("Unable to load available quizzes. Please try again.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.replace("/login");
        return;
      }

      if (isMounted) {
        setIsLoading(true);
        setError("");
      }
      loadQuizzes(user);
    }, (authError) => {
      console.error("Student authentication check failed:", authError);
      if (isMounted) {
        setIsLoading(false);
        setError("Unable to verify your account. Please sign in again.");
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [retryCount]);

  const openQuiz = async (quizId) => {
    if (!activeUser || isLoadingQuiz) return;
    setIsLoadingQuiz(true);
    setQuizError("");
    try {
      const response = await authenticatedFetch(
        activeUser,
        `/api/student/quizzes/${encodeURIComponent(quizId)}`,
      );
      const data = await parseResponse(response);
      setSelectedQuiz(data);
      setAnswers(Object.fromEntries(data.questions.map((question) => [question.id, ""])));
    } catch (loadError) {
      console.error("Could not open student quiz:", loadError);
      setQuizError("This quiz is no longer available. Refresh the list and try again.");
    } finally {
      setIsLoadingQuiz(false);
    }
  };

  const submitQuiz = async (event) => {
    event.preventDefault();
    if (!activeUser || !selectedQuiz || isSubmitting) return;

    const incomplete = selectedQuiz.questions.some((question) => {
      const answer = answers[question.id];
      return answer === "" || answer === undefined || answer === null;
    });
    if (incomplete) {
      setQuizError("Answer every question before submitting.");
      return;
    }

    setIsSubmitting(true);
    setQuizError("");
    try {
      const response = await authenticatedFetch(
        activeUser,
        `/api/student/quizzes/${encodeURIComponent(selectedQuiz.id)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: selectedQuiz.questions.map((question) => ({
              question_id: question.id,
              answer:
                question.type === "true_false"
                  ? answers[question.id] === "true"
                  : answers[question.id],
            })),
          }),
        },
      );
      await parseResponse(response);
      setSelectedQuiz(null);
      setAnswers({});
      setRetryCount((count) => count + 1);
    } catch (submitError) {
      console.error("Could not submit student quiz:", submitError);
      setQuizError(
        submitError.message ||
          "Unable to submit this quiz. It may have closed or already been submitted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PortalLayout
      role="student"
      pageClassName="page-student-quizzes"
      title="Available Quizzes"
      description="Complete quizzes published for your class."
      navigation={<StudentNavigation activePath="/student/quizzes" />}
    >
      <section className="student-quizzes" aria-labelledby="student-quizzes-heading">
        <div className="section-header">
          <h3 id="student-quizzes-heading">Your quizzes</h3>
        </div>

        {isLoading ? (
          <p className="student-quizzes-state" role="status">
            Loading available quizzes...
          </p>
        ) : error ? (
          <div className="student-quizzes-state" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="student-quizzes-retry"
              onClick={() => setRetryCount((count) => count + 1)}
            >
              Try again
            </button>
          </div>
        ) : quizzes.length === 0 ? (
          <p className="student-quizzes-state">
            No quizzes are available right now.
          </p>
        ) : (
          <div className="student-quiz-list">
            {quizzes.map((quiz) => (
              <article className="student-quiz-card" key={quiz.id}>
                <h4>{quiz.title}</h4>
                {quiz.description ? (
                  <p className="student-quiz-description">{quiz.description}</p>
                ) : (
                  <p className="student-quiz-description muted">
                    No description provided.
                  </p>
                )}
                <QuizAvailability
                  openingAt={quiz.opening_at}
                  closingAt={quiz.closing_at}
                />
                {(quiz.grade_level || quiz.section) && (
                  <p className="student-quiz-class">
                    {quiz.grade_level || "Grade"}{quiz.section ? ` - ${quiz.section}` : ""}
                  </p>
                )}
                <p className={`student-quiz-status status-${quiz.status}`} role="status">
                  {quiz.status.charAt(0).toUpperCase() + quiz.status.slice(1)}
                </p>
                {quiz.status === "open" && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={isLoadingQuiz}
                    onClick={() => openQuiz(quiz.id)}
                  >
                    {isLoadingQuiz ? "Loading quiz..." : "Answer Quiz"}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}

        {quizError && <p className="student-quizzes-state" role="alert">{quizError}</p>}

        {selectedQuiz && (
          <section className="student-quiz-taking" aria-labelledby="student-quiz-taking-title">
            <header>
              <h4 id="student-quiz-taking-title">{selectedQuiz.title}</h4>
              <p>Submit once before the closing time. Answers cannot be changed after submission.</p>
            </header>
            <form onSubmit={submitQuiz}>
              {selectedQuiz.questions.map((question, index) => (
                <fieldset className="student-quiz-question" key={question.id}>
                  <legend>{index + 1}. {question.prompt}</legend>
                  {question.type === "multiple_choice" ? (
                    question.options.map((option) => (
                      <label key={option}>
                        <input
                          type="radio"
                          name={`question-${question.id}`}
                          value={option}
                          checked={answers[question.id] === option}
                          onChange={(event) => setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))}
                        />
                        {option}
                      </label>
                    ))
                  ) : question.type === "true_false" ? (
                    <select
                      aria-label={`Answer question ${index + 1}`}
                      value={answers[question.id]}
                      onChange={(event) => setAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))}
                    >
                      <option value="">Select an answer</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : question.type === "essay" ? (
                    <textarea
                      aria-label={`Answer question ${index + 1}`}
                      value={answers[question.id]}
                      onChange={(event) => setAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))}
                    />
                  ) : (
                    <input
                      aria-label={`Answer question ${index + 1}`}
                      value={answers[question.id]}
                      onChange={(event) => setAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))}
                    />
                  )}
                </fieldset>
              ))}
              <div className="student-quiz-actions">
                <button type="submit" className="primary-button" disabled={isSubmitting}>
                  {isSubmitting ? "Submitting..." : "Submit Quiz"}
                </button>
                <button
                  type="button"
                  className="student-quizzes-retry"
                  disabled={isSubmitting}
                  onClick={() => setSelectedQuiz(null)}
                >
                  Close
                </button>
              </div>
            </form>
          </section>
        )}
      </section>
    </PortalLayout>
  );
}
