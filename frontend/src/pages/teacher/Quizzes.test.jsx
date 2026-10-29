// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherQuizzes from "./Quizzes.jsx";
import StudentSection from "../student/Section.jsx";

const mocks = vi.hoisted(() => ({
  user: null,
  role: "teacher",
  authenticatedFetch: vi.fn(),
}));

vi.mock("../../services/firebase.js", () => ({
  auth: {},
  getIdTokenResult: vi.fn(async () => ({ claims: { role: mocks.role } })),
  onAuthStateChanged: vi.fn((_auth, callback) => {
    queueMicrotask(() => callback(mocks.user));
    return vi.fn();
  }),
}));

vi.mock("../../services/api.js", () => ({
  authenticatedFetch: (...args) => mocks.authenticatedFetch(...args),
}));

const lesson = {
  id: "lesson-1",
  title: "Cell Energy",
  topic: "ATP",
  status: "draft",
};

const draft = {
  id: "quiz-1",
  lesson_id: lesson.id,
  class_id: "class-1",
  subject_id: "subject-1",
  teacher_id: "teacher-1",
  title: "Cell Energy Review",
  status: "draft",
  model_id: "test-model",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  published_at: null,
  questions: [
    {
      type: "multiple_choice",
      prompt: "What molecule stores energy?",
      options: ["ATP", "DNA", "RNA", "Water"],
      correct_answer: "ATP",
      explanation: "The lesson identifies ATP as the energy carrier.",
      evidence: { quote: "ATP stores usable energy.", block_index: 1 },
    },
    {
      type: "true_false",
      prompt: "ATP stores usable energy.",
      correct_answer: true,
      explanation: "The lesson states that ATP stores usable energy.",
      evidence: { quote: "ATP stores usable energy.", block_index: 1 },
    },
    {
      type: "identification",
      prompt: "Name the energy-carrying molecule.",
      correct_answer: "ATP",
      accepted_alternatives: ["adenosine triphosphate"],
      explanation: "The abbreviation is given in the lesson.",
      evidence: { quote: "ATP is adenosine triphosphate.", block_index: 2 },
    },
    {
      type: "essay",
      prompt: "Explain the role of ATP.",
      rubric: ["Describe energy storage."],
      sample_solution: "ATP stores usable energy for cell processes.",
      explanation: "The lesson describes ATP's role.",
      evidence: { quote: "ATP stores usable energy.", block_index: 1 },
    },
  ],
  validation_report: {
    status: "passed",
    is_valid: true,
    grounding_passed: true,
    correctness_passed: true,
    question_reports: [
      {
        question_index: 0,
        status: "passed",
        schema_valid: true,
        quote_valid: true,
        block_reference_valid: true,
        evidence_supported: "passed",
        answer_correct: "passed",
        grounding_passed: true,
        correctness_passed: true,
        issues: [],
      },
    ],
    general_issues: [
      {
        severity: "warning",
        stage: "grounding",
        message: "Review the evidence for clarity.",
      },
    ],
  },
};

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

async function openTeacherPage() {
  render(<TeacherQuizzes />);
  await screen.findByRole("combobox", { name: "Lesson" });
}

async function requestDraft() {
  const user = userEvent.setup();
  await openTeacherPage();
  await user.selectOptions(screen.getByRole("combobox", { name: "Lesson" }), lesson.id);
  await user.clear(screen.getByRole("spinbutton", { name: "Multiple-choice count" }));
  await user.type(screen.getByRole("spinbutton", { name: "Multiple-choice count" }), "1");
  await user.click(screen.getByRole("button", { name: "Generate quiz draft" }));
  return user;
}

beforeEach(() => {
  mocks.user = { uid: "teacher-1", getIdToken: vi.fn() };
  mocks.role = "teacher";
  mocks.authenticatedFetch.mockReset().mockResolvedValue(response(200, [lesson]));
});

afterEach(() => {
  cleanup();
});

describe("teacher quiz review", () => {
  it("does not show the interface to unauthenticated or non-teacher users", async () => {
    mocks.user = null;
    render(<TeacherQuizzes />);
    expect(await screen.findByText("Sign in to access teacher quiz generation.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate quiz draft" })).toBeNull();

    cleanup();
    mocks.user = { uid: "student-1" };
    mocks.role = "student";
    render(<TeacherQuizzes />);
    expect(
      await screen.findByText("Teacher access is required to generate and review quizzes."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate quiz draft" })).toBeNull();
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
  });

  it("validates the requested question counts before making a request", async () => {
    const user = userEvent.setup();
    await openTeacherPage();
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson" }), lesson.id);
    await user.click(screen.getByRole("button", { name: "Generate quiz draft" }));

    expect(
      screen.getByText("Request at least one question across all types."),
    ).toBeTruthy();
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it("uses the authenticated teacher and the lesson generation endpoint", async () => {
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, [lesson]))
      .mockResolvedValueOnce(response(201, draft));
    const user = await requestDraft();

    await waitFor(() => {
      expect(screen.getByText("Cell Energy Review")).toBeTruthy();
    });
    const generationCall = mocks.authenticatedFetch.mock.calls[1];
    expect(generationCall[0]).toBe(mocks.user);
    expect(generationCall[1]).toBe("/api/lessons/lesson-1/generate-quiz");
    expect(generationCall[2].method).toBe("POST");
    expect(JSON.parse(generationCall[2].body)).toEqual({
      question_counts: {
        multiple_choice: 1,
        true_false: 0,
        identification: 0,
        essay: 0,
      },
      instructions: null,
    });
    expect(user).toBeTruthy();
  });

  it("prevents duplicate submissions while generation is in progress", async () => {
    let resolveGeneration;
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, [lesson]))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );
    const user = userEvent.setup();
    await openTeacherPage();
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson" }), lesson.id);
    await user.type(screen.getByRole("spinbutton", { name: "Multiple-choice count" }), "1");
    const button = screen.getByRole("button", { name: "Generate quiz draft" });
    await user.click(button);
    expect(await screen.findByText(/Generating and validating questions/)).toBeTruthy();
    await user.click(button);
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2);

    resolveGeneration(response(201, draft));
    await screen.findByText("Cell Energy Review");
  });

  it("shows field-level API validation errors", async () => {
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, [lesson]))
      .mockResolvedValueOnce(
        response(422, {
          detail: [
            {
              loc: ["body", "question_counts", "multiple_choice"],
              msg: "invalid count",
            },
          ],
        }),
      );
    await requestDraft();

    expect(
      await screen.findByText(
        "The server rejected this count. Enter a whole number from 0 to 50.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Generation failed validation. Check the question counts and selected lesson content.",
      ),
    ).toBeTruthy();
  });

  it("does not expose provider details or secrets in error states", async () => {
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, [lesson]))
      .mockResolvedValueOnce(
        response(502, { detail: "private provider token: secret-value; stack trace" }),
      );
    await requestDraft();

    expect(
      await screen.findByText(
        "The AI generation service is unavailable right now. Please try again later.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/secret-value|stack trace/)).toBeNull();
  });

  it("renders each question type, teacher answers, evidence and validation warnings", async () => {
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, [lesson]))
      .mockResolvedValueOnce(response(201, draft));
    await requestDraft();

    expect(await screen.findByText("Cell Energy Review")).toBeTruthy();
    expect(screen.getByText("Draft — teacher review required")).toBeTruthy();
    expect(screen.getByText("multiple choice")).toBeTruthy();
    expect(screen.getByText("true false")).toBeTruthy();
    expect(screen.getByText("identification")).toBeTruthy();
    expect(screen.getByText("essay")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Question 1 correct answer" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Question 1 option 4" }).value).toBe("Water");
    expect(
      screen.getByText("The lesson identifies ATP as the energy carrier."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element.classList.contains("quiz-question-validation") &&
          element.textContent.includes("Question validation: passed"),
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("ATP stores usable energy.").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        (_, element) =>
          element.tagName === "P" && element.textContent.includes("content block 2"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("textbox", { name: "Question 3 accepted alternatives" }).value,
    ).toBe("adenosine triphosphate");
    expect(screen.getByRole("textbox", { name: "Question 4 rubric item 1" }).value).toBe(
      "Describe energy storage.",
    );
    expect(
      screen.getByRole("textbox", { name: "Question 4 sample solution" }).value,
    ).toBe("ATP stores usable energy for cell processes.");
    expect(screen.getByText(/Review the evidence for clarity/)).toBeTruthy();
  });

  it("keeps edits local and never changes draft status or publishes", async () => {
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, [lesson]))
      .mockResolvedValueOnce(response(201, draft));
    const user = await requestDraft();
    const answer = await screen.findByRole("textbox", {
      name: "Question 1 correct answer",
    });
    await user.clear(answer);
    await user.type(answer, "Changed answer");

    expect(screen.getByDisplayValue("Changed answer")).toBeTruthy();
    expect(screen.getByText("Draft — teacher review required")).toBeTruthy();
    expect(screen.getByText(/Changes below are local to this page and are not saved/)).toBeTruthy();
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2);
    expect(mocks.authenticatedFetch.mock.calls.some((call) => call[2]?.method === "PATCH")).toBe(
      false,
    );
    expect(mocks.authenticatedFetch.mock.calls.some((call) => call[2]?.method === "PUT")).toBe(
      false,
    );
  });

  it("does not show teacher answers in the student-facing section", () => {
    render(<StudentSection />);
    expect(screen.getByText("This section is not available yet.")).toBeTruthy();
    expect(screen.queryByText("The lesson identifies ATP as the energy carrier.")).toBeNull();
    expect(screen.queryByText("ATP")).toBeNull();
  });
});
