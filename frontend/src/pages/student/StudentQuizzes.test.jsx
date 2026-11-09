// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentQuizzes from "./StudentQuizzes.jsx";

const mocks = vi.hoisted(() => ({
  user: { uid: "student-1" },
  authenticatedFetch: vi.fn(),
}));

vi.mock("../../services/firebase.js", () => ({
  auth: {},
  getIdTokenResult: vi.fn(async () => ({ claims: { role: "student" } })),
  onAuthStateChanged: vi.fn((_auth, callback) => {
    queueMicrotask(() => callback(mocks.user));
    return vi.fn();
  }),
}));

vi.mock("../../services/api.js", () => ({
  authenticatedFetch: (...args) => mocks.authenticatedFetch(...args),
}));

vi.mock("../../components/PortalLayout.jsx", () => ({
  default: ({ children, title }) => <main><h1>{title}</h1>{children}</main>,
}));

vi.mock("../../components/navigation/StudentNavigation.jsx", () => ({
  default: () => <nav>Student navigation</nav>,
}));

const listedQuizzes = [
  { id: "scheduled", title: "Scheduled Quiz", status: "scheduled", opening_at: "2030-01-01T02:00:00Z", closing_at: "2030-01-02T02:00:00Z" },
  { id: "open", title: "Open Quiz", status: "open", opening_at: "2020-01-01T02:00:00Z", closing_at: "2030-01-02T02:00:00Z", grade_level: "Grade 1", section: "A" },
  { id: "closed", title: "Closed Quiz", status: "closed", opening_at: "2020-01-01T02:00:00Z", closing_at: "2020-01-02T02:00:00Z" },
  { id: "answered", title: "Answered Quiz", status: "answered" },
];

const quizDetail = {
  id: "open",
  title: "Open Quiz",
  description: "Answer without seeing the key.",
  questions: [
    {
      id: 0,
      type: "multiple_choice",
      prompt: "Which organelle generates ATP?",
      options: ["Mitochondria", "Ribosome", "Nucleus", "Vacuole"],
    },
    { id: 1, type: "essay", prompt: "Explain cellular energy." },
  ],
};

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function configureRequests({ submitResponse = response(200, { id: "open", status: "answered" }) } = {}) {
  let answered = false;
  mocks.authenticatedFetch.mockImplementation((_user, endpoint, options = {}) => {
    if (endpoint === "/api/student/quizzes") {
      const quizzes = listedQuizzes.map((quiz) =>
        quiz.id === "open" && answered ? { ...quiz, status: "answered" } : quiz,
      );
      return Promise.resolve(response(200, quizzes));
    }
    if (endpoint === "/api/student/quizzes/open" && !options.method) {
      return Promise.resolve(response(200, quizDetail));
    }
    if (endpoint === "/api/student/quizzes/open/submit") {
      if (submitResponse.ok) answered = true;
      return Promise.resolve(submitResponse);
    }
    return Promise.resolve(response(404, { detail: "Not found" }));
  });
}

beforeEach(() => {
  mocks.user = { uid: "student-1" };
  mocks.authenticatedFetch.mockReset();
  configureRequests();
});

afterEach(() => cleanup());

describe("student published quizzes", () => {
  it("shows server statuses and only offers Answer Quiz when open", async () => {
    render(<StudentQuizzes />);
    expect(await screen.findByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("Open", { selector: ".student-quiz-status" })).toBeTruthy();
    expect(screen.getByText("Closed", { selector: ".student-quiz-status" })).toBeTruthy();
    expect(screen.getByText("Answered", { selector: ".student-quiz-status" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Answer Quiz" })).toHaveLength(1);
    expect(screen.getByText("Grade 1 - A")).toBeTruthy();
  });

  it("opens and submits an available quiz, then displays Answered", async () => {
    const user = userEvent.setup();
    render(<StudentQuizzes />);
    await user.click(await screen.findByRole("button", { name: "Answer Quiz" }));

    expect(await screen.findByText(/Which organelle generates ATP\?/)).toBeTruthy();
    await user.click(screen.getByLabelText("Mitochondria"));
    await user.type(
      screen.getByRole("textbox", { name: "Answer question 2" }),
      "ATP stores usable energy.",
    );
    await user.click(screen.getByRole("button", { name: "Submit Quiz" }));

    await waitFor(() => {
      expect(screen.getAllByText("Answered", { selector: ".student-quiz-status" })).toHaveLength(2);
    });
    const submission = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[1] === "/api/student/quizzes/open/submit",
    );
    expect(JSON.parse(submission[2].body)).toEqual({
      answers: [
        { question_id: 0, answer: "Mitochondria" },
        { question_id: 1, answer: "ATP stores usable energy." },
      ],
    });
    expect(screen.queryByText("correct_answer")).toBeNull();
  });

  it("displays API errors when submission is rejected", async () => {
    configureRequests({
      submitResponse: response(404, { detail: "Quiz is closed." }),
    });
    const user = userEvent.setup();
    render(<StudentQuizzes />);
    await user.click(await screen.findByRole("button", { name: "Answer Quiz" }));
    await user.click(await screen.findByLabelText("Mitochondria"));
    await user.type(
      screen.getByRole("textbox", { name: "Answer question 2" }),
      "ATP",
    );
    await user.click(screen.getByRole("button", { name: "Submit Quiz" }));
    expect(await screen.findByText("Quiz is closed.")).toBeTruthy();
  });
});
