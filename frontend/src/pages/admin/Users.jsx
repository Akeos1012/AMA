import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import { parseUserCsv, userGrades } from "./users/userCsv.js";
import UserAccountDialog from "./users/UserAccountDialog.jsx";
import UsersCsvPreview from "./users/UsersCsvPreview.jsx";
import "./Users.css";

const USERS_ENDPOINT = "/api/admin/users";
const USERS_PER_PAGE = 15;
const emptyForm = {
  role: "",
  name: "",
  email: "",
  student_id: "",
  grade_level: "",
  section: "",
  sex: "",
  employee_id: "",
  department_subject: "",
};

function getCreateErrorMessage(status, detail) {
  if (status === 409 && /student id/i.test(detail)) {
    return "A student with this Student ID already exists.";
  }
  if (status === 409 && /employee id/i.test(detail)) {
    return "A teacher with this Employee ID already exists.";
  }
  if (status === 409 && /email/i.test(detail)) {
    return "An account with this email already exists.";
  }
  if (status === 401) {
    return "Your session is invalid or expired. Sign in again and retry.";
  }
  if (status === 403) {
    return "You are not authorized to create accounts.";
  }
  if (status === 422) {
    return "Check the account details and complete all required fields.";
  }
  if (status >= 500) {
    return "The server could not create the account. Please try again.";
  }
  return "Unable to create the account. Check the details and try again.";
}

function formatCreatedDate(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return "—";
  }
  const date = new Date(
    typeof timestamp === "number" ? timestamp : String(timestamp),
  );
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getRoleLabel(role) {
  if (role === "student") return "Student";
  if (role === "teacher") return "Teacher";
  if (role === "admin") return "Admin";
  return "—";
}

function UsersPage() {
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [statusUser, setStatusUser] = useState(null);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvError, setCsvError] = useState("");
  const csvInputRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [createError, setCreateError] = useState("");
  const [usersMessage, setUsersMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadAdminUsers = useCallback(async (user) => {
    if (!user) {
      throw new Error("An authenticated user is required to load accounts.");
    }

    setUsersLoading(true);
    setUsersError("");

    try {
      const response = await authenticatedFetch(user, USERS_ENDPOINT);

      if (!response.ok) {
        throw new Error(`Failed to load users: ${response.status}`);
      }

      const responseUsers = await response.json();
      if (!Array.isArray(responseUsers)) {
        throw new Error("The users endpoint returned an unexpected response.");
      }

      setUsers(responseUsers);
    } catch (error) {
      console.error("Could not load admin users:", error);
      setUsersError("Unable to load users. Please try again.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (!user) {
          window.location.replace("/login");
          return;
        }

        try {
          const tokenResult = await getIdTokenResult(user, true);
          if (tokenResult.claims.role !== "admin") {
            window.location.replace("/login?notice=unconfigured");
            return;
          }

          if (isMounted) {
            await loadAdminUsers(user);
          }
        } catch (error) {
          console.error("Admin authentication check failed:", error);
          window.location.replace("/login");
        }
      },
      (error) => {
        console.error("Admin authentication check failed:", error);
        window.location.replace("/login");
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [loadAdminUsers]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return users.filter((user) => {
      const searchableValues = [
        user.display_name,
        user.email,
        user.student_id,
        user.employee_id,
      ];
      const matchesSearch = searchableValues.some((value) =>
        String(value ?? "").toLowerCase().includes(normalizedSearch),
      );
      const matchesRole = !roleFilter || user.role === roleFilter;
      const matchesStatus =
        !statusFilter ||
        (statusFilter === "disabled" ? user.disabled : !user.disabled);
      const matchesGrade =
        !gradeFilter ||
        (user.role === "student" && user.grade_level === gradeFilter);

      return matchesSearch && matchesRole && matchesStatus && matchesGrade;
    });
  }, [gradeFilter, roleFilter, searchTerm, statusFilter, users]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredUsers.length / USERS_PER_PAGE),
  );
  const pageStart = (currentPage - 1) * USERS_PER_PAGE;
  const visibleUsers = filteredUsers.slice(pageStart, pageStart + USERS_PER_PAGE);
  const firstVisibleUser = filteredUsers.length ? pageStart + 1 : 0;
  const lastVisibleUser = Math.min(
    pageStart + USERS_PER_PAGE,
    filteredUsers.length,
  );
  const totalStudents = users.filter((user) => user.role === "student").length;
  const totalTeachers = users.filter((user) => user.role === "teacher").length;
  const totalDisabled = users.filter((user) => user.disabled).length;
  const pageNumbers = [
    ...new Set(
      [1, pageCount, currentPage - 1, currentPage, currentPage + 1].filter(
        (page) => page >= 1 && page <= pageCount,
      ),
    ),
  ].sort((first, second) => first - second);

  useEffect(() => {
    setCurrentPage(1);
  }, [gradeFilter, roleFilter, searchTerm, statusFilter]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  function openCreateUserDialog() {
    setEditingUser(null);
    setForm(emptyForm);
    setCreateError("");
    setUsersMessage(null);
    setIsModalOpen(true);
  }

  function closeCreateUserDialog() {
    setIsModalOpen(false);
    setEditingUser(null);
    setForm(emptyForm);
    setCreateError("");
  }

  function openEditUserDialog(user) {
    if (user.role !== "student" && user.role !== "teacher") return;
    setEditingUser(user);
    setForm({
      ...emptyForm,
      role: user.role,
      name: user.display_name ?? "",
      email: user.email ?? "",
      student_id: user.student_id ?? "",
      grade_level: user.grade_level ?? "",
      section: user.section ?? "",
      sex: user.sex ?? "",
      employee_id: user.employee_id ?? "",
      department_subject: user.department_subject ?? "",
    });
    setCreateError("");
    setUsersMessage(null);
    setIsModalOpen(true);
  }

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setCreateError("");
    setIsSubmitting(true);

    const requestBody = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
    };

    if (form.role === "student") {
      requestBody.student_id = form.student_id.trim();
      requestBody.grade_level = form.grade_level;
      requestBody.section = form.section.trim();
      requestBody.sex = form.sex;
    } else if (form.role === "teacher") {
      requestBody.employee_id = form.employee_id.trim();
      requestBody.department_subject = form.department_subject.trim();
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        setCreateError("Your session has expired. Sign in again and retry.");
        return;
      }

      const response = await authenticatedFetch(user, USERS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        let detail = "";
        try {
          const responseBody = await response.json();
          detail =
            typeof responseBody.detail === "string" ? responseBody.detail : "";
        } catch {
          // Keep the status-specific message when the response is not JSON.
        }
        setCreateError(getCreateErrorMessage(response.status, detail));
        return;
      }

      const createdRole = form.role === "student" ? "Student" : "Teacher";
      let resetEmailFailed = false;
      try {
        await sendPasswordResetEmail(auth, requestBody.email);
      } catch (error) {
        console.error(
          "Account was created, but the password reset email failed:",
          error,
        );
        resetEmailFailed = true;
      }

      setForm(emptyForm);
      setIsModalOpen(false);
      setUsersMessage({
        type: resetEmailFailed ? "error" : "success",
        text: resetEmailFailed
          ? `${createdRole} account created, but the password reset email could not be sent.`
          : `${createdRole} account created successfully.`,
      });
      await loadAdminUsers(user);
    } catch (error) {
      console.error("Account creation request failed:", error);
      setCreateError(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

    async function handleEditUser(event) {
      event.preventDefault();
      if (!editingUser || editingUser.role === "admin") return;
      setCreateError("");
      setIsSubmitting(true);

      const requestBody = {
        name: form.name.trim(),
        email: form.email.trim(),
      };
      if (editingUser.role === "student") {
        requestBody.student_id = form.student_id.trim();
        requestBody.grade_level = form.grade_level;
        requestBody.section = form.section.trim();
        requestBody.sex = form.sex;
      } else {
        requestBody.employee_id = form.employee_id.trim();
        requestBody.department_subject = form.department_subject.trim();
      }

      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Your session has expired. Sign in again.");
        const response = await authenticatedFetch(
          user,
          `${USERS_ENDPOINT}/${encodeURIComponent(editingUser.uid)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          },
        );
        if (!response.ok) {
          let detail = "";
          try {
            const responseBody = await response.json();
            detail =
              typeof responseBody.detail === "string" ? responseBody.detail : "";
          } catch {
            // Fall back to a status-specific message for non-JSON responses.
          }
          setCreateError(getCreateErrorMessage(response.status, detail));
          return;
        }

        const editedRole = getRoleLabel(editingUser.role);
        closeCreateUserDialog();
        setUsersMessage({
          type: "success",
          text: `${editedRole} account updated successfully.`,
        });
        await loadAdminUsers(user);
      } catch (error) {
        console.error("Account update request failed:", error);
        setCreateError(
          "Could not update the account. Check your connection and try again.",
        );
      } finally {
        setIsSubmitting(false);
      }
    }

    async function confirmUserStatusChange() {
      if (!statusUser || statusUser.role === "admin") return;
      setIsUpdatingUser(true);
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Your session has expired. Sign in again.");
        const disabled = !statusUser.disabled;
        const response = await authenticatedFetch(
          user,
          `${USERS_ENDPOINT}/${encodeURIComponent(statusUser.uid)}/status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ disabled }),
          },
        );
        if (!response.ok) {
          const responseBody = await response.json().catch(() => ({}));
          throw new Error(
            typeof responseBody.detail === "string"
              ? responseBody.detail
              : `Status update failed (${response.status}).`,
          );
        }
        setUsersMessage({
          type: "success",
          text: `${statusUser.display_name ?? "User"} ${
            disabled ? "disabled" : "enabled"
          } successfully.`,
        });
        setStatusUser(null);
        await loadAdminUsers(user);
      } catch (error) {
        console.error("User status update failed:", error);
        setUsersMessage({
          type: "error",
          text: error.message || "Could not update the account status.",
        });
      } finally {
        setIsUpdatingUser(false);
      }
    }

    async function handleCsvFileChange(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setCsvError("");
      setCsvPreview(null);
      try {
        setCsvPreview(parseUserCsv(await file.text(), file.name));
      } catch (error) {
        setCsvError(error.message || "Could not read this CSV file.");
      }
    }

  return (
    <PortalLayout
      role="admin"
      pageClassName="page-admin-users"
      title="Users"
      description="Manage registered students, teachers, and administrators."
      navigation={<AdminNavigation activePath="/admin/users" />}
      headerAction={
        <div className="users-header-actions">
          <input
            ref={csvInputRef}
            className="users-csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            aria-label="Choose student CSV file"
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => csvInputRef.current?.click()}
          >
            Import CSV
          </button>
          <button
            type="button"
            id="create-user-button"
            className="primary-button"
            onClick={openCreateUserDialog}
          >
            + Create Account
          </button>
        </div>
      }
    >
      <UserAccountDialog
        isOpen={isModalOpen}
        editingUser={editingUser}
        form={form}
        createError={createError}
        isSubmitting={isSubmitting}
        grades={userGrades}
        editingRoleLabel={getRoleLabel(editingUser?.role ?? "")}
        onClose={closeCreateUserDialog}
        onFormChange={updateForm}
        onCreate={handleCreateUser}
        onEdit={handleEditUser}
      />

      <div className="users-page">
        <section className="users-summary-cards" aria-label="User account summary">
          {[
            ["Total Users", users.length],
            ["Students", totalStudents],
            ["Teachers", totalTeachers],
            ["Disabled", totalDisabled],
          ].map(([label, count]) => (
            <article className="users-summary-card" key={label}>
              <h3>{label}</h3>
              <p>{usersLoading ? "—" : count}</p>
            </article>
          ))}
        </section>

        <div className="users-toolbar" role="search">
          <label className="users-search-field" htmlFor="user-search">
            <span className="visually-hidden">Search name, email, or ID</span>
            <input
              type="search"
              id="user-search"
              placeholder="Search name, email, or ID..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <label>
            <span className="visually-hidden">Filter by role</span>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All Roles</option>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            <span className="visually-hidden">Filter by status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            <span className="visually-hidden">Filter by grade</span>
            <select
              value={gradeFilter}
              onChange={(event) => setGradeFilter(event.target.value)}
              aria-label="Filter by grade"
            >
              <option value="">All Grades</option>
              {userGrades.map((grade) => (
                <option value={grade} key={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </label>
        </div>

        {csvError && (
          <p className="form-message error users-inline-message" role="alert">
            {csvError}
          </p>
        )}

        <section className="users-container" id="users-container">
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">ID</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr>
                    <td colSpan="7" className="users-table-message">
                      Loading users...
                    </td>
                  </tr>
                ) : usersError ? (
                  <tr>
                    <td colSpan="7" className="users-table-message" role="alert">
                      {usersError}
                      <button
                        type="button"
                        className="users-action-button"
                        onClick={() => {
                          if (auth.currentUser) loadAdminUsers(auth.currentUser);
                        }}
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="users-table-message">
                      No users match your filters.
                    </td>
                  </tr>
                ) : (
                  visibleUsers.map((user) => {
                    const editable =
                      user.role === "student" || user.role === "teacher";
                    const accountId =
                      user.role === "student"
                        ? user.student_id
                        : user.role === "teacher"
                          ? user.employee_id
                          : null;
                    return (
                      <tr key={user.uid}>
                        <td className="users-name">
                          {user.display_name || "—"}
                        </td>
                        <td>{user.email || "—"}</td>
                        <td>{getRoleLabel(user.role)}</td>
                        <td>{accountId || "—"}</td>
                        <td>
                          <span
                            className={`users-status ${
                              user.disabled ? "disabled" : "active"
                            }`}
                          >
                            {user.disabled ? "Disabled" : "Active"}
                          </span>
                        </td>
                        <td>{formatCreatedDate(user.created_at)}</td>
                        <td className="users-actions">
                          {editable ? (
                            <>
                              <button
                                type="button"
                                className="users-action-button"
                                onClick={() => openEditUserDialog(user)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`users-action-button ${
                                  user.disabled ? "" : "destructive"
                                }`}
                                onClick={() => setStatusUser(user)}
                              >
                                {user.disabled ? "Enable" : "Disable"}
                              </button>
                            </>
                          ) : (
                            <span aria-label="No actions">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {!usersLoading && !usersError && filteredUsers.length > 0 && (
            <div className="users-pagination">
              <span>
                Showing {firstVisibleUser}–{lastVisibleUser} of{" "}
                {filteredUsers.length}
              </span>
              <nav aria-label="User list pages">
                <button
                  type="button"
                  className="users-page-button"
                  onClick={() =>
                    setCurrentPage((page) => Math.max(1, page - 1))
                  }
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                {pageNumbers.map((page, index) => (
                  <React.Fragment key={page}>
                    {index > 0 && page - pageNumbers[index - 1] > 1 && (
                      <span className="users-page-ellipsis" aria-hidden="true">
                        …
                      </span>
                    )}
                    <button
                      type="button"
                      className={`users-page-button${
                        currentPage === page ? " active" : ""
                      }`}
                      aria-current={currentPage === page ? "page" : undefined}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  </React.Fragment>
                ))}
                <button
                  type="button"
                  className="users-page-button"
                  onClick={() =>
                    setCurrentPage((page) => Math.min(pageCount, page + 1))
                  }
                  disabled={currentPage === pageCount}
                >
                  Next
                </button>
              </nav>
            </div>
          )}
        </section>
      </div>

      <div
        className={`modal-overlay${statusUser ? " active" : ""}`}
        aria-hidden={!statusUser}
        onClick={(event) => {
          if (event.target === event.currentTarget && !isUpdatingUser) {
            setStatusUser(null);
          }
        }}
      >
        {statusUser && (
          <section
            className="modal users-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-status-title"
          >
            <div className="modal-header">
              <div>
                <h3 id="user-status-title">
                  {statusUser.disabled ? "Enable User?" : "Disable User?"}
                </h3>
                <p>
                  {statusUser.disabled
                    ? `Enable ${statusUser.display_name || "this user"} again?`
                    : `Are you sure you want to disable ${
                        statusUser.display_name || "this user"
                      }?`}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close"
                disabled={isUpdatingUser}
                onClick={() => setStatusUser(null)}
              >
                &times;
              </button>
            </div>
            <div className="users-confirm-content">
              {!statusUser.disabled && (
                <p>
                  The user will no longer be able to access AMA LMS.
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isUpdatingUser}
                  onClick={() => setStatusUser(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={
                    statusUser.disabled
                      ? "primary-button"
                      : "users-confirm-disable"
                  }
                  disabled={isUpdatingUser}
                  onClick={confirmUserStatusChange}
                >
                  {isUpdatingUser
                    ? "Updating..."
                    : statusUser.disabled
                      ? "Enable User"
                      : "Disable User"}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      <UsersCsvPreview
        preview={csvPreview}
        onClose={() => setCsvPreview(null)}
      />

        {usersMessage && (
          <p
            id="users-message"
            className={`form-message ${usersMessage.type}`}
            role="status"
            aria-live="polite"
          >
            {usersMessage.text}
          </p>
        )}
    </PortalLayout>
  );
}

export default UsersPage;
