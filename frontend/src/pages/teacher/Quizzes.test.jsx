// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherQuizzes from "./Quizzes.jsx";
import DraftReview from "./quizzes/QuizDraftReview.jsx";
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

function configureRequests({
  drafts = [],
  draftList,
  generation = response(201, draft),
  save = response(200, draft),
  classes = [
    {
      id: "class-1",
      grade_level: "Grade 1",
      section: "A",
      assigned_subjects: [{ id: "subject-1", name: "Biology" }],
    },
  ],
  published = [],
  publish = response(200, { ...draft, status: "published" }),
} = {}) {
  mocks.authenticatedFetch.mockImplementation((_user, endpoint, options = {}) => {
    if (endpoint === "/api/lessons") {
      return Promise.resolve(response(200, [lesson]));
    }
    if (endpoint === "/api/teacher/classes?include_students=false") {
      return Promise.resolve(response(200, classes));
    }
    if (endpoint === "/api/quizzes/published") {
      return Promise.resolve(response(200, published));
    }
    if (endpoint === "/api/quizzes" && !options.method) {
      const currentDrafts = typeof drafts === "function" ? drafts() : drafts;
      const currentResponse =
        typeof draftList === "function"
          ? draftList()
          : draftList || response(200, currentDrafts);
      return Promise.resolve(currentResponse);
    }
    if (endpoint.endsWith("/generate-quiz")) {
      return Promise.resolve(typeof generation === "function" ? generation() : generation);
    }
    if (options.method === "PATCH") {
      return Promise.resolve(typeof save === "function" ? save() : save);
    }
    if (options.method === "POST" && endpoint.endsWith("/publish")) {
      return Promise.resolve(typeof publish === "function" ? publish() : publish);
    }
    return Promise.resolve(response(404, { detail: "Not found" }));
  });
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
  mocks.authenticatedFetch.mockReset();
  configureRequests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it("loads and displays saved drafts through the authenticated teacher endpoint", async () => {
    const savedDraft = {
      ...draft,
      id: "saved-quiz-1",
      title: "Previously Saved Quiz",
      updated_at: "2026-02-01T12:00:00Z",
    };
    configureRequests({ drafts: [savedDraft] });

    await openTeacherPage();
    expect(await screen.findByText("Previously Saved Quiz")).toBeTruthy();
    expect(screen.getByText("Lesson: Cell Energy")).toBeTruthy();
    expect(screen.getByText(/Updated:/)).toBeTruthy();

    const listCall = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[1] === "/api/quizzes",
    );
    expect(listCall[0]).toBe(mocks.user);
  });

  it("reopens the selected saved draft in the existing review editor", async () => {
    const savedDraft = {
      ...draft,
      id: "saved-quiz-2",
      title: "Saved Quiz to Reopen",
    };
    configureRequests({ drafts: [savedDraft] });
    const user = userEvent.setup();

    await openTeacherPage();
    await user.click(await screen.findByRole("button", { name: "Reopen draft" }));

    expect(screen.getByRole("heading", { name: "Saved Quiz to Reopen", level: 3 })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Question 1 correct answer" }).value).toBe(
      "ATP",
    );
    expect(screen.getByRole("button", { name: "Draft open" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("shows publishing for saved drafts and validates publication details", async () => {
    configureRequests({ drafts: [draft] });
    const user = userEvent.setup();
    await openTeacherPage();
    await user.click(await screen.findByRole("button", { name: "Publish Quiz" }));

    expect(await screen.findByRole("dialog", { name: "Configure publication" })).toBeTruthy();
    expect(screen.getByText("4 questions will be included.")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Publication title" }));
    await user.click(screen.getByRole("button", { name: "Confirm and Publish" }));

    expect(await screen.findByText("Quiz title is required.")).toBeTruthy();
    expect(screen.getByText("Select a grade and section you are authorized to manage.")).toBeTruthy();
    expect(screen.getByText("Opening date and time are required.")).toBeTruthy();
    expect(
      mocks.authenticatedFetch.mock.calls.some((call) => call[2]?.method === "POST"),
    ).toBe(false);
  });

  it("publishes a selected draft to the chosen grade and section with Manila times", async () => {
    configureRequests({ drafts: [draft] });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    await openTeacherPage();
    await user.click(await screen.findByRole("button", { name: "Publish Quiz" }));

    await user.clear(screen.getByRole("textbox", { name: "Publication title" }));
    await user.type(screen.getByRole("textbox", { name: "Publication title" }), "Published copy");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grade level" }), "Grade 1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), "A");
    fireEvent.change(screen.getByLabelText("Opening date and time"), {
      target: { value: "2030-01-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Closing date and time"), {
      target: { value: "2030-01-02T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Confirm and Publish" }));

    expect(await screen.findByText('"Published copy" was published.')).toBeTruthy();
    const publishCall = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[2]?.method === "POST" && call[1].endsWith("/publish"),
    );
    expect(publishCall).toBeTruthy();
    const body = JSON.parse(publishCall[2].body);
    expect(body.title).toBe("Published copy");
    expect(body.target_class_id).toBe("class-1");
    expect(body.opening_at).toBe("2030-01-01T02:00:00.000Z");
    expect(body.closing_at).toBe("2030-01-02T02:00:00.000Z");
    expect(body.teacher_id).toBeUndefined();
  });

  it("rejects closing times that are not later than opening times", async () => {
    configureRequests({ drafts: [draft] });
    const user = userEvent.setup();
    await openTeacherPage();
    await user.click(await screen.findByRole("button", { name: "Publish Quiz" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Grade level" }), "Grade 1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), "A");
    fireEvent.change(screen.getByLabelText("Opening date and time"), {
      target: { value: "2030-01-02T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Closing date and time"), {
      target: { value: "2030-01-01T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Confirm and Publish" }));
    expect(await screen.findByText("Closing time must be later than opening time.")).toBeTruthy();
    expect(mocks.authenticatedFetch.mock.calls.some((call) => call[2]?.method === "POST")).toBe(false);
  });

  it("displays published quizzes with target and server-calculated schedule status", async () => {
    configureRequests({
      published: [{
        ...draft,
        status: "published",
        published_title: "Scheduled ATP Quiz",
        published_grade_level: "Grade 1",
        published_section: "A",
        opening_at: "2030-01-01T02:00:00Z",
        closing_at: "2030-01-02T02:00:00Z",
        availability_status: "scheduled",
      }],
    });
    await openTeacherPage();
    expect(await screen.findByRole("heading", { name: "Scheduled ATP Quiz", level: 4 })).toBeTruthy();
    expect(screen.getByText("Target: Grade 1 — A")).toBeTruthy();
    expect(screen.getByText("Status: scheduled")).toBeTruthy();
  });

  it("shows a publishing API error without removing the saved draft", async () => {
    configureRequests({
      drafts: [draft],
      publish: response(403, { detail: "Not authorized for that class." }),
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    await openTeacherPage();
    await user.click(await screen.findByRole("button", { name: "Publish Quiz" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Grade level" }), "Grade 1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), "A");
    fireEvent.change(screen.getByLabelText("Opening date and time"), {
      target: { value: "2030-01-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Closing date and time"), {
      target: { value: "2030-01-02T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Confirm and Publish" }));

    expect(await screen.findByText("Not authorized for that class.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: draft.title, level: 4 })).toBeTruthy();
  });

  it("does not offer published quizzes as editable saved drafts", async () => {
    configureRequests({
      drafts: [{ ...draft, status: "published" }],
    });

    await openTeacherPage();
    expect(await screen.findByText("You have no saved quiz drafts yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen draft" })).toBeNull();
  });

  it("shows loading, empty, and retryable error states for saved drafts", async () => {
    let resolveDraftList;
    mocks.authenticatedFetch.mockImplementation((_user, endpoint) => {
      if (endpoint === "/api/quizzes") {
        return new Promise((resolve) => {
          resolveDraftList = resolve;
        });
      }
      return Promise.resolve(response(200, [lesson]));
    });

    await openTeacherPage();
    expect(screen.getByText("Loading your quiz drafts...")).toBeTruthy();
    resolveDraftList(response(200, []));
    expect(await screen.findByText("You have no saved quiz drafts yet.")).toBeTruthy();

    let retryCount = 0;
    configureRequests({
      draftList: () => {
        retryCount += 1;
        return retryCount === 1
          ? response(503, { detail: "unavailable" })
          : response(200, []);
      },
    });
    cleanup();
    await openTeacherPage();
    expect(
      await screen.findByText("Unable to load your quiz drafts right now. Please try again."),
    ).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("You have no saved quiz drafts yet.")).toBeTruthy();
  });

  it("validates the requested question counts before making a request", async () => {
    const user = userEvent.setup();
    await openTeacherPage();
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson" }), lesson.id);
    await user.click(screen.getByRole("button", { name: "Generate quiz draft" }));

    expect(
      screen.getByText("Request at least one question across all types."),
    ).toBeTruthy();
    expect(
      mocks.authenticatedFetch.mock.calls.filter(
        (call) => call[1] === "/api/lessons" || call[1] === "/api/quizzes",
      ),
    ).toHaveLength(2);
  });

  it("uses the authenticated teacher and the lesson generation endpoint", async () => {
    const user = await requestDraft();

    await waitFor(() => {
      expect(screen.getByText("Cell Energy Review")).toBeTruthy();
    });
    const generationCall = mocks.authenticatedFetch.mock.calls.find((call) =>
      call[1].endsWith("/generate-quiz"),
    );
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
    configureRequests({
      generation: new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    });
    const user = userEvent.setup();
    await openTeacherPage();
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson" }), lesson.id);
    await user.type(screen.getByRole("spinbutton", { name: "Multiple-choice count" }), "1");
    const button = screen.getByRole("button", { name: "Generate quiz draft" });
    await user.click(button);
    expect(await screen.findByText(/Generating and validating questions/)).toBeTruthy();
    await user.click(button);
    expect(
      mocks.authenticatedFetch.mock.calls.filter((call) =>
        call[1].endsWith("/generate-quiz"),
      ),
    ).toHaveLength(1);

    resolveGeneration(response(201, draft));
    await screen.findByText("Cell Energy Review");
  });

  it("shows field-level API validation errors", async () => {
    configureRequests({
      generation: response(422, {
          detail: [
            {
              loc: ["body", "question_counts", "multiple_choice"],
              msg: "invalid count",
            },
          ],
        }),
    });
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
    configureRequests({
      generation: response(502, {
        detail: "private provider token: secret-value; stack trace",
      }),
    });
    await requestDraft();

    expect(
      await screen.findByText(
        "The AI generation service is unavailable right now. Please try again later.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/secret-value|stack trace/)).toBeNull();
  });

  it("renders each question type, teacher answers, evidence and validation warnings", async () => {
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
    const user = await requestDraft();
    const answer = await screen.findByRole("textbox", {
      name: "Question 1 correct answer",
    });
    await user.clear(answer);
    await user.type(answer, "Changed answer");

    expect(screen.getByDisplayValue("Changed answer")).toBeTruthy();
    expect(screen.getByText("Draft — teacher review required")).toBeTruthy();
    expect(
      screen.getByText(/Review every question before using it with students/),
    ).toBeTruthy();
    expect(mocks.authenticatedFetch.mock.calls).toHaveLength(6);
    expect(mocks.authenticatedFetch.mock.calls.some((call) => call[2]?.method === "PATCH")).toBe(
      false,
    );
    expect(mocks.authenticatedFetch.mock.calls.some((call) => call[2]?.method === "PUT")).toBe(
      false,
    );
  });

  it("edits a question and quiz title and sends PATCH with updated questions and supported metadata", async () => {
    const updatedDraft = {
      ...draft,
      title: "Updated Cell Energy Quiz",
      questions: [
        {
          ...draft.questions[0],
          correct_answer: "Changed ATP",
        },
        ...draft.questions.slice(1),
      ],
      updated_at: "2026-02-01T00:00:00Z",
    };

    configureRequests({ save: response(200, updatedDraft) });

    const user = await requestDraft();
    const answer = await screen.findByRole("textbox", {
      name: "Question 1 correct answer",
    });
    await user.clear(answer);
    await user.type(answer, "Changed ATP");

    const titleInput = screen.getByRole("textbox", { name: "Quiz title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Updated Cell Energy Quiz");

    const saveButton = screen.getByRole("button", { name: "Save Draft" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Draft changes saved.")).toBeTruthy();
    });

    const patchCall = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[2]?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    expect(patchCall[0]).toBe(mocks.user);
    expect(patchCall[1]).toBe("/api/quizzes/quiz-1");

    const parsedBody = JSON.parse(patchCall[2].body);
    expect(parsedBody.title).toBe("Updated Cell Energy Quiz");
    expect(parsedBody.questions[0].correct_answer).toBe("Changed ATP");
    expect(parsedBody.questions).toHaveLength(4);
    expect(parsedBody.questions[1].type).toBe("true_false");
    expect(parsedBody.questions[1].correct_answer).toBe(true);
    expect(parsedBody.questions[2].type).toBe("identification");
    expect(parsedBody.questions[2].accepted_alternatives).toEqual(["adenosine triphosphate"]);
    expect(parsedBody.questions[3].type).toBe("essay");
    expect(parsedBody.questions[3].rubric).toEqual(["Describe energy storage."]);
    expect(parsedBody.questions[3].sample_solution).toBe(
      "ATP stores usable energy for cell processes.",
    );

    // Verify immutable and server-controlled fields are not sent
    expect(parsedBody.id).toBeUndefined();
    expect(parsedBody.lesson_id).toBeUndefined();
    expect(parsedBody.class_id).toBeUndefined();
    expect(parsedBody.subject_id).toBeUndefined();
    expect(parsedBody.teacher_id).toBeUndefined();
    expect(parsedBody.status).toBeUndefined();
    expect(parsedBody.validation_report).toBeUndefined();
    expect(parsedBody.model_id).toBeUndefined();
    expect(parsedBody.created_at).toBeUndefined();
    expect(parsedBody.updated_at).toBeUndefined();
    expect(parsedBody.published_at).toBeUndefined();
  });

  it("updates the local draft with the successfully saved server response", async () => {
    const serverSavedDraft = {
      ...draft,
      title: "Server Verified Quiz Title",
      questions: [
        {
          ...draft.questions[0],
          prompt: "Server verified question prompt?",
        },
        ...draft.questions.slice(1),
      ],
      updated_at: "2026-02-01T00:00:00Z",
    };

    configureRequests({ save: response(200, serverSavedDraft) });

    const user = await requestDraft();
    const saveButton = await screen.findByRole("button", { name: "Save Draft" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Draft changes saved.")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: "Server Verified Quiz Title" })).toBeTruthy();
    expect(screen.getByDisplayValue("Server verified question prompt?")).toBeTruthy();
  });

  it("refreshes My Quiz Drafts after a successful save", async () => {
    let savedDrafts = [];
    const updatedDraft = {
      ...draft,
      title: "Updated Saved Draft",
      updated_at: "2026-03-01T00:00:00Z",
    };
    configureRequests({
      drafts: () => savedDrafts,
      save: () => {
        savedDrafts = [updatedDraft];
        return response(200, updatedDraft);
      },
    });

    const user = await requestDraft();
    await user.click(await screen.findByRole("button", { name: "Save Draft" }));

    const savedDraftTitle = await screen.findByRole("heading", {
      name: "Updated Saved Draft",
      level: 4,
    });
    expect(savedDraftTitle).toBeTruthy();
    expect(
      mocks.authenticatedFetch.mock.calls.filter((call) => call[1] === "/api/quizzes"),
    ).toHaveLength(3);
  });

  it("preserves local edits and displays error message when save fails", async () => {
    configureRequests({
      save: response(500, { detail: "Failed to save quiz draft." }),
    });

    const user = await requestDraft();
    const answer = await screen.findByRole("textbox", {
      name: "Question 1 correct answer",
    });
    await user.clear(answer);
    await user.type(answer, "My Unsaved Edit");

    const saveButton = screen.getByRole("button", { name: "Save Draft" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByText("Unable to save this quiz draft right now. Please try again."),
      ).toBeTruthy();
    });
    expect(screen.getByDisplayValue("My Unsaved Edit")).toBeTruthy();
  });

  it("prevents duplicate save submissions while a save is in progress", async () => {
    let resolveSave;
    configureRequests({
      save: new Promise((resolve) => {
        resolveSave = resolve;
      }),
    });

    const user = await requestDraft();
    const saveButton = await screen.findByRole("button", { name: "Save Draft" });
    await user.click(saveButton);

    expect(screen.getByText("Saving draft...")).toBeTruthy();
    expect(saveButton.disabled).toBe(true);

    await user.click(saveButton);

    const patchCalls = mocks.authenticatedFetch.mock.calls.filter(
      (call) => call[2]?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);

    resolveSave(response(200, draft));
    await waitFor(() => {
      expect(screen.getByText("Draft changes saved.")).toBeTruthy();
    });
    expect(saveButton.disabled).toBe(false);
  });

  it("disables saving if the quiz has already been published", async () => {
    const publishedDraft = {
      ...draft,
      status: "published",
      published_at: "2026-01-02T00:00:00Z",
    };

    configureRequests({ generation: response(201, publishedDraft) });

    const user = await requestDraft();
    const publishedBadges = await screen.findAllByText("Published");
    expect(publishedBadges.length).toBeGreaterThan(0);

    const saveButton = screen.getByRole("button", { name: "Save Draft" });
    expect(saveButton.disabled).toBe(true);

    await user.click(saveButton);

    const patchCalls = mocks.authenticatedFetch.mock.calls.filter(
      (call) => call[2]?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(0);
  });

  it("disables Save Draft when DraftReview renders a published draft directly", async () => {
    const publishedDraft = {
      ...draft,
      status: "published",
      published_at: "2026-01-02T00:00:00Z",
    };
    render(
      <DraftReview
        draft={publishedDraft}
        lesson={lesson}
        setDraft={vi.fn()}
        user={mocks.user}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "Save Draft" });
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByRole("textbox", { name: "Quiz title" }).disabled).toBe(true);
    expect(screen.getByRole("textbox", { name: "Question 1 text" }).disabled).toBe(true);
    expect(
      screen.getByRole("textbox", { name: "Question 1 correct answer" }).disabled,
    ).toBe(true);

    const user = userEvent.setup();
    await user.click(saveButton);
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
  });

  it("does not show teacher answers in the student-facing section", () => {
    render(<StudentSection />);
    expect(screen.getByText("This section is not available yet.")).toBeTruthy();
    expect(screen.queryByText("The lesson identifies ATP as the energy carrier.")).toBeNull();
    expect(screen.queryByText("ATP")).toBeNull();
  });
});
