import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import "./Teachers.css";

const USERS_ENDPOINT = "/api/admin/users";
const CLASSES_ENDPOINT = "/api/admin/classes";
const SUBJECTS_ENDPOINT = "/api/admin/subjects";
const ASSIGNMENTS_ENDPOINT = "/api/admin/teacher-assignments";
const GRADE_LEVELS = [
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
];

async function readApiResponse(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    // Use the HTTP status when the server does not return JSON.
  }
  if (!response.ok) {
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `The request failed (${response.status}).`,
    );
  }
  return body;
}

function accountStatus(teacher) {
  if (teacher.disabled) return "Disabled";
  if (teacher.profile_status !== "active") {
    return teacher.profile_status ? "Profile inactive" : "Profile missing";
  }
  return "Active";
}

function isTeacherActive(teacher) {
  return Boolean(
    teacher &&
      !teacher.disabled &&
      teacher.profile_status === "active" &&
      teacher.role === "teacher",
  );
}

function assignmentIssue(assignment, teachersByUid, classesById, subjectsById) {
  const teacher = teachersByUid.get(assignment.teacher_uid);
  const schoolClass = classesById.get(assignment.class_id);
  const subject = subjectsById.get(assignment.subject_id);
  if (assignment.status !== "active") return "Assignment inactive";
  if (!isTeacherActive(teacher)) return "Teacher account inactive";
  if (!schoolClass || schoolClass.status !== "active") return "Section inactive";
  if (!subject || subject.status !== "active") return "Subject inactive";
  if (
    !Array.isArray(subject.grade_levels) ||
    !subject.grade_levels.includes(schoolClass.grade_level)
  ) {
    return "Subject not offered for this grade";
  }
  if (
    !Array.isArray(subject.teacher_ids) ||
    !subject.teacher_ids.includes(assignment.teacher_uid)
  ) {
    return "Teacher is no longer eligible";
  }
  return "";
}

function assignmentKey(assignment) {
  return JSON.stringify([
    assignment.class_id,
    assignment.subject_id,
    assignment.teacher_uid,
  ]);
}

export default function Teachers() {
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTeacherUid, setSelectedTeacherUid] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);
  const [assignmentTeacherUid, setAssignmentTeacherUid] = useState("");
  const [assignmentGrade, setAssignmentGrade] = useState("");
  const [assignmentClassId, setAssignmentClassId] = useState("");
  const [assignmentSubjectId, setAssignmentSubjectId] = useState("");
  const [reassigningAssignment, setReassigningAssignment] = useState(null);
  const [assignmentError, setAssignmentError] = useState("");
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [changingAssignmentId, setChangingAssignmentId] = useState("");

  const loadData = useCallback(async (user) => {
    setLoading(true);
    setLoadError("");
    try {
      const responses = await Promise.all([
        authenticatedFetch(user, USERS_ENDPOINT),
        authenticatedFetch(user, CLASSES_ENDPOINT),
        authenticatedFetch(user, SUBJECTS_ENDPOINT),
        authenticatedFetch(user, ASSIGNMENTS_ENDPOINT),
      ]);
      const [userData, classData, subjectData, assignmentData] =
        await Promise.all(responses.map(readApiResponse));
      if (
        !Array.isArray(userData) ||
        !Array.isArray(classData) ||
        !Array.isArray(subjectData) ||
        !Array.isArray(assignmentData)
      ) {
        throw new Error("The server returned unexpected teacher assignment data.");
      }

      const teacherData = userData.filter(
        (userRecord) => userRecord.role === "teacher",
      );
      setTeachers(teacherData);
      setClasses(classData);
      setSubjects(subjectData);
      setAssignments(assignmentData);
      setSelectedTeacherUid((currentUid) =>
        teacherData.some((teacher) => teacher.uid === currentUid)
          ? currentUid
          : teacherData[0]?.uid ?? "",
      );
    } catch (error) {
      console.error("Could not load teacher directory:", error);
      setLoadError(error.message || "Unable to load teacher assignment data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
          await loadData(user);
        } catch (error) {
          console.error("Admin authentication check failed:", error);
          setLoadError("Your administrator account could not be verified.");
          setLoading(false);
        }
      },
      (error) => {
        console.error("Admin authentication check failed:", error);
        setLoadError("Your administrator account could not be verified.");
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [loadData]);

  const teachersByUid = useMemo(
    () => new Map(teachers.map((teacher) => [teacher.uid, teacher])),
    [teachers],
  );
  const classesById = useMemo(
    () => new Map(classes.map((schoolClass) => [schoolClass.id, schoolClass])),
    [classes],
  );
  const subjectsById = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject])),
    [subjects],
  );

  const directory = useMemo(
    () =>
      teachers.map((teacher) => {
        const validAssignments = assignments.filter(
          (assignment) =>
            assignment.teacher_uid === teacher.uid &&
            !assignmentIssue(assignment, teachersByUid, classesById, subjectsById),
        );
        const advisoryClasses = classes.filter(
          (schoolClass) => schoolClass.lead_teacher_uid === teacher.uid,
        );
        const sectionIds = new Set(
          advisoryClasses
            .filter((schoolClass) => schoolClass.status === "active")
            .map((schoolClass) => schoolClass.id),
        );
        validAssignments.forEach((assignment) =>
          sectionIds.add(assignment.class_id),
        );
        const distinctAssignments = new Set(validAssignments.map(assignmentKey));
        return {
          ...teacher,
          status: accountStatus(teacher),
          advisoryClasses,
          sectionCount: sectionIds.size,
          assignmentCount: distinctAssignments.size,
        };
      }),
    [assignments, classes, subjectsById, teachers, teachersByUid, classesById],
  );

  const filteredTeachers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return directory.filter((teacher) => {
      const searchableText = [
        teacher.display_name,
        teacher.email,
        teacher.employee_id,
        ...teacher.advisoryClasses.map((schoolClass) => schoolClass.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = searchableText.includes(normalizedSearch);
      const matchesStatus = !statusFilter || teacher.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [directory, search, statusFilter]);

  const selectedTeacher =
    directory.find((teacher) => teacher.uid === selectedTeacherUid) ?? null;
  const selectedAssignments = selectedTeacher
    ? assignments
        .filter((assignment) => assignment.teacher_uid === selectedTeacher.uid)
        .map((assignment) => ({
          ...assignment,
          issue: assignmentIssue(
            assignment,
            teachersByUid,
            classesById,
            subjectsById,
          ),
          schoolClass: classesById.get(assignment.class_id),
          subject: subjectsById.get(assignment.subject_id),
        }))
        .sort((first, second) =>
          `${first.schoolClass?.grade_level ?? ""}${first.schoolClass?.section ?? ""}${first.subject?.name ?? ""}`.localeCompare(
            `${second.schoolClass?.grade_level ?? ""}${second.schoolClass?.section ?? ""}${second.subject?.name ?? ""}`,
          ),
        )
    : [];
  const advisoryClasses = selectedTeacher?.advisoryClasses ?? [];
  const eligibleTeachers = teachers.filter(isTeacherActive);
  const activeSectionClasses = classes.filter(
    (schoolClass) =>
      schoolClass.status === "active" &&
      (!assignmentGrade || schoolClass.grade_level === assignmentGrade),
  );
  const gradeSubjects = subjects.filter(
    (subject) =>
      subject.status === "active" &&
      Array.isArray(subject.grade_levels) &&
      (!assignmentGrade || subject.grade_levels.includes(assignmentGrade)),
  );
  const assignmentTeacher = teachersByUid.get(assignmentTeacherUid);
  const assignmentSubject = subjectsById.get(assignmentSubjectId);
  const teacherEligibleForSubject = Boolean(
    assignmentTeacher &&
      Array.isArray(assignmentSubject?.teacher_ids) &&
      assignmentSubject.teacher_ids.includes(assignmentTeacher.uid),
  );
  const activeDuplicate = assignments.some(
    (assignment) =>
      assignment.status === "active" &&
      assignment.class_id === assignmentClassId &&
      assignment.subject_id === assignmentSubjectId &&
      assignment.teacher_uid === assignmentTeacherUid &&
      assignment.id !== reassigningAssignment?.id,
  );

  function openAssignmentDialog(assignment = null) {
    setReassigningAssignment(assignment);
    setAssignmentTeacherUid("");
    setAssignmentGrade(assignment?.schoolClass?.grade_level ?? "");
    setAssignmentClassId(assignment?.class_id ?? "");
    setAssignmentSubjectId(assignment?.subject_id ?? "");
    setAssignmentError("");
    setIsAssignmentDialogOpen(true);
  }

  function closeAssignmentDialog() {
    if (isSavingAssignment) return;
    setIsAssignmentDialogOpen(false);
    setAssignmentError("");
    setReassigningAssignment(null);
  }

  async function saveAssignment(event) {
    event.preventDefault();
    setAssignmentError("");
    const teacher = teachersByUid.get(assignmentTeacherUid);
    const schoolClass = classesById.get(assignmentClassId);
    const subject = subjectsById.get(assignmentSubjectId);
    if (!isTeacherActive(teacher)) {
      setAssignmentError("Select an active teacher account with an active profile.");
      return;
    }
    if (
      !schoolClass ||
      schoolClass.status !== "active" ||
      schoolClass.grade_level !== assignmentGrade
    ) {
      setAssignmentError("Select an active section in the selected grade level.");
      return;
    }
    if (
      !subject ||
      subject.status !== "active" ||
      !Array.isArray(subject.grade_levels) ||
      !subject.grade_levels.includes(assignmentGrade)
    ) {
      setAssignmentError("Select an active subject offered at this grade level.");
      return;
    }
    if (!teacherEligibleForSubject) {
      setAssignmentError(
        "This teacher is not eligible for the selected subject. Update teacher eligibility in Subjects before assigning a section.",
      );
      return;
    }
    if (activeDuplicate) {
      setAssignmentError(
        "This teacher already has an active assignment for this subject and section.",
      );
      return;
    }
    if (
      reassigningAssignment &&
      reassigningAssignment.teacher_uid === teacher.uid
    ) {
      setAssignmentError("Choose a different teacher to reassign this assignment.");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setAssignmentError("Your session expired. Sign in again and retry.");
      return;
    }
    setIsSavingAssignment(true);
    const endpoint = `${CLASSES_ENDPOINT}/${encodeURIComponent(schoolClass.id)}/teacher-assignments`;
    let oldAssignmentDeactivated = false;
    try {
      if (reassigningAssignment) {
        const oldClassEndpoint = `${CLASSES_ENDPOINT}/${encodeURIComponent(reassigningAssignment.class_id)}/teacher-assignments`;
        await readApiResponse(
          await authenticatedFetch(
            user,
            `${oldClassEndpoint}/${encodeURIComponent(reassigningAssignment.id)}`,
            { method: "DELETE" },
          ),
        );
        oldAssignmentDeactivated = true;
      }

      await readApiResponse(
        await authenticatedFetch(user, endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: schoolClass.id,
            subject_id: subject.id,
            teacher_uid: teacher.uid,
            status: "active",
          }),
        }),
      );
    } catch (error) {
      if (oldAssignmentDeactivated) {
        try {
          const oldEndpoint = `${CLASSES_ENDPOINT}/${encodeURIComponent(reassigningAssignment.class_id)}/teacher-assignments`;
          await readApiResponse(
            await authenticatedFetch(user, oldEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                class_id: reassigningAssignment.class_id,
                subject_id: reassigningAssignment.subject_id,
                teacher_uid: reassigningAssignment.teacher_uid,
                status: "active",
              }),
            }),
          );
        } catch (restoreError) {
          console.error("Could not restore the previous assignment:", restoreError);
          setAssignmentError(
            `The new assignment failed (${error.message}), and the previous assignment could not be restored (${restoreError.message}). Reload and check the assignment status.`,
          );
          await loadData(user);
          setIsSavingAssignment(false);
          return;
        }
      }
      console.error("Could not save teacher assignment:", error);
      setAssignmentError(
        oldAssignmentDeactivated
          ? `The new assignment failed. The previous assignment was restored. ${error.message}`
          : error.message || "Unable to save the assignment.",
      );
      await loadData(user);
      setIsSavingAssignment(false);
      return;
    }

    setIsAssignmentDialogOpen(false);
    setReassigningAssignment(null);
    setPageMessage(
      reassigningAssignment
        ? `${teacher.display_name || teacher.email} was reassigned successfully.`
        : `${teacher.display_name || teacher.email} was assigned successfully.`,
    );
    setIsSavingAssignment(false);
    await loadData(user);
  }

  async function changeAssignmentStatus(assignment) {
    const user = auth.currentUser;
    const schoolClass = classesById.get(assignment.class_id);
    if (!user || !schoolClass) {
      setPageError("The assignment's section could not be found.");
      return;
    }
    setChangingAssignmentId(assignment.id);
    setPageError("");
    setPageMessage("");
    try {
      const endpoint = `${CLASSES_ENDPOINT}/${encodeURIComponent(schoolClass.id)}/teacher-assignments`;
      const response =
        assignment.status === "active"
          ? await authenticatedFetch(
              user,
              `${endpoint}/${encodeURIComponent(assignment.id)}`,
              { method: "DELETE" },
            )
          : await authenticatedFetch(user, endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                class_id: assignment.class_id,
                subject_id: assignment.subject_id,
                teacher_uid: assignment.teacher_uid,
                status: "active",
              }),
            });
      await readApiResponse(response);
      setPageMessage(
        assignment.status === "active"
          ? "The assignment was deactivated."
          : "The assignment was reactivated.",
      );
      await loadData(user);
    } catch (error) {
      console.error("Could not change teacher assignment status:", error);
      setPageError(error.message || "Unable to update the assignment.");
    } finally {
      setChangingAssignmentId("");
    }
  }

  return (
    <PortalLayout
      role="admin"
      pageClassName="page-admin-teachers"
      title="Teachers"
      description="Manage teacher profiles and section-specific subject assignments."
      navigation={<AdminNavigation activePath="/admin/teachers" />}
      headerAction={
        <button
          type="button"
          className="primary-button"
          onClick={() => openAssignmentDialog()}
          disabled={!eligibleTeachers.length}
        >
          + Assign Subject
        </button>
      }
    >
      {pageMessage && (
        <p className="form-message success teachers-page-message" role="status">
          {pageMessage}
        </p>
      )}
      {pageError && (
        <p className="form-message error teachers-page-message" role="alert">
          {pageError}
        </p>
      )}
      {loadError && (
        <p className="form-message error teachers-page-message" role="alert">
          {loadError}
        </p>
      )}

      <div className="teachers-toolbar">
        <label>
          <span>Search teachers</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, employee ID, or advisory section"
          />
        </label>
        <label>
          <span>Account status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Disabled">Disabled</option>
            <option value="Profile inactive">Profile inactive</option>
            <option value="Profile missing">Profile missing</option>
          </select>
        </label>
      </div>

      <div className="teachers-workspace">
        <section className="teachers-panel" aria-labelledby="teacher-directory-title">
          <div className="section-header teachers-panel-header">
            <h3 id="teacher-directory-title">Teacher Directory</h3>
            <span>{filteredTeachers.length} teachers</span>
          </div>
          {loading ? (
            <div className="empty-state"><p>Loading teachers...</p></div>
          ) : loadError ? (
            <div className="empty-state"><p>Teacher data is unavailable.</p></div>
          ) : filteredTeachers.length === 0 ? (
            <div className="empty-state"><p>No teachers match these filters.</p></div>
          ) : (
            <div className="teachers-table-wrap">
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Advisory class</th>
                    <th>Sections</th>
                    <th>Subject assignments</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTeachers.map((teacher) => (
                    <tr
                      key={teacher.uid}
                      className={
                        selectedTeacherUid === teacher.uid ? "selected" : ""
                      }
                    >
                      <td>
                        <button
                          type="button"
                          className="teacher-select-button"
                          onClick={() => setSelectedTeacherUid(teacher.uid)}
                        >
                          <strong>{teacher.display_name || "Unnamed teacher"}</strong>
                          <span>{teacher.email || "No email"}</span>
                          <small>Employee ID: {teacher.employee_id || "—"}</small>
                        </button>
                      </td>
                      <td>
                        <span
                          className={`teacher-account-status ${teacher.status.toLowerCase().replaceAll(" ", "-")}`}
                        >
                          {teacher.status}
                        </span>
                      </td>
                      <td>
                        {teacher.advisoryClasses.length
                          ? teacher.advisoryClasses
                              .map((schoolClass) => schoolClass.name)
                              .join(", ")
                          : "—"}
                      </td>
                      <td>{teacher.sectionCount}</td>
                      <td>{teacher.assignmentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="teachers-panel teacher-details" aria-labelledby="teacher-details-title">
          <div className="section-header teachers-panel-header">
            <h3 id="teacher-details-title">Teacher Details</h3>
            {selectedTeacher && (
              <button
                type="button"
                className="primary-button"
                onClick={() => openAssignmentDialog()}
                disabled={!isTeacherActive(selectedTeacher)}
              >
                Assign Subject
              </button>
            )}
          </div>
          {loading ? (
            <div className="empty-state"><p>Loading teacher details...</p></div>
          ) : selectedTeacher ? (
            <div className="teacher-details-content">
              <dl className="teacher-profile">
                <div>
                  <dt>Name</dt>
                  <dd>{selectedTeacher.display_name || "Unnamed teacher"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selectedTeacher.email || "—"}</dd>
                </div>
                <div>
                  <dt>Employee ID</dt>
                  <dd>{selectedTeacher.employee_id || "—"}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{selectedTeacher.status}</dd>
                </div>
              </dl>

              <div className="teacher-detail-heading">
                <h4>Advisory Classes</h4>
                <span>Primary adviser role</span>
              </div>
              {advisoryClasses.length ? (
                <ul className="teacher-advisory-list">
                  {advisoryClasses.map((schoolClass) => (
                    <li key={schoolClass.id}>
                      <strong>{schoolClass.grade_level} - {schoolClass.section}</strong>
                      <span>{schoolClass.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="teacher-details-empty">No advisory classes.</p>
              )}

              <div className="teacher-detail-heading">
                <h4>Subject-Teaching Assignments</h4>
                <span>{selectedAssignments.length} records</span>
              </div>
              {selectedAssignments.length ? (
                <div className="teachers-table-wrap">
                  <table className="teachers-table assignment-table">
                    <thead>
                      <tr>
                        <th>Grade / Section</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAssignments.map((assignment) => {
                        const effective = !assignment.issue;
                        const canReactivate =
                          assignment.status !== "active" &&
                          isTeacherActive(selectedTeacher) &&
                          assignment.schoolClass?.status === "active" &&
                          assignment.subject?.status === "active" &&
                          Array.isArray(assignment.subject?.grade_levels) &&
                          assignment.subject?.grade_levels?.includes(
                            assignment.schoolClass?.grade_level,
                          ) &&
                          Array.isArray(assignment.subject?.teacher_ids) &&
                          assignment.subject?.teacher_ids?.includes(
                            selectedTeacher.uid,
                          );
                        const canReassign =
                          assignment.schoolClass?.status === "active" &&
                          assignment.subject?.status === "active" &&
                          Array.isArray(assignment.subject?.grade_levels) &&
                          assignment.subject.grade_levels.includes(
                            assignment.schoolClass.grade_level,
                          );
                        return (
                          <tr key={assignment.id}>
                            <td>
                              {assignment.schoolClass
                                ? `${assignment.schoolClass.grade_level} - ${assignment.schoolClass.section}`
                                : "Unknown section"}
                            </td>
                            <td>{assignment.subject?.name || "Unknown subject"}</td>
                            <td>
                              <span
                                className={`teacher-assignment-status ${effective ? "effective" : "unavailable"}`}
                                title={assignment.issue || ""}
                              >
                                {effective
                                  ? "Active"
                                  : assignment.status === "active"
                                    ? `Unavailable · ${assignment.issue}`
                                    : "Inactive"}
                              </span>
                            </td>
                            <td>
                              <div className="teacher-assignment-actions">
                                <button
                                  type="button"
                                  className="subject-action-button"
                                  onClick={() => openAssignmentDialog(assignment)}
                                  disabled={!canReassign}
                                >
                                  Reassign
                                </button>
                                <button
                                  type="button"
                                  className="subject-action-button"
                                  onClick={() => changeAssignmentStatus(assignment)}
                                  disabled={
                                    changingAssignmentId === assignment.id ||
                                    (assignment.status !== "active" &&
                                      !canReactivate)
                                  }
                                >
                                  {changingAssignmentId === assignment.id
                                    ? "Saving..."
                                    : assignment.status === "active"
                                      ? "Deactivate"
                                      : "Reactivate"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="teacher-details-empty">
                  No section-specific subject assignments.
                </p>
              )}
              <p className="teacher-eligibility-note">
                Subject eligibility is managed in{" "}
                <a href="/admin/subjects">Subjects</a>. Eligibility alone does
                not assign a teacher to a section.
              </p>
            </div>
          ) : (
            <div className="empty-state"><p>Select a teacher to view details.</p></div>
          )}
        </section>
      </div>

      {isAssignmentDialogOpen && (
        <div
          className="modal-overlay active"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeAssignmentDialog();
          }}
        >
          <section
            className="modal teacher-assignment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-assignment-title"
          >
            <div className="modal-header">
              <div>
                <h3 id="teacher-assignment-title">
                  {reassigningAssignment ? "Reassign Subject" : "Assign Subject"}
                </h3>
                <p>
                  Select a teacher, grade, section, and subject. Adviser
                  assignments remain separate.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close"
                disabled={isSavingAssignment}
                onClick={closeAssignmentDialog}
              >
                &times;
              </button>
            </div>
            <form className="teacher-assignment-form" onSubmit={saveAssignment}>
              {assignmentError && (
                <p className="form-message error" role="alert">
                  {assignmentError}
                </p>
              )}
              <label>
                <span>Teacher</span>
                <select
                  value={assignmentTeacherUid}
                  onChange={(event) => {
                    setAssignmentTeacherUid(event.target.value);
                    setAssignmentError("");
                  }}
                  required
                >
                  <option value="">Select an active teacher</option>
                  {eligibleTeachers.map((teacher) => (
                    <option key={teacher.uid} value={teacher.uid}>
                      {teacher.display_name || teacher.email} · {teacher.employee_id || "No employee ID"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Grade Level</span>
                <select
                  value={assignmentGrade}
                  onChange={(event) => {
                    setAssignmentGrade(event.target.value);
                    setAssignmentClassId("");
                    setAssignmentSubjectId("");
                    setAssignmentError("");
                  }}
                  required
                >
                  <option value="">Select a grade</option>
                  {GRADE_LEVELS.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Class Section</span>
                <select
                  value={assignmentClassId}
                  onChange={(event) => {
                    setAssignmentClassId(event.target.value);
                    setAssignmentError("");
                  }}
                  disabled={!assignmentGrade}
                  required
                >
                  <option value="">Select an active section</option>
                  {activeSectionClasses.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.id}>
                      {schoolClass.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Subject</span>
                <select
                  value={assignmentSubjectId}
                  onChange={(event) => {
                    setAssignmentSubjectId(event.target.value);
                    setAssignmentError("");
                  }}
                  disabled={!assignmentGrade}
                  required
                >
                  <option value="">Select an active subject</option>
                  {gradeSubjects.map((subject) => {
                    const eligible = Boolean(
                      assignmentTeacherUid &&
                        subject.teacher_ids?.includes(assignmentTeacherUid),
                    );
                    return (
                      <option key={subject.id} value={subject.id}>
                        {subject.name} ({subject.code})
                        {assignmentTeacherUid && !eligible
                          ? " · teacher not eligible"
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              {assignmentSubjectId && !teacherEligibleForSubject && (
                <p className="form-message error" role="status">
                  This teacher is not eligible for this subject. Update the
                  teacher&apos;s eligibility in Subjects, then retry.
                </p>
              )}
              {activeDuplicate && (
                <p className="form-message error" role="alert">
                  This exact active assignment already exists.
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeAssignmentDialog}
                  disabled={isSavingAssignment}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    isSavingAssignment ||
                    !teacherEligibleForSubject ||
                    activeDuplicate
                  }
                >
                  {isSavingAssignment
                    ? "Saving..."
                    : reassigningAssignment
                      ? "Confirm Reassignment"
                      : "Save Assignment"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </PortalLayout>
  );
}
