import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import { mockClasses } from "./classesMockData.js";
import "../../styles/admin.css";

const USERS_ENDPOINT = "/api/admin/users";
const SUBJECTS_ENDPOINT = "/api/admin/subjects";
const CLASSES_STORAGE_KEY = "ama-lms-admin-classes";

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

function getStoredClasses() {
  const savedClasses = window.localStorage.getItem(CLASSES_STORAGE_KEY);
  if (savedClasses === null) return mockClasses;

  const parsedClasses = JSON.parse(savedClasses);
  if (
    !Array.isArray(parsedClasses) ||
    parsedClasses.some(
      (schoolClass) =>
        !schoolClass ||
        typeof schoolClass.id !== "string" ||
        typeof schoolClass.status !== "string",
    )
  ) {
    throw new Error("Saved class data has an invalid format.");
  }
  return parsedClasses;
}

function getCreatedAtValue(user) {
  const timestamp = user.created_at;
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function formatDate(timestamp) {
  const parsed = getCreatedAtValue({ created_at: timestamp });
  if (!Number.isFinite(parsed)) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export default function AdminDashboard() {
  const [adminName, setAdminName] = useState("Admin");
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [classes, setClasses] = useState(null);
  const [classesError, setClassesError] = useState("");
  const [subjects, setSubjects] = useState(null);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [subjectsError, setSubjectsError] = useState("");

  const loadUsers = useCallback(async (user) => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const data = await parseResponse(
        await authenticatedFetch(user, USERS_ENDPOINT),
      );
      if (!Array.isArray(data)) {
        throw new Error("The users endpoint returned unexpected data.");
      }
      setUsers(data);
    } catch (error) {
      console.error("Could not load dashboard users:", error);
      setUsersError("Unable to load user statistics.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadSubjects = useCallback(async (user) => {
    setSubjectsLoading(true);
    setSubjectsError("");
    try {
      const data = await parseResponse(
        await authenticatedFetch(user, SUBJECTS_ENDPOINT),
      );
      if (!Array.isArray(data)) {
        throw new Error("The subjects endpoint returned unexpected data.");
      }
      setSubjects(data);
    } catch (error) {
      console.error("Could not load dashboard subjects:", error);
      setSubjectsError("Unable to load subject statistics.");
    } finally {
      setSubjectsLoading(false);
    }
  }, []);

  const loadClasses = useCallback(() => {
    setClassesError("");
    try {
      setClasses(getStoredClasses());
    } catch (error) {
      console.error("Could not load dashboard classes:", error);
      setClasses(null);
      setClassesError("Unable to load class information.");
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
          if (!isMounted) return;

          setCurrentUser(user);
          setAdminName(user.displayName?.trim() || "Admin");
          await Promise.all([
            loadUsers(user),
            loadSubjects(user),
            Promise.resolve().then(loadClasses),
          ]);
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
  }, [loadClasses, loadSubjects, loadUsers]);

  useEffect(() => {
    function refreshStoredClasses(event) {
      if (!event.key || event.key === CLASSES_STORAGE_KEY) loadClasses();
    }
    window.addEventListener("storage", refreshStoredClasses);
    return () => window.removeEventListener("storage", refreshStoredClasses);
  }, [loadClasses]);

  const counts = useMemo(() => {
    if (!users) return null;
    return {
      totalUsers: users.length,
      students: users.filter((user) => user.role === "student").length,
      teachers: users.filter((user) => user.role === "teacher").length,
      admins: users.filter((user) => user.role === "admin").length,
      disabled: users.filter((user) => user.disabled === true).length,
    };
  }, [users]);

  const classCounts = useMemo(() => {
    if (!classes) return null;
    return {
      total: classes.length,
      active: classes.filter(
        (schoolClass) => schoolClass.status.toLowerCase() === "active",
      ).length,
      inactive: classes.filter(
        (schoolClass) => schoolClass.status.toLowerCase() === "inactive",
      ).length,
    };
  }, [classes]);

  const subjectCounts = useMemo(() => {
    if (!subjects) return null;
    return {
      total: subjects.length,
      active: subjects.filter(
        (subject) => (subject.status ?? "active").toLowerCase() === "active",
      ).length,
    };
  }, [subjects]);

  const recentUsers = useMemo(() => {
    if (!users) return [];
    return [...users]
      .sort((first, second) => getCreatedAtValue(second) - getCreatedAtValue(first))
      .slice(0, 5);
  }, [users]);

  const isDashboardLoading =
    usersLoading || subjectsLoading || !classes && !classesError;
  const cards = [
    {
      label: "Total Users",
      value: counts?.totalUsers,
      route: "/admin/users",
      description: "All registered accounts",
    },
    {
      label: "Students",
      value: counts?.students,
      route: "/admin/users",
      description: "Student accounts",
    },
    {
      label: "Teachers",
      value: counts?.teachers,
      route: "/admin/users",
      description: "Teacher accounts",
    },
    {
      label: "Classes",
      value: classCounts?.total,
      route: "/admin/classes",
      description: "School sections",
    },
    {
      label: "Subjects",
      value: subjectCounts?.total,
      route: "/admin/subjects",
      description: "Curriculum subjects",
    },
    {
      label: "Disabled Accounts",
      value: counts?.disabled,
      route: "/admin/users",
      description: "Accounts without access",
    },
  ];

  return (
    <PortalLayout
      role="admin"
      title={`Welcome back, ${adminName}`}
      description="Here's an overview of your AMA LMS."
      navigation={<AdminNavigation activePath="/admin/dashboard" />}
    >
      <div className="admin-dashboard">
        {isDashboardLoading && (
          <p className="admin-dashboard-loading" role="status">
            Loading dashboard information...
          </p>
        )}

        <section className="admin-dashboard-cards" aria-label="System totals">
          {cards.map((card) => (
            <a
              className="dashboard-card admin-dashboard-card"
              href={card.route}
              key={card.label}
            >
              <h3>{card.label}</h3>
              <p>
                {card.value === undefined
                  ? usersLoading && card.route === "/admin/users" ||
                    subjectsLoading && card.label === "Subjects" ||
                    !classes && !classesError && card.label === "Classes"
                    ? "…"
                    : "—"
                  : card.value}
              </p>
              <span>{card.description}</span>
            </a>
          ))}
        </section>

        <div className="admin-dashboard-main-grid">
          <section className="dashboard-section admin-dashboard-section">
            <div className="section-header admin-dashboard-section-header">
              <h3>Recent Users</h3>
              <a href="/admin/users">View all users →</a>
            </div>
            {usersLoading ? (
              <p className="admin-dashboard-state" role="status">
                Loading recent users...
              </p>
            ) : usersError ? (
              <div className="admin-dashboard-state" role="alert">
                <p>{usersError}</p>
                <button
                  type="button"
                  className="admin-dashboard-retry"
                  onClick={() => currentUser && loadUsers(currentUser)}
                >
                  Retry
                </button>
              </div>
            ) : recentUsers.length ? (
              <ul className="admin-recent-users">
                {recentUsers.map((user) => (
                  <li key={user.uid}>
                    <div>
                      <strong>{user.display_name || user.email || "Unnamed user"}</strong>
                      <span>{user.email || "Email unavailable"}</span>
                    </div>
                    <div className="admin-recent-user-meta">
                      <span>{user.role ? user.role[0].toUpperCase() + user.role.slice(1) : "Role unavailable"}</span>
                      <time>{formatDate(user.created_at)}</time>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-dashboard-state">
                No users yet.{" "}
                <a href="/admin/users">Create your first account to get started.</a>
              </p>
            )}
          </section>

          <section className="dashboard-section admin-dashboard-section">
            <div className="section-header admin-dashboard-section-header">
              <h3>Quick Actions</h3>
            </div>
            <nav className="admin-quick-actions" aria-label="Quick actions">
              <a className="admin-quick-action primary" href="/admin/users">
                + Create Account
              </a>
              <a className="admin-quick-action" href="/admin/classes">
                + Add Class
              </a>
              <a className="admin-quick-action" href="/admin/subjects">
                Manage Subjects
              </a>
              <a className="admin-quick-action" href="/admin/users">
                View Users
              </a>
            </nav>
          </section>
        </div>

        <section className="dashboard-section admin-system-overview">
          <div className="section-header admin-dashboard-section-header">
            <h3>System Overview</h3>
          </div>
          <div className="admin-overview-grid">
            <div className="admin-overview-group">
              <h4>Accounts</h4>
              {usersLoading ? (
                <p>Loading account information...</p>
              ) : usersError ? (
                <div>
                  <p>{usersError}</p>
                  <button
                    type="button"
                    className="admin-dashboard-retry"
                    onClick={() => currentUser && loadUsers(currentUser)}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <p>Active accounts: {counts.totalUsers - counts.disabled}</p>
                  <p>Disabled accounts: {counts.disabled}</p>
                  <p>Administrators: {counts.admins}</p>
                </>
              )}
            </div>
            <div className="admin-overview-group">
              <h4>Classes</h4>
              {classesError ? (
                <div>
                  <p>{classesError}</p>
                  <button
                    type="button"
                    className="admin-dashboard-retry"
                    onClick={loadClasses}
                  >
                    Retry
                  </button>
                </div>
              ) : classCounts ? (
                <>
                  <p>Active classes: {classCounts.active}</p>
                  <p>Inactive classes: {classCounts.inactive}</p>
                  {!classCounts.total && (
                    <p>
                      No classes yet.{" "}
                      <a href="/admin/classes">Create a class to get started.</a>
                    </p>
                  )}
                </>
              ) : (
                <p>Loading class information...</p>
              )}
            </div>
            <div className="admin-overview-group">
              <h4>Subjects</h4>
              {subjectsLoading ? (
                <p>Loading subject information...</p>
              ) : subjectsError ? (
                <div>
                  <p>{subjectsError}</p>
                  <button
                    type="button"
                    className="admin-dashboard-retry"
                    onClick={() => currentUser && loadSubjects(currentUser)}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <p>Total subjects: {subjectCounts.total}</p>
                  <p>Active subjects: {subjectCounts.active}</p>
                  {!subjectCounts.total && (
                    <p>
                      No subjects yet.{" "}
                      <a href="/admin/subjects">
                        Add a subject to begin organizing your curriculum.
                      </a>
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </PortalLayout>
  );
}
