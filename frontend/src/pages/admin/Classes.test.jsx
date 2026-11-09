// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Classes from "./Classes.jsx";

const mocks = vi.hoisted(() => ({
  user: { uid: "admin-1" },
  authenticatedFetch: vi.fn(),
}));

vi.mock("../../services/firebase.js", () => ({
  auth: mocks,
  getIdTokenResult: vi.fn(async () => ({ claims: { role: "admin" } })),
  onAuthStateChanged: vi.fn((_auth, callback) => {
    queueMicrotask(() => callback(mocks.user));
    return vi.fn();
  }),
}));

vi.mock("../../services/api.js", () => ({
  authenticatedFetch: (...args) => mocks.authenticatedFetch(...args),
}));

vi.mock("../../components/PortalLayout.jsx", () => ({
  default: ({ children, headerAction }) => (
    <main>
      {headerAction}
      {children}
    </main>
  ),
}));

vi.mock("../../components/navigation/AdminNavigation.jsx", () => ({
  default: () => null,
}));

vi.mock("./classes/ClassFormDialog.jsx", () => ({ default: () => null }));
vi.mock("./classes/ClassScheduleDialog.jsx", () => ({ default: () => null }));

const accounts = [
  {
    uid: "student-alice",
    display_name: "Alice Adams",
    email: "alice@example.test",
    student_id: "S-100",
    role: "student",
    disabled: false,
    profile_status: "active",
    grade_level: "Grade 1",
  },
  {
    uid: "student-bob",
    display_name: "Bob Brown",
    email: "bob@example.test",
    student_id: "S-101",
    role: "student",
    disabled: false,
    profile_status: "active",
    grade_level: "Grade 1",
  },
  {
    uid: "student-enrolled",
    display_name: "Chris Current",
    email: "chris@example.test",
    student_id: "S-102",
    role: "student",
    disabled: false,
    profile_status: "active",
    grade_level: "Grade 1",
  },
  {
    uid: "student-other-class",
    display_name: "Drew Elsewhere",
    email: "drew@example.test",
    student_id: "S-103",
    role: "student",
    disabled: false,
    profile_status: "active",
    grade_level: "Grade 1",
  },
  {
    uid: "student-disabled",
    display_name: "Evan Disabled",
    email: "evan@example.test",
    student_id: "S-104",
    role: "student",
    disabled: true,
    profile_status: "active",
    grade_level: "Grade 1",
  },
  {
    uid: "student-inactive",
    display_name: "Fran Inactive",
    email: "fran@example.test",
    student_id: "S-105",
    role: "student",
    disabled: false,
    profile_status: "inactive",
    grade_level: "Grade 1",
  },
  {
    uid: "student-other-grade",
    display_name: "Gray Grade",
    email: "gray@example.test",
    student_id: "S-106",
    role: "student",
    disabled: false,
    profile_status: "active",
    grade_level: "Grade 2",
  },
  {
    uid: "teacher-1",
    display_name: "Taylor Teacher",
    email: "teacher@example.test",
    role: "teacher",
    disabled: false,
    profile_status: "active",
    grade_level: "Grade 1",
  },
];

const classRecords = [
  {
    id: "class-1",
    name: "Grade 1 - A",
    grade_level: "Grade 1",
    section: "A",
    status: "active",
    lead_teacher_uid: null,
    schedule: [],
  },
  {
    id: "class-2",
    name: "Grade 1 - B",
    grade_level: "Grade 1",
    section: "B",
    status: "active",
    lead_teacher_uid: null,
    schedule: [],
  },
];

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function configureApi({
  classStatus = "active",
  accountResponse = response(200, accounts),
  failUid = "",
  pendingUid = "",
} = {}) {
  const memberships = new Map([
    ["class-1", new Set(["student-enrolled"])],
    ["class-2", new Set(["student-other-class"])],
  ]);
  const requests = [];
  let resolvePending;
  mocks.authenticatedFetch.mockImplementation((_user, endpoint, options = {}) => {
    if (endpoint === "/api/admin/users") return Promise.resolve(accountResponse);
    if (endpoint === "/api/admin/subjects") return Promise.resolve(response(200, []));
    if (endpoint === "/api/admin/classes") {
      return Promise.resolve(
        response(
          200,
          classRecords.map((record) =>
            record.id === "class-1"
              ? { ...record, status: classStatus }
              : record,
          ),
        ),
      );
    }

    const membershipMatch = endpoint.match(
      /^\/api\/admin\/classes\/([^/]+)\/memberships$/,
    );
    if (membershipMatch && options.method === "POST") {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.student_uid === pendingUid) {
        return new Promise((resolve) => {
          resolvePending = () => {
            memberships.get(body.class_id).add(body.student_uid);
            resolve(
              response(200, {
                id: `membership-${body.student_uid}`,
                class_id: body.class_id,
                student_uid: body.student_uid,
                status: "active",
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              }),
            );
          };
        });
      }
      if (body.student_uid === failUid) {
        return Promise.resolve(response(403, { detail: "Not eligible." }));
      }
      memberships.get(body.class_id).add(body.student_uid);
      return Promise.resolve(
        response(200, {
          id: `membership-${body.student_uid}`,
          class_id: body.class_id,
          student_uid: body.student_uid,
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
    }
    if (membershipMatch) {
      const classId = decodeURIComponent(membershipMatch[1]);
      return Promise.resolve(
        response(
          200,
          [...(memberships.get(classId) ?? [])].map((studentUid) => ({
            id: `membership-${studentUid}`,
            class_id: classId,
            student_uid: studentUid,
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          })),
        ),
      );
    }
    return Promise.resolve(response(404, { detail: "Not found." }));
  });
  return { requests, resolvePending: () => resolvePending?.() };
}

async function openStudentsDialog() {
  render(<Classes />);
  const openButton = await screen.findByRole("button", { name: "Students" });
  await userEvent.setup().click(openButton);
  return screen.findByRole("button", { name: "Add Students" });
}

beforeEach(() => {
  localStorage.setItem("ama-lms-admin-selected-class", "class-1");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("admin class student assignment", () => {
  it("only offers Add Students for an active class", async () => {
    configureApi({ classStatus: "inactive" });
    render(<Classes />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Students" }),
    );

    expect(
      screen.queryByRole("button", { name: "Add Students" }),
    ).toBeNull();
  });

  it("filters eligible students by status, grade, role, and active memberships", async () => {
    configureApi();
    const user = userEvent.setup();
    await openStudentsDialog();
    await user.click(screen.getByRole("button", { name: "Add Students" }));
    const addStudents = screen.getByRole("region", { name: "Add Students" });

    expect(await within(addStudents).findByText("Alice Adams")).toBeTruthy();
    expect(within(addStudents).getByText("Bob Brown")).toBeTruthy();
    expect(
      within(addStudents).getByRole("button", {
        name: "Confirm Assignment",
      }),
    ).toHaveProperty("disabled", true);
    for (const excludedName of [
      "Chris Current",
      "Drew Elsewhere",
      "Evan Disabled",
      "Fran Inactive",
      "Gray Grade",
      "Taylor Teacher",
    ]) {
      expect(within(addStudents).queryByText(excludedName)).toBeNull();
    }
  });

  it("searches eligible students and allows selecting multiple students", async () => {
    configureApi();
    const user = userEvent.setup();
    await openStudentsDialog();
    await user.click(screen.getByRole("button", { name: "Add Students" }));
    const addStudents = screen.getByRole("region", { name: "Add Students" });
    await within(addStudents).findByText("Alice Adams");

    await user.type(
      within(addStudents).getByRole("searchbox", {
        name: "Search eligible students",
      }),
      "bob@",
    );
    expect(within(addStudents).getByText("Bob Brown")).toBeTruthy();
    expect(within(addStudents).queryByText("Alice Adams")).toBeNull();
    await user.click(
      within(addStudents).getByRole("checkbox", { name: /Bob Brown/ }),
    );
    expect(screen.getByText("1 student selected")).toBeTruthy();

    await user.clear(
      within(addStudents).getByRole("searchbox", {
        name: "Search eligible students",
      }),
    );
    await user.click(
      within(addStudents).getByRole("checkbox", {
        name: "Select all eligible students",
      }),
    );
    expect(screen.getByText("2 students selected")).toBeTruthy();
  });

  it("assigns selected students once and refreshes the roster", async () => {
    const api = configureApi({ pendingUid: "student-alice" });
    const user = userEvent.setup();
    await openStudentsDialog();
    await user.click(screen.getByRole("button", { name: "Add Students" }));
    const addStudents = screen.getByRole("region", { name: "Add Students" });
    await within(addStudents).findByText("Alice Adams");
    await user.click(
      within(addStudents).getByRole("checkbox", { name: /Alice Adams/ }),
    );
    const confirmButton = within(addStudents).getByRole("button", {
      name: "Confirm Assignment",
    });

    await user.click(confirmButton);
    expect(
      within(addStudents).getByRole("button", { name: "Assigning..." }),
    ).toHaveProperty("disabled", true);
    await user.click(confirmButton);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toEqual({
      class_id: "class-1",
      student_uid: "student-alice",
      status: "active",
    });
    api.resolvePending();

    expect(
      await screen.findByText(/Assigned 1 of 1 selected student/),
    ).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: /Students/ });
    expect(within(dialog).getByText("2 students in this section")).toBeTruthy();
    expect(within(dialog).getByText("Alice Adams")).toBeTruthy();
    expect(within(dialog).getByText("Chris Current")).toBeTruthy();
  });

  it("reports partial failures and refreshes successful memberships", async () => {
    const api = configureApi({ failUid: "student-bob" });
    const user = userEvent.setup();
    await openStudentsDialog();
    await user.click(screen.getByRole("button", { name: "Add Students" }));
    const addStudents = screen.getByRole("region", { name: "Add Students" });
    await within(addStudents).findByText("Alice Adams");
    await user.click(
      within(addStudents).getByRole("checkbox", {
        name: "Select all eligible students",
      }),
    );
    await user.click(
      within(addStudents).getByRole("button", {
        name: "Confirm Assignment",
      }),
    );

    expect(
      await screen.findByText(/Assigned 1 of 2 selected students/),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Bob Brown: Not eligible.",
    );
    const dialog = screen.getByRole("dialog", { name: /Students/ });
    expect(within(dialog).getByText("2 students in this section")).toBeTruthy();
    await waitFor(() => {
      expect(within(addStudents).queryByText("Alice Adams")).toBeNull();
    });
    expect(within(dialog).getByText("Alice Adams")).toBeTruthy();
    expect(within(addStudents).getByText("Bob Brown")).toBeTruthy();
    expect(api.requests).toHaveLength(2);
  });

  it("shows account retrieval errors and allows retry", async () => {
    configureApi({
      accountResponse: response(503, { detail: "Accounts unavailable." }),
    });
    const user = userEvent.setup();
    await openStudentsDialog();
    await user.click(screen.getByRole("button", { name: "Add Students" }));
    const addStudents = screen.getByRole("region", { name: "Add Students" });

    expect(
      await within(addStudents).findByText(
        "Unable to load student accounts. Please try again.",
      ),
    ).toBeTruthy();
    expect(within(addStudents).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows an empty state when no eligible accounts exist", async () => {
    configureApi({ accountResponse: response(200, []) });
    const user = userEvent.setup();
    await openStudentsDialog();
    await user.click(screen.getByRole("button", { name: "Add Students" }));
    const addStudents = screen.getByRole("region", { name: "Add Students" });

    expect(
      await within(addStudents).findByText(
        "No eligible students are available for this class.",
      ),
    ).toBeTruthy();
    expect(
      within(addStudents).getByRole("button", {
        name: "Confirm Assignment",
      }),
    ).toHaveProperty("disabled", true);
  });
});
