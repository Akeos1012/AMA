import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import { classGrades } from "./classesMockData.js";
import { parseClassStudentsCsv } from "./classes/classCsv.js";
import ClassFormDialog from "./classes/ClassFormDialog.jsx";
import ClassStudentsDialog from "./classes/ClassStudentsDialog.jsx";
import ClassScheduleDialog from "./classes/ClassScheduleDialog.jsx";
import "./Classes.css";

const USERS_ENDPOINT = "/api/admin/users";
const SUBJECTS_ENDPOINT = "/api/admin/subjects";
const CLASSES_ENDPOINT = "/api/admin/classes";
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
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

function loadSelectedClassId() {
  try {
    return window.localStorage.getItem(SELECTED_CLASS_STORAGE_KEY) ?? "";
  } catch (error) {
    console.error("Could not load the saved class selection:", error);
    return "";
  }
}

async function requestJson(user, endpoint, options = {}) {
  const response = await authenticatedFetch(user, endpoint, options);
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof result?.detail === "string"
        ? result.detail
        : `Request failed (${response.status}).`,
    );
  }
  return result;
}

function toUiClass(record, memberships, accounts) {
  const accountsByUid = new Map(accounts.map((account) => [account.uid, account]));
  const students = memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => {
      const account = accountsByUid.get(membership.student_uid);
      return {
        id: account?.student_id || membership.student_uid,
        uid: membership.student_uid,
        membershipId: membership.id,
        name: account?.display_name || account?.name || membership.student_uid,
        email: account?.email || "",
        sex: account?.sex,
      };
    });

  return {
    id: record.id,
    name: record.name,
    gradeLevel: record.grade_level,
    section: record.section,
    teacherId: record.lead_teacher_uid || "",
    status: record.status === "active" ? "Active" : "Inactive",
    students,
    schedule: (record.schedule || []).map((entry) => ({
      id: entry.id,
      day: entry.day,
      startTime: entry.start_time,
      endTime: entry.end_time,
      subjectId: entry.subject_id,
      teacherId: entry.teacher_uid,
    })),
  };
}

export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classesError, setClassesError] = useState("");
  const [accounts, setAccounts] = useState([]);
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
  const [pageError, setPageError] = useState("");
  const [studentsClassId, setStudentsClassId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvErrors, setCsvErrors] = useState([]);
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [deletingClass, setDeletingClass] = useState(null);
  const [isSavingClass, setIsSavingClass] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [studentMutationUid, setStudentMutationUid] = useState("");
  const [isDeactivatingClass, setIsDeactivatingClass] = useState(false);
  const [assignmentSyncClassId, setAssignmentSyncClassId] = useState("");

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

      setAccounts(users);
      setTeachers(
        users
          .filter((account) => account.role === "teacher")
          .map((account) => ({
            uid: account.uid,
            display_name:
              account.display_name || account.name || account.email || "",
            disabled:
              Boolean(account.disabled) || account.profile_status !== "active",
          }))
          .filter((teacher) => teacher.uid),
      );
      return users;
    } catch (error) {
      console.error("Could not load class teacher accounts:", error);
      setTeachersError(
        "Unable to load teacher accounts. Please try again.",
      );
      return [];
    } finally {
      setTeachersLoading(false);
    }
  }, []);

  const loadClasses = useCallback(async (user, accountList) => {
    setClassesLoading(true);
    setClassesError("");
    try {
      const records = await requestJson(user, CLASSES_ENDPOINT);
      if (!Array.isArray(records)) {
        throw new Error("The class response was not a list.");
      }
      const classData = await Promise.all(
        records.map(async (record) => {
          const memberships = await requestJson(
            user,
            `${CLASSES_ENDPOINT}/${encodeURIComponent(record.id)}/memberships`,
          );
          if (!Array.isArray(memberships)) {
            throw new Error("A class membership response was not a list.");
          }
          return toUiClass(record, memberships, accountList);
        }),
      );
      setClasses(classData);
    } catch (error) {
      console.error("Could not load classes:", error);
      setClassesError(error.message || "Unable to load classes. Please retry.");
      setClasses([]);
    } finally {
      setClassesLoading(false);
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
          const [userAccounts] = await Promise.all([
            loadTeachers(user),
            loadSubjects(user),
          ]);
          await loadClasses(user, userAccounts);
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
  }, [loadClasses, loadSubjects, loadTeachers]);

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
      !classesLoading &&
      selectedClassId &&
      !classes.some((schoolClass) => schoolClass.id === selectedClassId)
    ) {
      setSelectedClassId("");
    }
  }, [classes, classesLoading, selectedClassId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, gradeFilter, statusFilter]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

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
    setPageError("");
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
    setPageError("");
    setIsModalOpen(true);
  }

  function closeDialog() {
    if (isSavingClass) return;
    setIsModalOpen(false);
    setFormError("");
  }

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
  }

  async function handleSaveClass(event) {
    event.preventDefault();
    setFormError("");
    setPageError("");

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
    if (
      form.teacherId &&
      (!selectedTeacher || selectedTeacher.disabled)
    ) {
      setFormError("Select an active teacher account as the class adviser.");
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

    const body = {
      name: `${form.gradeLevel} - ${section}`,
      grade_level: form.gradeLevel,
      section,
      lead_teacher_uid: selectedTeacher?.uid ?? null,
      status: form.status.toLowerCase(),
    };

    setIsSavingClass(true);
    try {
      const saved = await requestJson(
        auth.currentUser,
        editingClassId
          ? `${CLASSES_ENDPOINT}/${encodeURIComponent(editingClassId)}`
          : CLASSES_ENDPOINT,
        {
          method: editingClassId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const updatedClass = {
        ...toUiClass(saved, [], accounts),
        students: existingClass?.students ?? [],
      };
      setClasses((currentClasses) =>
        editingClassId
          ? currentClasses.map((schoolClass) =>
              schoolClass.id === editingClassId ? updatedClass : schoolClass,
            )
          : [...currentClasses, updatedClass],
      );
      setSelectedClassId(updatedClass.id);
      setPageMessage(
        editingClassId
          ? "Class updated successfully."
          : "Class created successfully.",
      );
      setIsModalOpen(false);
      setFormError("");
    } catch (error) {
      console.error("Could not save class:", error);
      setFormError(error.message || "Unable to save this class.");
    } finally {
      setIsSavingClass(false);
    }
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
      const { previewStudents, validationErrors } = parseClassStudentsCsv(
        await file.text(),
        studentsClass.students,
      );
      setCsvPreview(previewStudents);
      setCsvErrors(validationErrors);
    } catch (error) {
      setCsvPreview([]);
      setCsvErrors([error.message || "Unable to read this CSV file."]);
    }
  }

  async function importCsvStudents() {
    if (!studentsClass || !csvPreview?.length || csvErrors.length) return;
    setPageError("");

    const resolvedStudents = csvPreview.map((student) => {
      const matches = accounts.filter(
        (account) =>
          account.role === "student" &&
          account.student_id?.trim().toLowerCase() ===
            student.id.trim().toLowerCase(),
      );
      if (matches.length !== 1) {
        return {
          error: `Student ID ${student.id} does not match exactly one registered student account.`,
        };
      }
      const [account] = matches;
      if (
        account.disabled ||
        account.email?.trim().toLowerCase() !==
          student.email.trim().toLowerCase()
      ) {
        return {
          error: `Student ID ${student.id} must match an active account and its registered email.`,
        };
      }
      return { student, account };
    });
    const resolutionErrors = resolvedStudents
      .filter((entry) => entry.error)
      .map((entry) => entry.error);
    if (resolutionErrors.length) {
      setCsvErrors(resolutionErrors);
      return;
    }

    let importedCount = 0;
    for (const { account, student } of resolvedStudents) {
      try {
        await requestJson(
          auth.currentUser,
          `${CLASSES_ENDPOINT}/${encodeURIComponent(studentsClass.id)}/memberships`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              class_id: studentsClass.id,
              student_uid: account.uid,
              status: "active",
            }),
          },
        );
        importedCount += 1;
      } catch (error) {
        console.error("Could not save an imported student membership:", error);
        await loadClasses(auth.currentUser, accounts);
        setCsvErrors([
          `Saved ${importedCount} of ${resolvedStudents.length} memberships. The remaining import stopped: ${error.message}`,
        ]);
        return;
      }
    }

    await loadClasses(auth.currentUser, accounts);
    setPageMessage(
      `${importedCount} students added to ${studentsClass.gradeLevel} - ${studentsClass.section}.`,
    );
    setCsvPreview(null);
    setCsvErrors([]);
  }

  async function removeStudent(student) {
    if (!studentsClass || !student?.membershipId || !student.uid) return;
    setStudentMutationUid(student.uid);
    setPageError("");
    setPageMessage("");
    try {
      await requestJson(
        auth.currentUser,
        `${CLASSES_ENDPOINT}/${encodeURIComponent(studentsClass.id)}/memberships/${encodeURIComponent(student.membershipId)}`,
        { method: "DELETE" },
      );
      setClasses((currentClasses) =>
        currentClasses.map((schoolClass) =>
          schoolClass.id === studentsClass.id
            ? {
                ...schoolClass,
                students: schoolClass.students.filter(
                  (currentStudent) => currentStudent.uid !== student.uid,
                ),
              }
            : schoolClass,
        ),
      );
      setPageMessage(`${student.name} was removed from the class.`);
    } catch (error) {
      console.error("Could not remove student membership:", error);
      setPageError(error.message || "Unable to remove the student.");
    } finally {
      setStudentMutationUid("");
    }
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
    setPageError("");
    if (schoolClass.status !== "Active") {
      setPageError("Reactivate this class before editing its schedule.");
      return;
    }
    if (subjectsLoading || teachersLoading || subjectsError || teachersError) {
      setPageError(
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

  async function persistSchedule(schoolClass, schedule) {
    const schedulePayload = schedule.map((entry) => ({
      id: entry.id,
      day: entry.day,
      start_time: entry.startTime,
      end_time: entry.endTime,
      subject_id: entry.subjectId,
      teacher_uid: entry.teacherId,
    }));
    const savedClass = await requestJson(
      auth.currentUser,
      `${CLASSES_ENDPOINT}/${encodeURIComponent(schoolClass.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: schedulePayload }),
      },
    );

    try {
      const endpoint = `${CLASSES_ENDPOINT}/${encodeURIComponent(schoolClass.id)}/teacher-assignments`;
      const assignments = await requestJson(auth.currentUser, endpoint);
      if (!Array.isArray(assignments)) {
        throw new Error("The teacher assignment response was not a list.");
      }

      const desired = new Map(
        schedule.map((entry) => [
          JSON.stringify([entry.subjectId, entry.teacherId]),
          entry,
        ]),
      );
      const existing = new Map(
        assignments.map((assignment) => [
          JSON.stringify([assignment.subject_id, assignment.teacher_uid]),
          assignment,
        ]),
      );

      for (const [key, entry] of desired) {
        if (existing.get(key)?.status === "active") continue;
        await requestJson(auth.currentUser, endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: schoolClass.id,
            subject_id: entry.subjectId,
            teacher_uid: entry.teacherId,
            status: "active",
          }),
        });
      }

    } catch (error) {
      setAssignmentSyncClassId(schoolClass.id);
      await loadClasses(auth.currentUser, accounts);
      throw new Error(
        `Schedule details were saved, but teacher assignments could not be fully synchronized: ${error.message}`,
      );
    }

    setAssignmentSyncClassId("");
    const updatedClass = {
      ...toUiClass(savedClass, [], accounts),
      students: schoolClass.students,
    };
    setClasses((currentClasses) =>
      currentClasses.map((currentClass) =>
        currentClass.id === updatedClass.id ? updatedClass : currentClass,
      ),
    );
  }

  function closeScheduleDialog() {
    if (isSavingSchedule) return;
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

  async function saveScheduleEntry(event) {
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
    const updatedSchedule = editingScheduleId
      ? (selectedClass.schedule ?? []).map((currentEntry) =>
          currentEntry.id === editingScheduleId ? entry : currentEntry,
        )
      : [...(selectedClass.schedule ?? []), entry];
    setIsSavingSchedule(true);
    try {
      await persistSchedule(selectedClass, updatedSchedule);
      setPageMessage(
        editingScheduleId
          ? "Schedule updated. Section assignments remain managed in Subjects."
          : "Schedule saved. Its teacher was assigned to this section.",
      );
      setIsScheduleModalOpen(false);
      setEditingScheduleId(null);
      setScheduleError("");
    } catch (error) {
      console.error("Could not save class schedule:", error);
      setScheduleError(error.message || "Unable to save the class schedule.");
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function deleteScheduleEntry(entryId) {
    if (!selectedClass || isSavingSchedule) return;
    setIsSavingSchedule(true);
    setPageError("");
    try {
      await persistSchedule(
        selectedClass,
        selectedClass.schedule.filter((entry) => entry.id !== entryId),
      );
      setPageMessage(
        "Schedule removed. The section assignment remains active until deactivated in Subjects.",
      );
    } catch (error) {
      console.error("Could not delete class schedule:", error);
      setPageError(error.message || "Unable to remove the class schedule.");
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function retryScheduleAssignmentSync() {
    if (!selectedClass || isSavingSchedule) return;
    setIsSavingSchedule(true);
    setPageError("");
    try {
      await persistSchedule(selectedClass, selectedClass.schedule);
      setPageMessage("Schedule and teacher assignments synchronized.");
    } catch (error) {
      console.error("Could not retry teacher assignment synchronization:", error);
      setPageError(error.message || "Unable to synchronize teacher assignments.");
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function deleteSelectedSection() {
    if (!deletingClass || isDeactivatingClass) return;
    setPageError("");
    setIsDeactivatingClass(true);
    try {
      const saved = await requestJson(
        auth.currentUser,
        `${CLASSES_ENDPOINT}/${encodeURIComponent(deletingClass.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "inactive" }),
        },
      );
      setClasses((currentClasses) =>
        currentClasses.map((schoolClass) =>
          schoolClass.id === deletingClass.id
            ? {
                ...schoolClass,
                ...toUiClass(saved, [], accounts),
                students: schoolClass.students,
              }
            : schoolClass,
        ),
      );
      setDeletingClass(null);
      setPageMessage(
        `${deletingClass.gradeLevel} - ${deletingClass.section} was deactivated. Its records were retained.`,
      );
    } catch (error) {
      console.error("Could not deactivate class:", error);
      setPageError(error.message || "Unable to deactivate this class.");
    } finally {
      setIsDeactivatingClass(false);
    }
  }

  return (
    <PortalLayout
      role="admin"
      pageClassName="page-admin-classes"
      title="Classes"
      description=""
      navigation={<AdminNavigation activePath="/admin/classes" />}
      headerAction={
        <button
          type="button"
          className="primary-button"
          disabled={classesLoading || Boolean(classesError)}
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
      {pageError && (
        <p className="form-message error classes-page-message" role="alert">
          {pageError}{" "}
          {assignmentSyncClassId === selectedClass?.id && (
            <button
              type="button"
              className="classes-retry-button"
              disabled={isSavingSchedule}
              onClick={retryScheduleAssignmentSync}
            >
              Retry assignment sync
            </button>
          )}
        </p>
      )}
      {classesError && (
        <p className="form-message error classes-teacher-error" role="alert">
          {classesError}{" "}
          <button
            type="button"
            className="classes-retry-button"
            onClick={() => {
              if (auth.currentUser) loadClasses(auth.currentUser, accounts);
            }}
          >
            Retry classes
          </button>
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

          {classesLoading ? (
            <div className="empty-state classes-empty-state">
              <p>Loading classes...</p>
            </div>
          ) : classesError ? (
            <div className="empty-state classes-empty-state">
              <p>Class data could not be loaded.</p>
            </div>
          ) : filteredClasses.length === 0 ? (
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
                            disabled={schoolClass.status === "Inactive"}
                            onClick={() => setDeletingClass(schoolClass)}
                          >
                            Deactivate
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
                    Boolean(subjectsError || teachersError) ||
                    selectedClass.status !== "Active"
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
                                  disabled={isSavingSchedule}
                                  onClick={() =>
                                    openScheduleDialog(selectedClass, entry)
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="class-edit-button class-delete-button"
                                  disabled={
                                    isSavingSchedule ||
                                    selectedClass.status !== "Active"
                                  }
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

      <ClassStudentsDialog
        studentsClass={studentsClass}
        visibleStudents={visibleStudents}
        studentSearch={studentSearch}
        onStudentSearchChange={(event) => setStudentSearch(event.target.value)}
        onClose={() => setStudentsClassId("")}
        onCsvFile={handleCsvFile}
        onRemoveStudent={removeStudent}
        studentMutationUid={studentMutationUid}
        csvPreview={csvPreview}
        csvErrors={csvErrors}
        onCloseCsvPreview={() => {
          setCsvPreview(null);
          setCsvErrors([]);
        }}
        onImportCsv={importCsvStudents}
      />

      {isScheduleModalOpen && (
        <ClassScheduleDialog
          selectedClass={selectedClass}
          editingScheduleId={editingScheduleId}
          isSaving={isSavingSchedule}
          scheduleError={scheduleError}
          scheduleForm={scheduleForm}
          weekdays={weekdays}
          teachers={teachers}
          subjects={subjects}
          onClose={closeScheduleDialog}
          onSave={saveScheduleEntry}
          onFormChange={updateScheduleForm}
          getScheduleSubjects={getScheduleSubjects}
          getTeacherName={getTeacherName}
        />
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
                <h3 id="delete-class-title">Deactivate Class?</h3>
                <p id="delete-class-description">
                  Are you sure you want to deactivate{" "}
                  <strong>
                    {deletingClass.gradeLevel} - {deletingClass.section}
                  </strong>
                  ?
                </p>
              </div>
            </div>
            <p className="class-delete-warning">
              The class and its memberships will be retained. Teachers will no
              longer see this class until it is reactivated.
            </p>
            <div className="modal-actions class-students-modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isDeactivatingClass}
                onClick={() => setDeletingClass(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button class-danger-button"
                disabled={isDeactivatingClass}
                onClick={deleteSelectedSection}
              >
                {isDeactivatingClass ? "Deactivating..." : "Deactivate Class"}
              </button>
            </div>
          </section>
        </div>
      )}

      <ClassFormDialog
        isOpen={isModalOpen}
        isSaving={isSavingClass}
        editingClassId={editingClassId}
        form={form}
        formError={formError}
        classGrades={classGrades}
        teachers={teachers}
        teachersLoading={teachersLoading}
        teachersError={teachersError}
        onClose={closeDialog}
        onFormChange={updateForm}
        onSubmit={handleSaveClass}
      />
      </div>
    </PortalLayout>
  );
}
