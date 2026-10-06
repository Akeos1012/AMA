import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import "../../styles/admin.css";

const SUBJECTS_ENDPOINT = "/api/admin/subjects";
const TEACHERS_ENDPOINT = "/api/admin/users";
const gradeLevels = [
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
];
const emptyForm = {
  name: "",
  code: "",
  description: "",
  grade_levels: [],
  status: "active",
  teacher_ids: [],
};

async function readApiResponse(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    // Use the HTTP status message when the response has no JSON body.
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

export default function Subjects() {
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState("");
  const [pageMessage, setPageMessage] = useState("");

  const loadData = useCallback(async (user) => {
    setIsLoading(true);
    setLoadError("");

    try {
      const [subjectsResponse, teachersResponse] = await Promise.all([
        authenticatedFetch(user, SUBJECTS_ENDPOINT),
        authenticatedFetch(user, TEACHERS_ENDPOINT),
      ]);
      const [subjectData, userData] = await Promise.all([
        readApiResponse(subjectsResponse),
        readApiResponse(teachersResponse),
      ]);

      if (!Array.isArray(subjectData) || !Array.isArray(userData)) {
        throw new Error("The server returned unexpected subject or user data.");
      }

      setSubjects(subjectData);
      setTeachers(
        userData
          .filter((userRecord) => userRecord.role === "teacher")
          .map((teacher) => ({
            id: teacher.uid,
            name: teacher.display_name || teacher.email || "Unnamed teacher",
            active: !teacher.disabled,
          }))
          .sort((first, second) => first.name.localeCompare(second.name)),
      );
    } catch (error) {
      console.error("Could not load admin subjects:", error);
      setLoadError(error.message || "Unable to load subjects and teachers.");
    } finally {
      setIsLoading(false);
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
            await loadData(user);
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
  }, [loadData]);

  const filteredSubjects = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return subjects.filter((subject) => {
      const assignedTeachers = (subject.teacher_ids ?? [])
        .map((teacherId) => teachers.find((teacher) => teacher.id === teacherId)?.name ?? "")
        .join(" ")
        .toLowerCase();
      const matchesSearch =
        (subject.name ?? "").toLowerCase().includes(normalizedSearch) ||
        (subject.code ?? "").toLowerCase().includes(normalizedSearch) ||
        assignedTeachers.includes(normalizedSearch);
      const matchesGrade =
        !gradeFilter || (subject.grade_levels ?? []).includes(gradeFilter);
      const matchesStatus = !statusFilter || subject.status === statusFilter;
      return matchesSearch && matchesGrade && matchesStatus;
    });
  }, [gradeFilter, searchTerm, subjects, statusFilter, teachers]);

  const selectedSubject =
    subjects.find((subject) => subject.id === selectedSubjectId) ??
    filteredSubjects[0] ??
    null;
  const selectableTeachers = [
    ...teachers.filter(
      (teacher) => teacher.active || form.teacher_ids.includes(teacher.id),
    ),
    ...form.teacher_ids
      .filter((teacherId) => !teachers.some((teacher) => teacher.id === teacherId))
      .map((teacherId) => ({
        id: teacherId,
        name: "Unlisted teacher",
        active: false,
      })),
  ];

  function openCreateDialog() {
    setEditingSubjectId(null);
    setForm(emptyForm);
    setFormError("");
    setPageMessage("");
    setIsModalOpen(true);
  }

  function openEditDialog(subject) {
    setEditingSubjectId(subject.id);
    setForm({
      name: subject.name ?? "",
      code: subject.code ?? "",
      description: subject.description ?? "",
      grade_levels: subject.grade_levels ?? [],
      status: subject.status ?? "active",
      teacher_ids: subject.teacher_ids ?? [],
    });
    setFormError("");
    setPageMessage("");
    setIsModalOpen(true);
  }

  function closeDialog() {
    setIsModalOpen(false);
    setFormError("");
  }

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
  }

  function toggleFormSelection(field, value) {
    setForm((currentForm) => {
      const currentValues = currentForm[field];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((currentValue) => currentValue !== value)
        : [...currentValues, value];
      return { ...currentForm, [field]: nextValues };
    });
  }

  async function handleSaveSubject(event) {
    event.preventDefault();
    setFormError("");

    if (form.grade_levels.length === 0) {
      setFormError("Select at least one applicable grade level.");
      return;
    }
    setIsSaving(true);
    const user = auth.currentUser;
    if (!user) {
      setFormError("Your session has expired. Sign in again and retry.");
      setIsSaving(false);
      return;
    }

    const subjectFields = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      grade_levels: form.grade_levels,
      status: form.status,
    };

    try {
      let savedSubject;
      if (editingSubjectId) {
        const originalSubject = subjects.find(
          (subject) => subject.id === editingSubjectId,
        );
        const previousTeacherIds = originalSubject?.teacher_ids ?? [];
        const addTeacherIds = form.teacher_ids.filter(
          (teacherId) => !previousTeacherIds.includes(teacherId),
        );
        const removeTeacherIds = previousTeacherIds.filter(
          (teacherId) => !form.teacher_ids.includes(teacherId),
        );
        const response = await authenticatedFetch(
          user,
          `${SUBJECTS_ENDPOINT}/${editingSubjectId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...subjectFields,
              add_teacher_ids: addTeacherIds,
              remove_teacher_ids: removeTeacherIds,
            }),
          },
        );
        savedSubject = await readApiResponse(response);
      } else {
        const response = await authenticatedFetch(user, SUBJECTS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...subjectFields,
            teacher_ids: form.teacher_ids,
          }),
        });
        savedSubject = await readApiResponse(response);
      }

      await loadData(user);
      setSelectedSubjectId(savedSubject.id);
      setPageMessage(editingSubjectId ? "Subject updated." : "Subject added.");
      closeDialog();
    } catch (error) {
      console.error("Could not save subject:", error);
      setFormError(error.message || "Unable to save the subject.");
    } finally {
      setIsSaving(false);
    }
  }

  async function changeSubjectStatus(subject) {
    const user = auth.currentUser;
    if (!user) {
      setPageMessage("Your session has expired. Sign in again and retry.");
      return;
    }

    const nextStatus = subject.status === "active" ? "inactive" : "active";
    setIsChangingStatus(subject.id);
    setPageMessage("");
    try {
      const response = await authenticatedFetch(
        user,
        `${SUBJECTS_ENDPOINT}/${subject.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      await readApiResponse(response);
      await loadData(user);
      setPageMessage(
        `${subject.name} is now ${nextStatus}. It remains in the subject list.`,
      );
    } catch (error) {
      console.error("Could not change subject status:", error);
      setPageMessage(error.message || "Unable to change the subject status.");
    } finally {
      setIsChangingStatus("");
    }
  }

  function getTeacherName(teacherId) {
    return teachers.find((teacher) => teacher.id === teacherId)?.name ?? "Unlisted teacher";
  }

  return (
    <PortalLayout
      role="admin"
      title="Subjects"
      description="Manage school subjects, grade levels, and teacher assignments."
      navigation={<AdminNavigation activePath="/admin/subjects" />}
      headerAction={
        <button
          type="button"
          className="primary-button"
          onClick={openCreateDialog}
        >
          + Add Subject
        </button>
      }
    >
      {loadError && (
        <p className="form-message error subjects-page-message" role="alert">
          {loadError}
        </p>
      )}
      {pageMessage && (
        <p className="form-message success subjects-page-message" role="status">
          {pageMessage}
        </p>
      )}

      <div className="subjects-toolbar">
        <label className="subjects-search">
          <span>Search</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Subject name, code, or teacher"
          />
        </label>
        <label>
          <span>Grade Level</span>
          <select
            value={gradeFilter}
            onChange={(event) => setGradeFilter(event.target.value)}
          >
            <option value="">All Grades</option>
            {gradeLevels.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      <div className="subjects-workspace">
        <section className="subjects-panel" aria-labelledby="subjects-list-heading">
          <div className="section-header subjects-panel-header">
            <h3 id="subjects-list-heading">Subject List</h3>
            <span>{filteredSubjects.length} subjects</span>
          </div>
          {isLoading ? (
            <div className="empty-state subjects-empty-state">
              <p>Loading subjects...</p>
            </div>
          ) : filteredSubjects.length === 0 ? (
            <div className="empty-state subjects-empty-state">
              <p>{subjects.length ? "No subjects match these filters." : "No subjects yet. Add a subject to get started."}</p>
            </div>
          ) : (
            <div className="subjects-table-wrap">
              <table className="subjects-table">
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Grade Levels</th>
                    <th scope="col">Assigned Teachers</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubjects.map((subject) => (
                    <tr
                      key={subject.id}
                      className={
                        selectedSubject?.id === subject.id ? "selected" : ""
                      }
                    >
                      <td>
                        <strong>{subject.name}</strong>
                        <span className="subject-code">Code: {subject.code}</span>
                      </td>
                      <td>{(subject.grade_levels ?? []).join(", ")}</td>
                      <td>
                        <button
                          type="button"
                          className="subject-teacher-count"
                          onClick={() => setSelectedSubjectId(subject.id)}
                          aria-label={`View ${subject.teacher_ids?.length ?? 0} teachers assigned to ${subject.name}`}
                        >
                          {subject.teacher_ids?.length ?? 0}{" "}
                          {(subject.teacher_ids?.length ?? 0) === 1
                            ? "teacher"
                            : "teachers"}
                        </button>
                      </td>
                      <td>
                        <span className={`subject-status ${subject.status}`}>
                          {subject.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="subject-row-actions">
                          <button
                            type="button"
                            className="subject-action-button"
                            onClick={() => setSelectedSubjectId(subject.id)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="subject-action-button"
                            onClick={() => openEditDialog(subject)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="subject-action-button"
                            onClick={() => changeSubjectStatus(subject)}
                            disabled={isChangingStatus === subject.id}
                          >
                            {isChangingStatus === subject.id
                              ? "Saving..."
                              : subject.status === "active"
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          className="subjects-panel subject-details"
          aria-labelledby="subject-details-heading"
        >
          <div className="section-header subjects-panel-header">
            <h3 id="subject-details-heading">Subject Details</h3>
          </div>
          {selectedSubject ? (
            <div className="subject-details-content">
              <dl className="subject-summary">
                <div>
                  <dt>Name</dt>
                  <dd>{selectedSubject.name}</dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd>{selectedSubject.code}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>{selectedSubject.description || "No description provided."}</dd>
                </div>
                <div>
                  <dt>Grade Levels</dt>
                  <dd>{(selectedSubject.grade_levels ?? []).join(", ")}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`subject-status ${selectedSubject.status}`}>
                      {selectedSubject.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </dd>
                </div>
              </dl>
              <div className="subject-teachers-heading">
                <h4>Assigned Teachers</h4>
                <span>{selectedSubject.teacher_ids?.length ?? 0}</span>
              </div>
              {selectedSubject.teacher_ids?.length ? (
                <ul className="subject-teacher-list">
                  {selectedSubject.teacher_ids.map((teacherId) => (
                    <li key={teacherId}>{getTeacherName(teacherId)}</li>
                  ))}
                </ul>
              ) : (
                <p className="subject-teachers-empty">
                  No teachers are assigned to this subject.
                </p>
              )}
              {selectedSubject.status === "inactive" && (
                <p className="subject-inactive-note">
                  Inactive subjects are retained, but should not be used to
                  create new teaching content.
                </p>
              )}
            </div>
          ) : (
            <div className="empty-state subjects-empty-state">
              <p>Select a subject to see its details.</p>
            </div>
          )}
        </section>
      </div>

      <div
        className={`modal-overlay${isModalOpen ? " active" : ""}`}
        aria-hidden={!isModalOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subject-dialog-heading"
        >
          <div className="modal-header">
            <div>
              <h3 id="subject-dialog-heading">
                {editingSubjectId ? "Edit Subject" : "Add Subject"}
              </h3>
              <p>Subject assignments use existing teacher accounts.</p>
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={closeDialog}
            >
              &times;
            </button>
          </div>

          <form className="subject-form" onSubmit={handleSaveSubject}>
            {formError && (
              <div className="form-message error" role="alert">
                {formError}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="subject-name">Subject Name</label>
              <input
                id="subject-name"
                name="name"
                value={form.name}
                onChange={updateForm}
                maxLength={100}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="subject-code">Subject Code</label>
              <input
                id="subject-code"
                name="code"
                value={form.code}
                onChange={updateForm}
                maxLength={30}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="subject-description">Description</label>
              <textarea
                id="subject-description"
                name="description"
                value={form.description}
                onChange={updateForm}
                rows="3"
              />
            </div>
            <fieldset className="subject-checkbox-group">
              <legend>Applicable Grade Levels</legend>
              <div className="subject-checkbox-grid">
                {gradeLevels.map((grade) => (
                  <label key={grade}>
                    <input
                      type="checkbox"
                      checked={form.grade_levels.includes(grade)}
                      onChange={() => toggleFormSelection("grade_levels", grade)}
                    />
                    {grade}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-group">
              <label htmlFor="subject-status">Status</label>
              <select
                id="subject-status"
                name="status"
                value={form.status}
                onChange={updateForm}
                required
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <fieldset className="subject-checkbox-group subject-teacher-options">
              <legend>Assigned Teachers</legend>
              {selectableTeachers.length ? (
                <div className="subject-teacher-checkboxes">
                  {selectableTeachers.map((teacher) => {
                    const isAssigned = form.teacher_ids.includes(teacher.id);
                    return (
                      <label key={teacher.id}>
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          disabled={!teacher.active && !isAssigned}
                          onChange={() =>
                            toggleFormSelection("teacher_ids", teacher.id)
                          }
                        />
                        {teacher.name}
                        {!teacher.active ? " (inactive account)" : ""}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p>No teacher accounts are available for this subject.</p>
              )}
            </fieldset>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeDialog}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={isSaving}
              >
                {isSaving
                  ? "Saving..."
                  : editingSubjectId
                    ? "Save Changes"
                    : "Add Subject"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </PortalLayout>
  );
}
