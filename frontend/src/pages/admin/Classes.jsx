import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import { classGrades, mockClasses } from "./classesMockData.js";
import "../../styles/admin.css";

const USERS_ENDPOINT = "/api/admin/users";
const SUBJECTS_ENDPOINT = "/api/admin/subjects";
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const CLASSES_STORAGE_KEY = "ama-lms-admin-classes";
const SELECTED_CLASS_STORAGE_KEY = "ama-lms-admin-selected-class";
const CLASSES_PER_PAGE = 10;

const emptyClassForm = {
  gradeLevel: "",
  section: "",
  teacherId: "",
  status: "Active",
};

const emptyScheduleForm = {
  day: "Monday",
  startTime: "",
  endTime: "",
  subjectId: "",
  teacherId: "",
};

function parseCsv(content) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' && inQuotes && content[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (inQuotes) {
    throw new Error("The CSV contains an unclosed quoted field.");
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function loadStoredClasses() {
  try {
    const storedClasses = window.localStorage.getItem(CLASSES_STORAGE_KEY);
    if (!storedClasses) return mockClasses;

    const parsedClasses = JSON.parse(storedClasses);
    if (
      !Array.isArray(parsedClasses) ||
      parsedClasses.some(
        (schoolClass) =>
          !schoolClass ||
          typeof schoolClass.id !== "string" ||
          typeof schoolClass.gradeLevel !== "string" ||
          typeof schoolClass.section !== "string" ||
          typeof schoolClass.teacherId !== "string" ||
          !Array.isArray(schoolClass.students),
      )
    ) {
      throw new Error("Saved class data has an invalid format.");
    }
    return parsedClasses;
  } catch (error) {
    console.error("Could not load saved class data:", error);
    return mockClasses;
  }
}

function loadSelectedClassId() {
  try {
    return (
      window.localStorage.getItem(SELECTED_CLASS_STORAGE_KEY) ??
      loadStoredClasses()[0]?.id ??
      ""
    );
  } catch (error) {
    console.error("Could not load the saved class selection:", error);
    return loadStoredClasses()[0]?.id ?? "";
  }
}

export default function Classes() {
  const [classes, setClasses] = useState(loadStoredClasses);
  const [teachers, setTeachers] = useState([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [subjectsError, setSubjectsError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedClassId, setSelectedClassId] = useState(loadSelectedClassId);
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClassId, setEditingClassId] = useState(null);
  const [form, setForm] = useState(emptyClassForm);
  const [formError, setFormError] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [studentsClassId, setStudentsClassId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvErrors, setCsvErrors] = useState([]);
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [deletingClass, setDeletingClass] = useState(null);

  const loadSubjects = useCallback(async (user) => {
    setSubjectsLoading(true);
    setSubjectsError("");

    try {
      const response = await authenticatedFetch(user, SUBJECTS_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Subject request failed (${response.status}).`);
      }
      const subjectData = await response.json();
      if (!Array.isArray(subjectData)) {
        throw new Error("The subject response was not a list.");
      }
      setSubjects(subjectData);
    } catch (error) {
      console.error("Could not load class subjects:", error);
      setSubjectsError("Unable to load subjects. Schedule management is unavailable.");
    } finally {
      setSubjectsLoading(false);
    }
  }, []);

  const loadTeachers = useCallback(async (user) => {
    setTeachersLoading(true);
    setTeachersError("");

    try {
      const response = await authenticatedFetch(user, USERS_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Teacher account request failed (${response.status}).`);
      }

      const users = await response.json();
      if (!Array.isArray(users)) {
        throw new Error("The teacher account response was not a list.");
      }

      setTeachers(
        users
          .filter((account) => account.role === "teacher")
          .map((account) => ({
            uid: account.uid,
            display_name:
              account.display_name || account.name || account.email || "",
            disabled: Boolean(account.disabled),
          }))
          .filter((teacher) => teacher.uid),
      );
    } catch (error) {
      console.error("Could not load class teacher accounts:", error);
      setTeachersError(
        "Unable to load teacher accounts. Please try again.",
      );
    } finally {
      setTeachersLoading(false);
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
          await Promise.all([loadTeachers(user), loadSubjects(user)]);
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

    return unsubscribe;
  }, [loadSubjects, loadTeachers]);

  const filteredClasses = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return classes.filter((schoolClass) => {
      const teacherName = getTeacherName(schoolClass.teacherId);
      const matchesSearch =
        schoolClass.section.toLowerCase().includes(normalizedSearch) ||
        teacherName.toLowerCase().includes(normalizedSearch);
      const matchesGrade =
        !gradeFilter || schoolClass.gradeLevel === gradeFilter;
      const matchesStatus =
        !statusFilter || schoolClass.status === statusFilter;

      return matchesSearch && matchesGrade && matchesStatus;
    });
  }, [classes, gradeFilter, searchTerm, statusFilter, teachers, teachersLoading]);
  const pageCount = Math.max(
    1,
    Math.ceil(filteredClasses.length / CLASSES_PER_PAGE),
  );
  const pageStart = (currentPage - 1) * CLASSES_PER_PAGE;
  const visibleClasses = filteredClasses.slice(
    pageStart,
    pageStart + CLASSES_PER_PAGE,
  );
  const firstVisibleClass = filteredClasses.length ? pageStart + 1 : 0;
  const lastVisibleClass = Math.min(
    pageStart + CLASSES_PER_PAGE,
    filteredClasses.length,
  );

  const selectedClass =
    classes.find((schoolClass) => schoolClass.id === selectedClassId) ?? null;
  const studentsClass =
    classes.find((schoolClass) => schoolClass.id === studentsClassId) ?? null;
  const visibleStudents = (studentsClass?.students ?? []).filter((student) => {
    const normalizedSearch = studentSearch.trim().toLowerCase();
    return (
      student.id.toLowerCase().includes(normalizedSearch) ||
      student.name.toLowerCase().includes(normalizedSearch)
    );
  });

  function getTeacherName(teacherId) {
    if (!teacherId) return "Unassigned";
    const teacher = teachers.find((account) => account.uid === teacherId);
    if (!teacher && teachersLoading) return "Loading teacher...";
    if (!teacher) return "Unassigned";
    return `${teacher.display_name}${teacher.disabled ? " (disabled account)" : ""}`;
  }

  useEffect(() => {
    if (
      selectedClassId &&
      !classes.some((schoolClass) => schoolClass.id === selectedClassId)
    ) {
      setSelectedClassId("");
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, gradeFilter, statusFilter]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CLASSES_STORAGE_KEY, JSON.stringify(classes));
    } catch (error) {
      console.error("Could not save class data locally:", error);
      setPageMessage(
        "Class changes could not be saved in this browser. Please check browser storage.",
      );
    }
  }, [classes]);

  useEffect(() => {
    try {
      if (selectedClassId) {
        window.localStorage.setItem(
          SELECTED_CLASS_STORAGE_KEY,
          selectedClassId,
        );
      } else {
        window.localStorage.removeItem(SELECTED_CLASS_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Could not save the selected class locally:", error);
    }
  }, [selectedClassId]);

  function openCreateDialog() {
    setEditingClassId(null);
    setForm(emptyClassForm);
    setFormError("");
    setPageMessage("");
    setIsModalOpen(true);
  }

  function openEditDialog(schoolClass) {
    setEditingClassId(schoolClass.id);
    setForm({
      gradeLevel: schoolClass.gradeLevel,
      section: schoolClass.section,
      teacherId: schoolClass.teacherId,
      status: schoolClass.status,
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

  function handleSaveClass(event) {
    event.preventDefault();
    setFormError("");

    if (teachersLoading || teachersError) {
      setFormError("Load teacher accounts before saving this class.");
      return;
    }
    const existingClass = classes.find(
      (schoolClass) => schoolClass.id === editingClassId,
    );
    const selectedTeacher = teachers.find(
      (teacher) => teacher.uid === form.teacherId,
    );
    const keepsExistingAssignment =
      Boolean(editingClassId) && existingClass?.teacherId === form.teacherId;
    if (
      (!selectedTeacher && !keepsExistingAssignment) ||
      (selectedTeacher?.disabled && !keepsExistingAssignment)
    ) {
      setFormError("Select an active teacher account for this class.");
      return;
    }

    const section = form.section.trim();
    const duplicateClass = classes.some(
      (schoolClass) =>
        schoolClass.id !== editingClassId &&
        schoolClass.gradeLevel === form.gradeLevel &&
        schoolClass.section.toLowerCase() === section.toLowerCase(),
    );

    if (duplicateClass) {
      setFormError("That section already exists for the selected grade.");
      return;
    }

    const updatedClass = {
      id: editingClassId ?? `class-${Date.now()}`,
      gradeLevel: form.gradeLevel,
      section,
      teacherId: selectedTeacher?.uid ?? existingClass?.teacherId ?? "",
      status: form.status,
      students: existingClass?.students ?? [],
    };

    if (editingClassId) {
      setClasses((currentClasses) =>
        currentClasses.map((schoolClass) =>
          schoolClass.id === editingClassId ? updatedClass : schoolClass,
        ),
      );
      setPageMessage("Class updated.");
    } else {
      setClasses((currentClasses) => [...currentClasses, updatedClass]);
      setPageMessage("Class created.");
    }

    setSelectedClassId(updatedClass.id);
    closeDialog();
  }

  function openStudents(schoolClass) {
    setStudentsClassId(schoolClass.id);
    setStudentSearch("");
    setCsvPreview(null);
    setCsvErrors([]);
  }

  async function handleCsvFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !studentsClass) return;

    setCsvPreview(null);
    setCsvErrors([]);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) {
        throw new Error("CSV must include a header row and at least one student.");
      }
      const headers = rows[0].map((header) => header.trim().toLowerCase());
      const requiredHeaders = ["student_id", "name", "email", "sex"];
      const missingHeaders = requiredHeaders.filter(
        (header) => !headers.includes(header),
      );
      if (missingHeaders.length) {
        throw new Error(
          `Missing required columns: ${missingHeaders.join(", ")}.`,
        );
      }

      const existingIds = new Set(
        studentsClass.students.map((student) => student.id.trim().toLowerCase()),
      );
      const importedIds = new Set();
      const validationErrors = [];
      const previewStudents = [];
      rows.slice(1).forEach((row, index) => {
        const rowNumber = index + 2;
        const student = Object.fromEntries(
          requiredHeaders.map((header) => [
            header,
            row[headers.indexOf(header)]?.trim() ?? "",
          ]),
        );
        const rowErrors = [];

        if (row.length !== headers.length) {
          rowErrors.push("column count does not match the header");
        }
        requiredHeaders.forEach((header) => {
          if (!student[header]) rowErrors.push(`${header} is required`);
        });
        const normalizedId = student.student_id.toLowerCase();
        if (student.student_id && existingIds.has(normalizedId)) {
          rowErrors.push("Student ID is already assigned to this section");
        }
        if (student.student_id && importedIds.has(normalizedId)) {
          rowErrors.push("Student ID is duplicated in this CSV");
        }
        if (student.student_id) importedIds.add(normalizedId);
        if (
          student.email &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email)
        ) {
          rowErrors.push("email is invalid");
        }
        if (student.sex && !["boy", "girl"].includes(student.sex.toLowerCase())) {
          rowErrors.push("sex must be boy or girl");
        }

        if (rowErrors.length) {
          validationErrors.push(`Row ${rowNumber}: ${rowErrors.join(", ")}.`);
        } else {
          previewStudents.push({
            id: student.student_id,
            name: student.name,
            email: student.email,
            sex: student.sex.toLowerCase(),
          });
        }
      });

      if (rows.length - 1 !== previewStudents.length + validationErrors.length) {
        validationErrors.push("One or more CSV rows could not be read.");
      }
      setCsvPreview(previewStudents);
      setCsvErrors(validationErrors);
    } catch (error) {
      setCsvPreview([]);
      setCsvErrors([error.message || "Unable to read this CSV file."]);
    }
  }

  function importCsvStudents() {
    if (!studentsClass || !csvPreview?.length || csvErrors.length) return;
    setClasses((currentClasses) =>
      currentClasses.map((schoolClass) =>
        schoolClass.id === studentsClass.id
          ? {
              ...schoolClass,
              students: [...schoolClass.students, ...csvPreview],
            }
          : schoolClass,
      ),
    );
    setPageMessage(
      `${csvPreview.length} students added to ${studentsClass.gradeLevel} - ${studentsClass.section}. Changes are temporary.`,
    );
    setCsvPreview(null);
    setCsvErrors([]);
  }

  function removeStudent(studentId) {
    if (!studentsClass) return;
    setClasses((currentClasses) =>
      currentClasses.map((schoolClass) =>
        schoolClass.id === studentsClass.id
          ? {
              ...schoolClass,
              students: schoolClass.students.filter(
                (student) => student.id !== studentId,
              ),
            }
          : schoolClass,
      ),
    );
  }

  function getScheduleSubjects(schoolClass, scheduleId = editingScheduleId) {
    const currentSchedule = (schoolClass.schedule ?? []).find(
      (entry) => entry.id === scheduleId,
    );
    return subjects.filter(
      (subject) =>
        (subject.status === "active" &&
          (subject.grade_levels ?? []).includes(schoolClass.gradeLevel)) ||
        subject.id === currentSchedule?.subjectId,
    );
  }

  function openScheduleDialog(schoolClass, schedule = null) {
    if (subjectsLoading || teachersLoading || subjectsError || teachersError) {
      setPageMessage(
        subjectsLoading
          ? "Subjects are still loading."
          : teachersLoading
            ? "Teacher accounts are still loading."
            : "Unable to load subjects or teachers. Retry before editing the schedule.",
      );
      return;
    }
    setEditingScheduleId(schedule?.id ?? null);
    setScheduleForm(
      schedule
        ? {
            day: schedule.day,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            subjectId: schedule.subjectId,
            teacherId: schedule.teacherId,
          }
        : emptyScheduleForm,
    );
    setScheduleError("");
    setIsScheduleModalOpen(true);
  }

  function closeScheduleDialog() {
    setIsScheduleModalOpen(false);
    setScheduleError("");
    setEditingScheduleId(null);
  }

  function updateScheduleForm(event) {
    const { name, value } = event.target;
    setScheduleForm((currentForm) => ({
      ...currentForm,
      [name]: value,
      ...(name === "subjectId" ? { teacherId: "" } : {}),
    }));
  }

  function saveScheduleEntry(event) {
    event.preventDefault();
    setScheduleError("");
    if (!selectedClass) return;

    const subject = subjects.find(
      (item) =>
        item.id === scheduleForm.subjectId &&
        getScheduleSubjects(selectedClass).some(
          (available) => available.id === item.id,
        ),
    );
    const teacher = teachers.find(
      (item) => item.uid === scheduleForm.teacherId,
    );
    const teacherIsAssigned = subject?.teacher_ids?.includes(
      scheduleForm.teacherId,
    );
    const currentEntry = (selectedClass.schedule ?? []).find(
      (entry) => entry.id === editingScheduleId,
    );
    const keepsExistingTeacher =
      currentEntry?.subjectId === scheduleForm.subjectId &&
      currentEntry?.teacherId === scheduleForm.teacherId;

    if (!subject || !teacherIsAssigned || (!teacher && !keepsExistingTeacher)) {
      setScheduleError(
        "Choose a subject and one of its assigned teacher accounts.",
      );
      return;
    }
    if (teacher?.disabled && !keepsExistingTeacher) {
      setScheduleError("A disabled teacher cannot be assigned to a schedule.");
      return;
    }
    if (!scheduleForm.startTime || !scheduleForm.endTime ||
      scheduleForm.startTime >= scheduleForm.endTime) {
      setScheduleError("End time must be later than start time.");
      return;
    }

    const hasTimeConflict = (selectedClass.schedule ?? []).some(
      (entry) =>
        entry.id !== editingScheduleId &&
        entry.day === scheduleForm.day &&
        scheduleForm.startTime < entry.endTime &&
        scheduleForm.endTime > entry.startTime,
    );
    if (hasTimeConflict) {
      setScheduleError("This schedule overlaps another entry on the same day.");
      return;
    }

    const entry = {
      id: editingScheduleId ?? `schedule-${Date.now()}`,
      ...scheduleForm,
    };
    setClasses((currentClasses) =>
      currentClasses.map((schoolClass) =>
        schoolClass.id === selectedClass.id
          ? {
              ...schoolClass,
              schedule: editingScheduleId
                ? (schoolClass.schedule ?? []).map((currentEntry) =>
                    currentEntry.id === editingScheduleId ? entry : currentEntry,
                  )
                : [...(schoolClass.schedule ?? []), entry],
            }
          : schoolClass,
      ),
    );
    closeScheduleDialog();
  }

  function deleteScheduleEntry(entryId) {
    if (!selectedClass) return;
    setClasses((currentClasses) =>
      currentClasses.map((schoolClass) =>
        schoolClass.id === selectedClass.id
          ? {
              ...schoolClass,
              schedule: (schoolClass.schedule ?? []).filter(
                (entry) => entry.id !== entryId,
              ),
            }
          : schoolClass,
      ),
    );
  }

  function deleteSelectedSection() {
    if (!deletingClass) return;
    setClasses((currentClasses) =>
      currentClasses.filter(
        (schoolClass) => schoolClass.id !== deletingClass.id,
      ),
    );
    setSelectedClassId((currentId) =>
      currentId === deletingClass.id ? "" : currentId,
    );
    setDeletingClass(null);
    setPageMessage(
      `${deletingClass.gradeLevel} - ${deletingClass.section} was removed. Students and accounts were not deleted.`,
    );
  }

  return (
    <PortalLayout
      role="admin"
      title="Classes"
      description=""
      navigation={<AdminNavigation activePath="/admin/classes" />}
      headerAction={
        <button
          type="button"
          className="primary-button"
          onClick={openCreateDialog}
        >
          Create Class
        </button>
      }
    >
      <div className="classes-page-content">

      {pageMessage && (
        <p className="form-message success classes-page-message" role="status">
          {pageMessage}
        </p>
      )}
      {teachersError && (
        <p className="form-message error classes-teacher-error" role="alert">
          {teachersError}{" "}
          <button
            type="button"
            className="classes-retry-button"
            onClick={() => {
              if (auth.currentUser) loadTeachers(auth.currentUser);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {subjectsError && (
        <p className="form-message error classes-teacher-error" role="alert">
          {subjectsError}{" "}
          <button
            type="button"
            className="classes-retry-button"
            onClick={() => {
              if (auth.currentUser) loadSubjects(auth.currentUser);
            }}
          >
            Retry subjects
          </button>
        </p>
      )}

      <div className="classes-toolbar">
        <label className="classes-search">
          <span>Search classes</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by section or teacher"
          />
        </label>
        <label>
          <span>Grade level</span>
          <select
            value={gradeFilter}
            onChange={(event) => setGradeFilter(event.target.value)}
          >
            <option value="">All grades</option>
            {classGrades.map((grade) => (
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
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </label>
      </div>

      <div className="classes-workspace">
        <section className="classes-panel" aria-labelledby="classes-list-title">
          <div className="section-header classes-panel-header">
            <h3 id="classes-list-title">Class List</h3>
            <span>
              Showing {firstVisibleClass}–{lastVisibleClass} of{" "}
              {filteredClasses.length} classes
            </span>
          </div>

          {filteredClasses.length === 0 ? (
            <div className="empty-state classes-empty-state">
              <p>No classes match these filters.</p>
            </div>
          ) : (
            <div className="classes-table-wrap">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th scope="col">Grade Level</th>
                    <th scope="col">Section</th>
                    <th scope="col">Adviser</th>
                    <th scope="col">Students</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleClasses.map((schoolClass) => {
                    return (
                      <tr
                        key={schoolClass.id}
                        className={
                          selectedClass?.id === schoolClass.id
                            ? "selected"
                            : ""
                        }
                      >
                        <td>{schoolClass.gradeLevel}</td>
                        <td>
                          <button
                            type="button"
                            className="class-select-button"
                            onClick={() => setSelectedClassId(schoolClass.id)}
                          >
                            {schoolClass.section}
                          </button>
                        </td>
                        <td>{getTeacherName(schoolClass.teacherId)}</td>
                        <td>{schoolClass.students.length}</td>
                        <td>
                          <span
                            className={`class-status ${schoolClass.status.toLowerCase()}`}
                          >
                            {schoolClass.status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="class-edit-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedClassId(schoolClass.id);
                            }}
                          >
                            View
                          </button>{" "}
                          <button
                            type="button"
                            className="class-edit-button"
                            onClick={() => openEditDialog(schoolClass)}
                          >
                            Edit
                          </button>
                          {" "}
                          <button
                            type="button"
                            className="class-edit-button class-delete-button"
                            onClick={() => setDeletingClass(schoolClass)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <nav className="classes-pagination" aria-label="Class list pages">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <div className="classes-page-numbers">
              {Array.from({ length: pageCount }, (_, index) => index + 1).map(
                (page) => (
                  <button
                    type="button"
                    key={page}
                    className={`classes-page-number${currentPage === page ? " active" : ""}`}
                    aria-current={currentPage === page ? "page" : undefined}
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setCurrentPage((page) => Math.min(pageCount, page + 1))
              }
              disabled={currentPage === pageCount}
            >
              Next
            </button>
          </nav>
        </section>

        <section
          className="classes-panel class-details"
          aria-labelledby="class-details-title"
        >
          <div className="section-header classes-panel-header">
            <h3 id="class-details-title">Class Details</h3>
          </div>
          {selectedClass ? (
            <div className="class-details-content">
              <dl className="class-summary">
                <div>
                  <dt>Grade Level</dt>
                  <dd>{selectedClass.gradeLevel}</dd>
                </div>
                <div>
                  <dt>Section</dt>
                  <dd>{selectedClass.section}</dd>
                </div>
                <div>
                  <dt>Adviser</dt>
                  <dd>{getTeacherName(selectedClass.teacherId)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedClass.status}</dd>
                </div>
              </dl>
              <div className="class-students-heading">
                <h4>Students</h4>
                <span>{selectedClass.students.length}</span>
              </div>
              <button
                type="button"
                className="secondary-button class-view-students"
                onClick={() => openStudents(selectedClass)}
              >
                Students
              </button>
              {selectedClass.students.length > 0 ? (
                <ul className="class-student-list">
                  {selectedClass.students.map((student) => (
                    <li key={student.id}>
                      <span>{student.name}</span>
                      <span>{student.id}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="class-students-empty">
                  No students are assigned to this class.
                </p>
              )}
              <div className="class-schedule-heading">
                <h4>Schedule</h4>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openScheduleDialog(selectedClass)}
                  disabled={
                    subjectsLoading ||
                    teachersLoading ||
                    Boolean(subjectsError || teachersError)
                  }
                >
                  Add Schedule
                </button>
              </div>
              {subjectsLoading ? (
                <p className="class-schedule-empty">Loading subjects...</p>
              ) : (selectedClass.schedule ?? []).length ? (
                <div className="class-schedule-list">
                  {weekdays.map((day) => {
                    const entries = (selectedClass.schedule ?? [])
                      .filter((entry) => entry.day === day)
                      .sort((first, second) =>
                        first.startTime.localeCompare(second.startTime),
                      );
                    if (!entries.length) return null;
                    return (
                      <div className="class-schedule-day" key={day}>
                        <h5>{day}</h5>
                        {entries.map((entry) => {
                          const subject = subjects.find(
                            (item) => item.id === entry.subjectId,
                          );
                          return (
                            <div className="class-schedule-entry" key={entry.id}>
                              <div>
                                <strong>
                                  {entry.startTime} - {entry.endTime}
                                </strong>
                                <span>
                                  {subject?.name ?? "Unavailable subject"}
                                </span>
                                <span>{getTeacherName(entry.teacherId)}</span>
                              </div>
                              <div className="class-schedule-actions">
                                <button
                                  type="button"
                                  className="class-edit-button"
                                  onClick={() =>
                                    openScheduleDialog(selectedClass, entry)
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="class-edit-button class-delete-button"
                                  onClick={() => deleteScheduleEntry(entry.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="class-schedule-empty">
                  No schedule entries for this section.
                </p>
              )}
            </div>
          ) : (
            <div className="empty-state classes-empty-state">
              <p>Select a class to see its details.</p>
            </div>
          )}
        </section>
      </div>

      {studentsClass && (
        <div className="modal-overlay active" role="presentation">
          <section
            className="modal class-students-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="class-students-title"
          >
            <div className="modal-header">
              <div>
                <h3 id="class-students-title">
                  Students — {studentsClass.gradeLevel} - {studentsClass.section}
                </h3>
                <p>{studentsClass.students.length} students in this section</p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close students"
                onClick={() => setStudentsClassId("")}
              >
                &times;
              </button>
            </div>
            <div className="class-students-modal-content">
              <div className="class-students-toolbar">
                <input
                  type="search"
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="Search students by ID or name"
                  aria-label="Search students"
                />
                <label className="secondary-button class-csv-picker">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvFile}
                  />
                </label>
              </div>
              <p className="class-demo-inline-note">
                Student changes are temporary and are not saved to the school
                database.
              </p>
              {visibleStudents.length ? (
                <div className="class-students-table-wrap">
                  <table className="classes-table class-students-table">
                    <thead>
                      <tr>
                        <th scope="col">Student ID</th>
                        <th scope="col">Name</th>
                        <th scope="col">Sex</th>
                        <th scope="col">
                          <span className="visually-hidden">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStudents.map((student) => (
                        <tr key={student.id}>
                          <td>{student.id}</td>
                          <td>{student.name}</td>
                          <td>
                            {student.sex
                              ? student.sex[0].toUpperCase() +
                                student.sex.slice(1)
                              : "—"}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="class-edit-button class-delete-button"
                              onClick={() => removeStudent(student.id)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state classes-empty-state">
                  <p>
                    {studentsClass.students.length
                      ? "No students match this search."
                      : "No students are assigned to this class."}
                  </p>
                </div>
              )}
            </div>
            <div className="modal-actions class-students-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStudentsClassId("")}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {csvPreview && studentsClass && (
        <div className="modal-overlay active class-csv-preview-overlay">
          <section
            className="modal class-csv-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-preview-title"
          >
            <div className="modal-header">
              <div>
                <h3 id="csv-preview-title">CSV Preview</h3>
                <p>
                  {csvPreview.length} students ready to import to{" "}
                  {studentsClass.section}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close CSV preview"
                onClick={() => {
                  setCsvPreview(null);
                  setCsvErrors([]);
                }}
              >
                &times;
              </button>
            </div>
            <div className="class-csv-preview-content">
              <p>
                Required columns: <code>student_id,name,email,sex</code>
              </p>
              {csvErrors.length > 0 && (
                <div className="class-csv-errors" role="alert">
                  <strong>Resolve these CSV issues before importing:</strong>
                  <ul>
                    {csvErrors.map((error, index) => (
                      <li key={`${index}-${error}`}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {csvPreview.length > 0 && (
                <div className="class-students-table-wrap">
                  <table className="classes-table">
                    <thead>
                      <tr>
                        <th scope="col">Student ID</th>
                        <th scope="col">Name</th>
                        <th scope="col">Email</th>
                        <th scope="col">Sex</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.map((student) => (
                        <tr key={student.id}>
                          <td>{student.id}</td>
                          <td>{student.name}</td>
                          <td>{student.email}</td>
                          <td>{student.sex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-actions class-students-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCsvPreview(null);
                  setCsvErrors([]);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={importCsvStudents}
                disabled={!csvPreview.length || csvErrors.length > 0}
              >
                Import Students
              </button>
            </div>
          </section>
        </div>
      )}

      {isScheduleModalOpen && selectedClass && (
        <div className="modal-overlay active">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-dialog-title"
          >
            <div className="modal-header">
              <div>
                <h3 id="schedule-dialog-title">
                  {editingScheduleId ? "Edit Schedule" : "Add Schedule"}
                </h3>
                <p>
                  {selectedClass.gradeLevel} - {selectedClass.section}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close schedule"
                onClick={closeScheduleDialog}
              >
                &times;
              </button>
            </div>
            <form className="class-form" onSubmit={saveScheduleEntry}>
              {scheduleError && (
                <p className="form-message error" role="alert">
                  {scheduleError}
                </p>
              )}
              <div className="form-group">
                <label htmlFor="schedule-day">Day</label>
                <select
                  id="schedule-day"
                  name="day"
                  value={scheduleForm.day}
                  onChange={updateScheduleForm}
                >
                  {weekdays.map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </div>
              <div className="class-schedule-time-fields">
                <div className="form-group">
                  <label htmlFor="schedule-start">Start Time</label>
                  <input
                    id="schedule-start"
                    name="startTime"
                    type="time"
                    value={scheduleForm.startTime}
                    onChange={updateScheduleForm}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="schedule-end">End Time</label>
                  <input
                    id="schedule-end"
                    name="endTime"
                    type="time"
                    value={scheduleForm.endTime}
                    onChange={updateScheduleForm}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="schedule-subject">Subject</label>
                <select
                  id="schedule-subject"
                  name="subjectId"
                  value={scheduleForm.subjectId}
                  onChange={updateScheduleForm}
                  required
                >
                  <option value="">Select an active subject</option>
                  {getScheduleSubjects(selectedClass).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name} ({subject.code})
                      {subject.status !== "active" ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="schedule-teacher">Teacher</label>
                <select
                  id="schedule-teacher"
                  name="teacherId"
                  value={scheduleForm.teacherId}
                  onChange={updateScheduleForm}
                  required
                  disabled={!scheduleForm.subjectId}
                >
                  <option value="">Select assigned teacher</option>
                  {scheduleForm.teacherId &&
                    !teachers.some(
                      (teacher) => teacher.uid === scheduleForm.teacherId,
                    ) && (
                      <option value={scheduleForm.teacherId}>
                        Existing assignment (account unavailable)
                      </option>
                    )}
                  {(
                    subjects.find(
                      (subject) => subject.id === scheduleForm.subjectId,
                    )?.teacher_ids ?? []
                  )
                    .map((teacherId) =>
                      teachers.find((teacher) => teacher.uid === teacherId),
                    )
                    .filter(
                      (teacher) =>
                        teacher &&
                        (!teacher.disabled ||
                          teacher.uid === scheduleForm.teacherId),
                    )
                    .map((teacher) => (
                      <option key={teacher.uid} value={teacher.uid}>
                        {getTeacherName(teacher.uid)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeScheduleDialog}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  {editingScheduleId ? "Save Changes" : "Add Schedule"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deletingClass && (
        <div className="modal-overlay active">
          <section
            className="modal class-delete-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-class-title"
            aria-describedby="delete-class-description"
          >
            <div className="modal-header">
              <div>
                <h3 id="delete-class-title">Delete Section?</h3>
                <p id="delete-class-description">
                  Are you sure you want to delete{" "}
                  <strong>
                    {deletingClass.gradeLevel} - {deletingClass.section}
                  </strong>
                  ?
                </p>
              </div>
            </div>
            <p className="class-delete-warning">
              This action cannot be undone. Students and teacher accounts will
              not be deleted. This demo change is temporary.
            </p>
            <div className="modal-actions class-students-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDeletingClass(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button class-danger-button"
                onClick={deleteSelectedSection}
              >
                Delete Section
              </button>
            </div>
          </section>
        </div>
      )}

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
          aria-labelledby="class-dialog-title"
        >
          <div className="modal-header">
            <div>
              <h3 id="class-dialog-title">
                {editingClassId ? "Edit Class" : "Create Class"}
              </h3>
              <p>Set the grade, section, teacher, and status.</p>
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

          <form className="class-form" onSubmit={handleSaveClass}>
            {formError && (
              <div className="form-message error" role="alert">
                {formError}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="class-grade">Grade Level</label>
              <select
                id="class-grade"
                name="gradeLevel"
                value={form.gradeLevel}
                onChange={updateForm}
                required
              >
                <option value="">Select grade level</option>
                {classGrades.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="class-section">Section Name</label>
              <input
                id="class-section"
                name="section"
                type="text"
                value={form.section}
                onChange={updateForm}
                placeholder="Enter section name"
                maxLength={60}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="class-teacher">Assigned Teacher</label>
              <select
                id="class-teacher"
                name="teacherId"
                value={form.teacherId}
                onChange={updateForm}
                required
                disabled={teachersLoading || Boolean(teachersError)}
              >
                <option value="">
                  {teachersLoading
                    ? "Loading teachers..."
                    : teachersError
                      ? "Unable to load teachers"
                      : teachers.length
                        ? "Select teacher"
                        : "No teacher accounts available."}
                </option>
                {form.teacherId &&
                  !teachers.some((teacher) => teacher.uid === form.teacherId) && (
                    <option value={form.teacherId}>
                      Existing teacher assignment (account unavailable)
                    </option>
                  )}
                {teachers
                  .filter(
                    (teacher) =>
                      !teacher.disabled || teacher.uid === form.teacherId,
                  )
                  .map((teacher) => (
                    <option key={teacher.uid} value={teacher.uid}>
                      {teacher.display_name}
                      {teacher.disabled ? " (disabled account)" : ""}
                    </option>
                  ))}
              </select>
              {!teachersLoading && !teachersError && teachers.length > 0 && (
                <p className="classes-teacher-help">
                  Disabled accounts are only shown for their existing class
                  assignments.
                </p>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="class-status">Status</label>
              <select
                id="class-status"
                name="status"
                value={form.status}
                onChange={updateForm}
                required
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={teachersLoading || Boolean(teachersError)}
              >
                {editingClassId ? "Save Changes" : "Create Class"}
              </button>
            </div>
          </form>
        </div>
      </div>
      </div>
    </PortalLayout>
  );
}
