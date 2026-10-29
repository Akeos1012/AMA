// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherLessons from "./Lessons.jsx";

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

const classes = [
  {
    id: "class-1",
    name: "Grade 5",
    grade_level: "Grade 5",
    section: "A",
    assigned_subjects: [
      { id: "subject-1", name: "Science", code: "SCI" },
      { id: "subject-2", name: "Mathematics", code: "MATH" },
    ],
  },
  {
    id: "class-2",
    grade_level: "Grade 6",
    section: "B",
    assigned_subjects: [{ id: "subject-3", name: "English", code: "ENG" }],
  },
];

const lesson = {
  id: "lesson-1",
  title: "Cell Energy",
  topic: "ATP",
  class_id: "class-1",
  subject_id: "subject-1",
  teacher_id: "teacher-1",
  status: "draft",
  content: {
    schema_version: 1,
    blocks: [
      { type: "heading", text: "Energy", level: 1 },
      { type: "paragraph", text: "ATP stores usable energy." },
      { type: "bullet_list", items: ["Cells use ATP."] },
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

function setupSuccessfulLoads(lessonData = [lesson]) {
  mocks.authenticatedFetch.mockImplementation(async (_user, endpoint) => {
    if (endpoint === "/api/lessons") return response(200, lessonData);
    if (endpoint === "/api/teacher/classes") return response(200, classes);
    throw new Error(`Unexpected request: ${endpoint}`);
  });
}

async function openPage() {
  render(<TeacherLessons />);
  await screen.findByRole("heading", { name: "Your lessons" });
}

beforeEach(() => {
  mocks.user = { uid: "teacher-1", getIdToken: vi.fn() };
  mocks.role = "teacher";
  setupSuccessfulLoads();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("teacher lesson management", () => {
  it("restricts the lesson management interface to authenticated teachers", async () => {
    mocks.user = null;
    render(<TeacherLessons />);
    expect(await screen.findByText("Sign in to manage your lessons.")).toBeTruthy();

    cleanup();
    mocks.user = { uid: "student-1" };
    mocks.role = "student";
    render(<TeacherLessons />);
    expect(
      await screen.findByText("Teacher access is required to manage lessons."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create lesson" })).toBeNull();
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
  });

  it("loads lessons and teacher-authorized class/subject choices with the authenticated client", async () => {
    await openPage();

    expect(screen.getByText("Cell Energy")).toBeTruthy();
    expect(screen.getByText("ATP")).toBeTruthy();
    expect(screen.getByText("Grade 5 · A")).toBeTruthy();
    expect(screen.getByText("Science")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      mocks.user,
      "/api/lessons",
    );
    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      mocks.user,
      "/api/teacher/classes",
    );
  });

  it("previews unsaved edits and returns to editing without losing them", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const paragraph = screen.getByRole("textbox", { name: "Block 2 paragraph text" });
    await user.clear(paragraph);
    await user.type(paragraph, "Unsaved student-facing edit.");
    await user.click(screen.getByRole("button", { name: "Preview as student" }));

    expect(screen.getByRole("article", { name: "Student lesson preview" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cell Energy" })).toBeTruthy();
    const preview = screen.getByRole("article", { name: "Student lesson preview" });
    expect(preview.querySelector(".lesson-preview-topic").textContent).toBe("ATP");
    expect(within(preview).getByText("Grade 5 · A")).toBeTruthy();
    expect(within(preview).getByText("Science")).toBeTruthy();
    expect(within(preview).getByText("Energy")).toBeTruthy();
    expect(within(preview).getByText("Unsaved student-facing edit.")).toBeTruthy();
    expect(within(preview).getByText("Cells use ATP.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Return to editing" }));
    expect(
      screen.getByRole("textbox", { name: "Block 2 paragraph text" }).value,
    ).toBe("Unsaved student-facing edit.");
  });

  it("shows a quiz-generation warning for short lessons without blocking publication", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [lesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1/publish" && options.method === "POST") {
        return response(200, { ...lesson, status: "published" });
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      screen.getByText(/below the 15-word quiz-generation minimum/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Return to editing" }));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("It can still be published"),
    );
    expect(await screen.findByText("Lesson published.")).toBeTruthy();
    expect(screen.getByText("published")).toBeTruthy();
  });

  it("publishes eligible drafts through the authorized endpoint and prevents duplicate clicks", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolvePublish;
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [lesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1/publish" && options.method === "POST") {
        return new Promise((resolve) => {
          resolvePublish = () => resolve(response(200, { ...lesson, status: "published" }));
        });
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    const publishButton = screen.getByRole("button", { name: "Publish" });
    await user.click(publishButton);
    await user.click(screen.getByRole("button", { name: "Publishing..." }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(
      mocks.authenticatedFetch.mock.calls.filter(
        (call) => call[1] === "/api/lessons/lesson-1/publish",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Publishing..." }).disabled).toBe(true);

    resolvePublish();
    expect(await screen.findByText("Lesson published.")).toBeTruthy();
    expect(screen.getByText("published")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeTruthy();
  });

  it("unpublishes with confirmation and refreshes the displayed status", async () => {
    const user = userEvent.setup();
    const publishedLesson = { ...lesson, status: "published" };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [publishedLesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1/unpublish" && options.method === "POST") {
        return response(200, { ...publishedLesson, status: "draft", published_at: null });
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    await user.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(confirm).toHaveBeenCalledWith('Unpublish "Cell Energy"?');
    expect(await screen.findByText("Lesson unpublished.")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("does not publish when lesson data is invalid or edits are unsaved", async () => {
    const user = userEvent.setup();
    const invalidLesson = { ...lesson, title: " ", topic: "" };
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint) => {
      if (endpoint === "/api/lessons") return response(200, [invalidLesson]);
      if (endpoint === "/api/teacher/classes") return response(200, classes);
      throw new Error(`Unexpected request: ${endpoint}`);
    });
    await openPage();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "Add a lesson title before publishing.",
    );
    expect(
      mocks.authenticatedFetch.mock.calls.some((call) =>
        call[1].endsWith("/publish"),
      ),
    ).toBe(false);

    mocks.authenticatedFetch.mockReset();
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint) => {
      if (endpoint === "/api/lessons") return response(200, [lesson]);
      if (endpoint === "/api/teacher/classes") return response(200, classes);
      throw new Error(`Unexpected request: ${endpoint}`);
    });
    cleanup();
    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), " changed");
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "Save or cancel your unsaved lesson changes",
    );
    expect(
      mocks.authenticatedFetch.mock.calls.some((call) =>
        call[1].endsWith("/publish"),
      ),
    ).toBe(false);
  });

  it("displays publication endpoint errors without reporting success", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [lesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1/publish") {
        return response(403, { detail: "You are not authorized for this class and subject." });
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });
    await openPage();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "You are not authorized for this class and subject.",
    );
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.queryByText("Lesson published.")).toBeNull();
  });

  it("creates a draft lesson using the canonical content schema", async () => {
    const user = userEvent.setup();
    const createdLesson = {
      ...lesson,
      id: "lesson-new",
      title: "New topic",
      topic: "Energy",
      content: {
        schema_version: 1,
        blocks: [
          { type: "paragraph", text: "Cells transfer energy through ATP." },
          { type: "heading", text: "Energy use", level: 2 },
          { type: "bullet_list", items: ["Cells use ATP.", "ATP stores energy."] },
        ],
      },
    };
    mocks.authenticatedFetch
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(200, classes))
      .mockResolvedValueOnce(response(201, createdLesson));
    await openPage();
    await user.click(screen.getByRole("button", { name: "Create lesson" }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), "New topic");
    await user.type(screen.getByRole("textbox", { name: "Lesson topic" }), "Energy");
    await user.type(
      screen.getByRole("textbox", { name: "Block 1 paragraph text" }),
      "Cells transfer energy through ATP.",
    );
    await user.click(screen.getByRole("button", { name: "Add heading" }));
    await user.type(
      screen.getByRole("textbox", { name: "Block 2 heading text" }),
      "Energy use",
    );
    await user.click(screen.getByRole("button", { name: "Add bullet list" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Block 3 bullet items" }), {
      target: { value: "Cells use ATP.\nATP stores energy." },
    });
    await user.click(screen.getByRole("button", { name: "Save as draft" }));

    await screen.findByText("Lesson created as a draft.");
    const createCall = mocks.authenticatedFetch.mock.calls[2];
    expect(createCall[0]).toBe(mocks.user);
    expect(createCall[1]).toBe("/api/lessons");
    expect(createCall[2].method).toBe("POST");
    expect(JSON.parse(createCall[2].body)).toEqual({
      title: "New topic",
      topic: "Energy",
      class_id: "class-1",
      subject_id: "subject-1",
      content: {
        schema_version: 1,
        blocks: [
          { type: "paragraph", text: "Cells transfer energy through ATP." },
          { type: "heading", text: "Energy use", level: 2 },
          { type: "bullet_list", items: ["Cells use ATP.", "ATP stores energy."] },
        ],
      },
    });
  });

  it("previews, edits, and saves TXT import as ordered canonical paragraphs", async () => {
    const user = userEvent.setup();
    const savedLesson = {
      ...lesson,
      id: "lesson-imported",
      title: "Imported lesson",
      content: {
        schema_version: 1,
        blocks: [
          { type: "paragraph", text: "Corrected first paragraph." },
          { type: "paragraph", text: "Second paragraph follows." },
        ],
      },
    };
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, []);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/import/txt") {
        expect(options.method).toBe("POST");
        expect(options.body.get("class_id")).toBe("class-1");
        expect(options.body.get("subject_id")).toBe("subject-1");
        expect(options.body.get("file").name).toBe("lesson.txt");
        return response(200, {
          source_type: "txt",
          text: "Original first paragraph.\n\nSecond paragraph follows.",
          paragraph_count: 2,
          page_count: null,
        });
      }
      if (endpoint === "/api/lessons" && options.method === "POST") {
        return response(201, savedLesson);
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    await user.click(screen.getByRole("button", { name: "Create lesson" }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), "Imported lesson");
    await user.type(screen.getByRole("textbox", { name: "Lesson topic" }), "Text import");
    await user.upload(
      screen.getByLabelText("TXT file to import"),
      new File(["Original first paragraph."], "lesson.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    const preview = await screen.findByRole("textbox", { name: "Extracted text preview" });
    expect(preview.value).toContain("Original first paragraph.");
    fireEvent.change(preview, {
      target: {
        value: "Corrected first paragraph.\n\nSecond paragraph follows.",
      },
    });
    await user.click(screen.getByRole("button", { name: "Use imported text" }));
    expect(screen.getByRole("textbox", { name: "Block 1 paragraph text" }).value).toBe(
      "Corrected first paragraph.",
    );
    expect(screen.getByRole("textbox", { name: "Block 2 paragraph text" }).value).toBe(
      "Second paragraph follows.",
    );

    await user.click(screen.getByRole("button", { name: "Preview as student" }));
    const studentPreview = screen.getByRole("article", {
      name: "Student lesson preview",
    });
    expect(within(studentPreview).getByText("Corrected first paragraph.")).toBeTruthy();
    expect(within(studentPreview).getByText("Second paragraph follows.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Return to editing" }));
    await user.click(screen.getByRole("button", { name: "Save as draft" }));
    await screen.findByText("Lesson created as a draft.");
    const importCall = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[1] === "/api/lessons/import/txt",
    );
    expect(importCall[0]).toBe(mocks.user);
    const createCall = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[1] === "/api/lessons" && call[2]?.method === "POST",
    );
    expect(JSON.parse(createCall[2].body).content.blocks).toEqual([
      { type: "paragraph", text: "Corrected first paragraph." },
      { type: "paragraph", text: "Second paragraph follows." },
    ]);
  });

  it("shows a clear import error returned by the backend", async () => {
    const user = userEvent.setup();
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, []);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/import/pdf") {
        return response(422, {
          detail: "This PDF has no usable selectable text. OCR is not supported yet.",
        });
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    await user.click(screen.getByRole("button", { name: "Create lesson" }));
    await user.upload(
      screen.getByLabelText("PDF file to import"),
      new File(["fake pdf"], "scanned.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "OCR is not supported yet.",
    );
  });

  it("requires confirmation before replacing an explicitly selected lesson's content", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [lesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/import/txt") {
        return response(200, {
          source_type: "txt",
          text: "Imported replacement paragraph.",
          paragraph_count: 1,
          page_count: null,
        });
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.upload(
      screen.getByLabelText("TXT file to import"),
      new File(["Imported replacement paragraph."], "lesson.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByRole("textbox", { name: "Extracted text preview" });
    const apply = screen.getByRole("button", { name: "Use imported text" });

    await user.click(apply);
    expect(screen.getByRole("textbox", { name: "Block 1 heading text" }).value).toBe(
      "Energy",
    );
    await user.click(apply);
    expect(screen.getByRole("textbox", { name: "Block 1 paragraph text" }).value).toBe(
      "Imported replacement paragraph.",
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("edits all supported block types and includes required class_id in PATCH", async () => {
    const user = userEvent.setup();
    mocks.authenticatedFetch.mockImplementation(async (requestUser, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [lesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1" && options?.method === "PATCH") {
        return response(200, {
          ...lesson,
          title: "Updated title",
          content: JSON.parse(options.body).content,
        });
      }
      throw new Error(`Unexpected request: ${requestUser} ${endpoint}`);
    });
    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Lesson title" }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), "Updated title");
    await user.clear(screen.getByRole("textbox", { name: "Block 2 paragraph text" }));
    await user.type(
      screen.getByRole("textbox", { name: "Block 2 paragraph text" }),
      "Updated source paragraph.",
    );
    const bulletItems = screen.getByRole("textbox", { name: "Block 3 bullet items" });
    await user.clear(bulletItems);
    await user.type(bulletItems, "First item{enter}Second item");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Lesson changes saved.");
    const updateCall = mocks.authenticatedFetch.mock.calls.find(
      (call) => call[1] === "/api/lessons/lesson-1" && call[2]?.method === "PATCH",
    );
    expect(updateCall[0]).toBe(mocks.user);
    expect(JSON.parse(updateCall[2].body)).toMatchObject({
      class_id: "class-1",
      subject_id: "subject-1",
      content: {
        schema_version: 1,
        blocks: [
          { type: "heading", text: "Energy", level: 1 },
          { type: "paragraph", text: "Updated source paragraph." },
          { type: "bullet_list", items: ["First item", "Second item"] },
        ],
      },
    });
  });

  it("adds, removes, and reorders blocks", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Add heading" }));
    expect(screen.getByRole("textbox", { name: "Block 4 heading text" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove block 4" }));
    expect(screen.queryByRole("textbox", { name: "Block 4 heading text" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Move block 2 up" }));
    expect(screen.getByRole("textbox", { name: "Block 1 paragraph text" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Block 2 heading text" })).toBeTruthy();
  });

  it("persists added, removed, and reordered blocks through reload and edit", async () => {
    const user = userEvent.setup();
    let storedLesson = JSON.parse(JSON.stringify(lesson));
    mocks.authenticatedFetch.mockImplementation(async (_requestUser, endpoint, options) => {
      if (endpoint === "/api/lessons" && !options) {
        return response(200, [storedLesson]);
      }
      if (endpoint === "/api/teacher/classes" && !options) {
        return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1" && options?.method === "PATCH") {
        storedLesson = { ...storedLesson, ...JSON.parse(options.body) };
        return response(200, storedLesson);
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Add heading" }));
    await user.type(
      screen.getByRole("textbox", { name: "Block 4 heading text" }),
      "Final section",
    );
    await user.click(screen.getByRole("button", { name: "Remove block 2" }));
    await user.click(screen.getByRole("button", { name: "Move block 3 up" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Lesson changes saved.");

    expect(storedLesson.content.blocks).toEqual([
      { type: "heading", text: "Energy", level: 1 },
      { type: "heading", text: "Final section", level: 2 },
      { type: "bullet_list", items: ["Cells use ATP."] },
    ]);

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Block 1 heading text" }).value).toBe(
      "Energy",
    );
    expect(screen.getByRole("textbox", { name: "Block 2 heading text" }).value).toBe(
      "Final section",
    );
    expect(screen.getByRole("textbox", { name: "Block 3 bullet items" }).value).toBe(
      "Cells use ATP.",
    );
  });

  it("asks before discarding unsaved edits", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await openPage();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), " changed");
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);

    expect(confirm).toHaveBeenCalledWith("Discard your unsaved lesson changes?");
    expect(screen.getByRole("heading", { name: "Edit lesson" })).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(screen.queryByRole("heading", { name: "Edit lesson" })).toBeNull();
  });

  it("validates blank metadata and content before making a write request", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole("button", { name: "Create lesson" }));
    await user.click(screen.getByRole("button", { name: "Save as draft" }));

    expect(screen.getByText("Enter a lesson title.")).toBeTruthy();
    expect(screen.getByText("Enter a lesson topic.")).toBeTruthy();
    expect(screen.getByText("Block 1 must contain text.")).toBeTruthy();
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it("requires confirmation before deleting and reports success after deletion", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint, options) => {
      if (!options) {
        if (endpoint === "/api/lessons") return response(200, [lesson]);
        if (endpoint === "/api/teacher/classes") return response(200, classes);
      }
      if (endpoint === "/api/lessons/lesson-1" && options.method === "DELETE") {
        return { ok: true, status: 204 };
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });
    await openPage();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Lesson deleted.");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(mocks.authenticatedFetch.mock.calls[2][1]).toBe("/api/lessons/lesson-1");
    expect(mocks.authenticatedFetch.mock.calls[2][2].method).toBe("DELETE");
    expect(screen.queryByText("Cell Energy")).toBeNull();
  });

  it("shows loading and empty states", async () => {
    let resolveLessons;
    mocks.authenticatedFetch.mockImplementation((_user, endpoint) => {
      if (endpoint === "/api/lessons") {
        return new Promise((resolve) => {
          resolveLessons = resolve;
        });
      }
      return Promise.resolve(response(200, classes));
    });
    render(<TeacherLessons />);
    expect(await screen.findByText("Loading your lessons...")).toBeTruthy();
    resolveLessons(response(200, []));
    expect(await screen.findByText("You have not created any accessible lessons yet.")).toBeTruthy();
  });

  it("displays API errors without dropping teacher-facing context", async () => {
    mocks.authenticatedFetch.mockImplementation(async (_user, endpoint) => {
      if (endpoint === "/api/lessons") {
        return response(422, { detail: "Lesson content is invalid." });
      }
      return response(200, classes);
    });
    await openPage();

    expect(await screen.findByText("Lesson content is invalid.")).toBeTruthy();
    expect(screen.getByText("Your lessons")).toBeTruthy();
  });
});
