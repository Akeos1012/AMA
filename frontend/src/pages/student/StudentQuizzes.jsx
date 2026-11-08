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

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
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

  useEffect(() => {
    let isMounted = true;

    const loadQuizzes = async (user) => {
      try {
        const tokenResult = await getIdTokenResult(user, true);
        if (tokenResult.claims.role !== "student") {
          window.location.replace("/login?notice=unconfigured");
          return;
        }

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
              </article>
            ))}
          </div>
        )}
      </section>
    </PortalLayout>
  );
}
