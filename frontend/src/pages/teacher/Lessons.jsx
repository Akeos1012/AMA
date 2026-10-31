import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import TeacherNavigation from "../../components/navigation/TeacherNavigation.jsx";
import LessonBlockEditor, {
  MAX_IMPORTED_TEXT_LENGTH,
} from "./lessons/LessonBlockEditor.jsx";
import "./Lessons.css";

const EMPTY_CONTENT_BLOCKS = [{ type: "paragraph", text: "" }];

function importedTextToBlocks(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph", text: paragraph }));
}

function hasLessonText(blocks) {
  return blocks.some((block) =>
    /[\p{L}\p{N}]/u.test(
      block.type === "bullet_list" ? block.items.join(" ") : block.text,
    ),
  );
}

function lessonContentText(blocks) {
  return blocks
    .map((block) =>
      block.type === "bullet_list" ? block.items.join(" ") : block.text,
    )
    .join(" ");
}

function lessonWordCount(blocks) {
  return lessonContentText(blocks).trim().split(/\s+/).filter(Boolean).length;
}

function validateLessonForPublication(lesson, authorizedPairs) {
  if (!lesson.title?.trim()) return "Add a lesson title before publishing.";
  if (!lesson.topic?.trim()) return "Add a lesson topic before publishing.";
  if (
    !authorizedPairs.some(
      (pair) =>
        pair.class_id === lesson.class_id &&
        pair.subject_id === lesson.subject_id,
    )
  ) {
    return "This lesson no longer has an active class and subject assignment.";
  }
  if (!Array.isArray(lesson.content?.blocks) || !lesson.content.blocks.length) {
    return "Add at least one usable content block before publishing.";
  }
  const textBlocks = lesson.content.blocks.flatMap((block) =>
    block.type === "bullet_list" && Array.isArray(block.items)
      ? block.items
      : typeof block.text === "string"
        ? [block.text]
        : [],
  );
  if (!textBlocks.some((text) => /[\p{L}\p{N}]/u.test(text))) {
    return "Add at least one content block with usable lesson text before publishing.";
  }
  return "";
}

function classLabel(schoolClass) {
  const label = [...new Set([
    schoolClass.name,
    schoolClass.grade_level,
    schoolClass.section,
  ])]
    .filter(Boolean)
    .join(" · ");
  return label || schoolClass.id;
}

function authorizedTeachingPairs(classes) {
  return classes.flatMap((schoolClass) =>
    (schoolClass.assigned_subjects ?? []).map((subject) => ({
      class_id: schoolClass.id,
      class_label: classLabel(schoolClass),
      subject_id: subject.id,
      subject_label: subject.name || subject.code || subject.id,
      label: `${classLabel(schoolClass)} — ${subject.name || subject.code || subject.id}`,
    })),
  );
}

function contentBlocksFromLesson(lesson) {
  return lesson.content.blocks.map((block) => {
    if (block.type === "bullet_list") {
      return { type: block.type, items: [...block.items] };
    }
    if (block.type === "heading") {
      return { type: block.type, level: block.level, text: block.text };
    }
    return { type: "paragraph", text: block.text };
  });
}

function blockError(block, index) {
  if (block.type === "bullet_list") {
    if (!block.items.length || block.items.some((item) => !item.trim())) {
      return `Block ${index + 1} needs at least one non-empty bullet item.`;
    }
    return "";
  }
  if (!block.text.trim()) {
    return `Block ${index + 1} must contain text.`;
  }
  return "";
}

async function responseError(response, fallback) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    return fallback;
  }

  if (typeof payload?.detail === "string" && payload.detail.trim()) {
    return payload.detail;
  }
  if (Array.isArray(payload?.detail)) {
    const messages = payload.detail
      .map((issue) => issue?.msg)
      .filter((message) => typeof message === "string" && message.trim());
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

function statusMessage(status) {
  if (status === 401 || status === 403) {
    return "Your teacher access could not be verified or this lesson is no longer available to you.";
  }
  if (status === 404) return "This lesson is no longer available.";
  if (status === 422) return "Some lesson details are invalid. Review the form and try again.";
  return "The lesson request could not be completed. Please try again.";
}

export default function TeacherLessons() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lessonsError, setLessonsError] = useState("");
  const [classesError, setClassesError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formMode, setFormMode] = useState("");
  const [editingLessonId, setEditingLessonId] = useState("");
  const [initialFormValues, setInitialFormValues] = useState(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [blocks, setBlocks] = useState(EMPTY_CONTENT_BLOCKS);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formSuccess, setFormSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingLessonId, setDeletingLessonId] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importSource, setImportSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importPreview, setImportPreview] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importedContentApplied, setImportedContentApplied] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [publishingLessonId, setPublishingLessonId] = useState("");
  const publicationInFlight = useRef(false);
  const teachingPairs = useMemo(() => authorizedTeachingPairs(classes), [classes]);
  const currentFormValues = { title, topic, classId, subjectId, blocks };
  const isFormDirty =
    Boolean(formMode) &&
    initialFormValues !== null &&
    (JSON.stringify(currentFormValues) !== initialFormValues ||
      Boolean(importPreview));

  const loadLessons = useCallback(async (activeUser) => {
    try {
      const response = await authenticatedFetch(activeUser, "/api/lessons");
      if (!response.ok) {
        setLessonsError(await responseError(response, statusMessage(response.status)));
        setLessons([]);
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The lesson response was not a list.");
      }
      setLessons(data);
      setLessonsError("");
    } catch (error) {
      console.error("Could not load teacher lessons:", error);
      setLessonsError("Unable to load your lessons right now. Please try again.");
      setLessons([]);
    }
  }, []);

  const loadClasses = useCallback(async (activeUser) => {
    try {
      const response = await authenticatedFetch(activeUser, "/api/teacher/classes");
      if (!response.ok) {
        setClassesError(await responseError(response, statusMessage(response.status)));
        setClasses([]);
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The teacher class response was not a list.");
      }
      setClasses(data);
      setClassesError("");
    } catch (error) {
      console.error("Could not load teacher class assignments:", error);
      setClassesError("Unable to load your class and subject assignments right now.");
      setClasses([]);
    }
  }, []);

  const refreshData = useCallback(
    async (activeUser) => {
      setLoading(true);
      setFormSuccess("");
      await Promise.all([loadLessons(activeUser), loadClasses(activeUser)]);
      setLoading(false);
    },
    [loadClasses, loadLessons],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          if (active) setAuthState("unauthenticated");
          return;
        }

        try {
          const tokenResult = await getIdTokenResult(currentUser, true);
          if (!active) return;
          if (tokenResult.claims.role !== "teacher") {
            setAuthState("forbidden");
            return;
          }
          setUser(currentUser);
          setAuthState("authorized");
          await refreshData(currentUser);
        } catch (error) {
          console.error("Teacher authentication check failed:", error);
          if (active) {
            setAuthState("error");
            setLoading(false);
          }
        }
      },
      (error) => {
        console.error("Teacher authentication check failed:", error);
        if (active) {
          setAuthState("error");
          setLoading(false);
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshData]);

  const selectedClass = classes.find((schoolClass) => schoolClass.id === classId);
  const selectedSubjects = selectedClass?.assigned_subjects ?? [];

  const resetForm = () => {
    setFormMode("");
    setPreviewMode(false);
    setEditingLessonId("");
    setInitialFormValues(null);
    setTitle("");
    setTopic("");
    setClassId("");
    setSubjectId("");
    setBlocks(EMPTY_CONTENT_BLOCKS);
    setFormError("");
    setFieldErrors({});
    setImportFile(null);
    setImportSource("");
    setImporting(false);
    setImportError("");
    setImportPreview("");
    setImportMessage("");
    setImportedContentApplied(false);
  };

  const closeForm = () => {
    if (
      isFormDirty &&
      !window.confirm("Discard your unsaved lesson changes?")
    ) {
      return;
    }
    resetForm();
  };

  const startCreate = () => {
    if (
      isFormDirty &&
      !window.confirm("Discard your unsaved lesson changes?")
    ) {
      return;
    }
    resetForm();
    setFormMode("create");
    setPreviewMode(false);
    const firstPair = teachingPairs[0];
    const newValues = {
      title: "",
      topic: "",
      classId: firstPair?.class_id ?? "",
      subjectId: firstPair?.subject_id ?? "",
      blocks: EMPTY_CONTENT_BLOCKS,
    };
    setInitialFormValues(JSON.stringify(newValues));
    if (firstPair) {
      setClassId(firstPair.class_id);
      setSubjectId(firstPair.subject_id);
    }
  };

  const startEdit = (lesson, shouldPreview = false) => {
    if (
      isFormDirty &&
      !window.confirm("Discard your unsaved lesson changes?")
    ) {
      return false;
    }
    const editBlocks = contentBlocksFromLesson(lesson);
    setInitialFormValues(
      JSON.stringify({
        title: lesson.title,
        topic: lesson.topic,
        classId: lesson.class_id,
        subjectId: lesson.subject_id,
        blocks: editBlocks,
      }),
    );
    setFormMode("edit");
    setPreviewMode(shouldPreview);
    setEditingLessonId(lesson.id);
    setTitle(lesson.title);
    setTopic(lesson.topic);
    setClassId(lesson.class_id);
    setSubjectId(lesson.subject_id);
    setBlocks(editBlocks);
    setImportFile(null);
    setImportSource("");
    setImportError("");
    setImportPreview("");
    setImportMessage("");
    setImportedContentApplied(false);
    setFormError("");
    setFieldErrors({});
    setFormSuccess("");
    setActionError("");
    return true;
  };

  const changeClass = (nextClassId) => {
    setClassId(nextClassId);
    const nextClass = classes.find((schoolClass) => schoolClass.id === nextClassId);
    setSubjectId(nextClass?.assigned_subjects?.[0]?.id ?? "");
  };

  const changeBlock = (index, nextBlock) => {
    setBlocks((current) =>
      current.map((block, blockIndex) => (blockIndex === index ? nextBlock : block)),
    );
    setFieldErrors((current) => ({ ...current, blocks: "" }));
  };

  const removeBlock = (index) => {
    if (blocks.length === 1) {
      setFormError("A lesson must contain at least one content block.");
      return;
    }
    setBlocks((current) => current.filter((_, blockIndex) => blockIndex !== index));
    setFormError("");
    setFieldErrors((current) => ({ ...current, blocks: "" }));
  };

  const moveBlock = (index, offset) => {
    const destination = index + offset;
    if (destination < 0 || destination >= blocks.length) return;
    setBlocks((current) => {
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [
        reordered[destination],
        reordered[index],
      ];
      return reordered;
    });
  };

  const addBlock = (type) => {
    const newBlock =
      type === "heading"
        ? { type, level: 2, text: "" }
        : type === "bullet_list"
          ? { type, items: [""] }
          : { type: "paragraph", text: "" };
    setBlocks((current) => [...current, newBlock]);
    setFieldErrors((current) => ({ ...current, blocks: "" }));
  };

  const selectImportFile = (sourceType, file) => {
    setImportSource(sourceType);
    setImportFile(file ?? null);
    setImportError("");
    setImportPreview("");
    setImportMessage("");
  };

  const importLessonText = async () => {
    if (!importFile || importing) return;
    if (!classId || !subjectId) {
      setImportError("Select an authorized class and subject before importing.");
      return;
    }

    setImporting(true);
    setImportError("");
    setImportMessage("");
    try {
      const body = new FormData();
      body.append("file", importFile);
      body.append("class_id", classId);
      body.append("subject_id", subjectId);
      const response = await authenticatedFetch(
        user,
        `/api/lessons/import/${importSource}`,
        { method: "POST", body },
      );
      if (!response.ok) {
        setImportError(
          await responseError(response, statusMessage(response.status)),
        );
        return;
      }

      const result = await response.json();
      setImportPreview(result.text);
      setImportMessage(
        importSource === "pdf"
          ? `Extracted text from ${result.page_count} PDF page(s). Review the reading order and correct it before use; PDF layout may not be preserved.`
          : "Text extracted. Review and correct it before use.",
      );
    } catch (error) {
      console.error("Could not import lesson text:", error);
      setImportError("Unable to extract this file right now. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const applyImportPreview = () => {
    const importedBlocks = importedTextToBlocks(importPreview);
    if (
      !importedBlocks.length ||
      !importedBlocks.some((block) => /[\p{L}\p{N}]/u.test(block.text))
    ) {
      setImportError("Enter some usable lesson text before applying the preview.");
      return;
    }
    const importedBytes = new TextEncoder().encode(
      importedBlocks.map((block) => block.text).join("\n\n"),
    ).length;
    if (importedBytes > MAX_IMPORTED_TEXT_LENGTH) {
      setImportError("Corrected lesson text must be 256 KiB or smaller.");
      return;
    }
    if (
      hasLessonText(blocks) &&
      !window.confirm(
        "Replace the current lesson content with the imported text? The change is not saved until you save the lesson.",
      )
    ) {
      return;
    }
    setBlocks(importedBlocks);
    setImportedContentApplied(true);
    setFieldErrors((current) => ({ ...current, blocks: "" }));
    setFormError("");
    setImportError("");
    setImportMessage(
      "Imported text is now editable as paragraph blocks. Save the lesson to persist it.",
    );
  };

  const validateForm = () => {
    const errors = {};
    if (!title.trim()) errors.title = "Enter a lesson title.";
    if (!topic.trim()) errors.topic = "Enter a lesson topic.";
    if (!classId) errors.class_id = "Select an authorized class.";
    if (!subjectId) errors.subject_id = "Select an authorized subject.";
    const invalidBlockIndex = blocks.findIndex((block, index) => blockError(block, index));
    if (blocks.length === 0) {
      errors.blocks = "A lesson must contain at least one content block.";
    } else if (invalidBlockIndex >= 0) {
      errors.blocks = blockError(blocks[invalidBlockIndex], invalidBlockIndex);
    } else if (
      importedContentApplied &&
      !blocks.some((block) =>
        /[\p{L}\p{N}]/u.test(
          block.type === "bullet_list" ? block.items.join(" ") : block.text,
        ),
      )
    ) {
      errors.blocks = "Imported lesson content must contain usable text.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveLesson = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");
    setActionError("");
    if (saving || !validateForm()) return;
    if (
      importedContentApplied &&
      new TextEncoder().encode(
        blocks
          .map((block) => (block.type === "bullet_list" ? block.items.join("\n") : block.text))
          .join("\n\n"),
      ).length > MAX_IMPORTED_TEXT_LENGTH
    ) {
      const message = "Imported lesson text must remain 256 KiB or smaller.";
      setFieldErrors((current) => ({ ...current, blocks: message }));
      setFormError(message);
      return;
    }

    const contentBlocks = blocks.map((block) =>
      block.type === "bullet_list"
        ? { type: "bullet_list", items: block.items.map((item) => item.trim()) }
        : block.type === "heading"
          ? {
              type: "heading",
              text: block.text.trim(),
              level: block.level,
            }
          : { type: "paragraph", text: block.text.trim() },
    );
    const payload = {
      title: title.trim(),
      topic: topic.trim(),
      class_id: classId,
      subject_id: subjectId,
      content: { schema_version: 1, blocks: contentBlocks },
    };

    setSaving(true);
    try {
      const isEditing = formMode === "edit";
      const response = await authenticatedFetch(
        user,
        isEditing
          ? `/api/lessons/${encodeURIComponent(editingLessonId)}`
          : "/api/lessons",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        setFormError(await responseError(response, statusMessage(response.status)));
        return;
      }

      const savedLesson = await response.json();
      setLessons((current) =>
        isEditing
          ? current.map((lesson) => (lesson.id === savedLesson.id ? savedLesson : lesson))
          : [savedLesson, ...current],
      );
      resetForm();
      setFormSuccess(isEditing ? "Lesson changes saved." : "Lesson created as a draft.");
    } catch (error) {
      console.error("Could not save teacher lesson:", error);
      setFormError("Unable to save this lesson right now. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteLesson = async (lesson) => {
    const hasUnsavedChanges = isFormDirty && editingLessonId === lesson.id;
    const confirmed = window.confirm(
      `Delete "${lesson.title}"? This permanently removes the lesson and cannot be undone.${
        hasUnsavedChanges ? " Your unsaved edits will also be discarded." : ""
      }`,
    );
    if (!confirmed || deletingLessonId) return;

    setDeletingLessonId(lesson.id);
    setFormSuccess("");
    setActionError("");
    try {
      const response = await authenticatedFetch(
        user,
        `/api/lessons/${encodeURIComponent(lesson.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setActionError(await responseError(response, statusMessage(response.status)));
        return;
      }

      setLessons((current) => current.filter((item) => item.id !== lesson.id));
      if (editingLessonId === lesson.id) resetForm();
      setFormSuccess("Lesson deleted.");
    } catch (error) {
      console.error("Could not delete teacher lesson:", error);
      setActionError("Unable to delete this lesson right now. Please try again.");
    } finally {
      setDeletingLessonId("");
    }
  };

  const changePublication = async (lesson) => {
    if (publicationInFlight.current) return;
    setActionError("");
    setFormSuccess("");
    if (isFormDirty && editingLessonId === lesson.id) {
      setActionError(
        "Save or cancel your unsaved lesson changes before changing publication status.",
      );
      return;
    }

    const shouldPublish = lesson.status !== "published";
    if (shouldPublish) {
      const eligibilityError = validateLessonForPublication(lesson, teachingPairs);
      if (eligibilityError) {
        setActionError(eligibilityError);
        return;
      }
    }
    const wordCount = lessonWordCount(lesson.content.blocks);
    const shortLessonWarning =
      shouldPublish && wordCount < 15
        ? ` This lesson has ${wordCount} substantive word(s), below the 15-word quiz-generation minimum. It can still be published, but quiz generation will require more content.`
        : "";
    const actionLabel = shouldPublish ? "Publish" : "Unpublish";
    if (
      !window.confirm(
        `${actionLabel} "${lesson.title}"?${shortLessonWarning}`,
      )
    ) {
      return;
    }

    publicationInFlight.current = true;
    setPublishingLessonId(lesson.id);
    try {
      const response = await authenticatedFetch(
        user,
        `/api/lessons/${encodeURIComponent(lesson.id)}/${shouldPublish ? "publish" : "unpublish"}`,
        { method: "POST" },
      );
      if (!response.ok) {
        setActionError(
          await responseError(response, statusMessage(response.status)),
        );
        return;
      }
      const updatedLesson = await response.json();
      const expectedStatus = shouldPublish ? "published" : "draft";
      if (updatedLesson.id !== lesson.id || updatedLesson.status !== expectedStatus) {
        setActionError(
          "The server response did not confirm the requested publication status. Refresh the lesson list and try again.",
        );
        return;
      }

      setLessons((current) =>
        current.map((item) => (item.id === updatedLesson.id ? updatedLesson : item)),
      );
      setFormSuccess(
        shouldPublish ? "Lesson published." : "Lesson unpublished.",
      );
    } catch (error) {
      console.error(`Could not ${actionLabel.toLowerCase()} teacher lesson:`, error);
      setActionError(
        `Unable to ${actionLabel.toLowerCase()} this lesson right now. Please try again.`,
      );
    } finally {
      publicationInFlight.current = false;
      setPublishingLessonId("");
    }
  };

  if (authState !== "authorized") {
    const message = {
      checking: "Verifying teacher access...",
      unauthenticated: "Sign in to manage your lessons.",
      forbidden: "Teacher access is required to manage lessons.",
      error: "Your teacher account could not be verified. Please sign in again.",
    }[authState];
    return (
      <main className="teacher-lessons-access" aria-live="polite">
        <p role={authState === "error" ? "alert" : "status"}>{message}</p>
        {(authState === "unauthenticated" || authState === "error") && (
          <a href="/login">Go to sign in</a>
        )}
      </main>
    );
  }

  return (
    <PortalLayout
      role="teacher"
      pageClassName="page-teacher-lessons"
      title="Lessons"
      description="Create and manage your class lessons."
      navigation={<TeacherNavigation activePath="/teacher/lessons" />}
      headerAction={
        <button
          type="button"
          className="primary-button"
          disabled={!teachingPairs.length || Boolean(classesError)}
          onClick={startCreate}
        >
          Create lesson
        </button>
      }
    >
      {formSuccess && (
        <p className="lesson-notice success" role="status">
          {formSuccess}
        </p>
      )}
      {actionError && (
        <p className="lesson-notice error" role="alert">
          {actionError}
        </p>
      )}

      {classesError && (
        <div className="lesson-notice error" role="alert">
          <span>{classesError}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => refreshData(user)}
          >
            Retry
          </button>
        </div>
      )}
      {!classesError && !teachingPairs.length && !loading && (
        <p className="lesson-notice info">
          No active class and subject assignments are available for creating lessons.
        </p>
      )}

      {formMode && (
        <section className="lesson-editor-panel" aria-labelledby="lesson-editor-title">
          <header className="lesson-panel-header">
            <div>
              <h3 id="lesson-editor-title">
                {previewMode
                  ? "Lesson preview"
                  : formMode === "edit"
                    ? "Edit lesson"
                    : "Create lesson"}
              </h3>
              <p>
                {previewMode
                  ? "Student-facing content preview. Teacher-only information is not shown."
                  : "Saving preserves this lesson's current publication status."}
              </p>
            </div>
            <div className="lesson-row-actions">
              {previewMode ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPreviewMode(false)}
                >
                  Return to editing
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPreviewMode(true)}
                >
                  Preview as student
                </button>
              )}
              <button type="button" className="secondary-button" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </header>
          {previewMode ? (
            <article className="lesson-student-preview" aria-label="Student lesson preview">
              <p className="lesson-preview-label">
                Preview only · {formMode === "edit" ? "Current saved status: " : ""}
                {formMode === "edit"
                  ? lessons.find((lesson) => lesson.id === editingLessonId)?.status ?? "draft"
                  : "Not saved"}
              </p>
              <h1>{title.trim() || "Untitled lesson"}</h1>
              <p className="lesson-preview-topic">{topic.trim() || "No topic entered"}</p>
              <dl className="lesson-preview-metadata">
                <div>
                  <dt>Class</dt>
                  <dd>{selectedClass ? classLabel(selectedClass) : "Not selected"}</dd>
                </div>
                <div>
                  <dt>Subject</dt>
                  <dd>
                    {selectedSubjects.find((subject) => subject.id === subjectId)?.name ||
                      selectedSubjects.find((subject) => subject.id === subjectId)?.code ||
                      "Not selected"}
                  </dd>
                </div>
              </dl>
              {lessonWordCount(blocks) < 15 && (
                <p className="lesson-notice info" role="note">
                  This lesson is below the 15-word quiz-generation minimum. It can still be published, but quiz generation will require more content.
                </p>
              )}
              <div className="lesson-preview-content">
                {!hasLessonText(blocks) ? (
                  <p className="lesson-preview-empty">
                    No lesson content has been entered yet.
                  </p>
                ) : (
                  blocks.map((block, index) => {
                    if (block.type === "heading") {
                      const Heading = `h${Math.min(3, Math.max(1, block.level || 1))}`;
                      return <Heading key={`preview-${index}`}>{block.text}</Heading>;
                    }
                    if (block.type === "bullet_list") {
                      return (
                        <ul key={`preview-${index}`}>
                          {block.items.filter((item) => item.trim()).map((item, itemIndex) => (
                            <li key={`preview-${index}-${itemIndex}`}>{item}</li>
                          ))}
                        </ul>
                      );
                    }
                    return <p key={`preview-${index}`}>{block.text}</p>;
                  })
                )}
              </div>
            </article>
          ) : (
          <form className="lesson-editor-form" onSubmit={saveLesson} noValidate>
            <div className="lesson-metadata-fields">
              <label className="lesson-form-field">
                Title
                <input
                  aria-label="Lesson title"
                  aria-invalid={Boolean(fieldErrors.title)}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                {fieldErrors.title && <span className="lesson-field-error">{fieldErrors.title}</span>}
              </label>
              <label className="lesson-form-field">
                Topic
                <input
                  aria-label="Lesson topic"
                  aria-invalid={Boolean(fieldErrors.topic)}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                />
                {fieldErrors.topic && <span className="lesson-field-error">{fieldErrors.topic}</span>}
              </label>
              <label className="lesson-form-field">
                Class
                <select
                  aria-label="Lesson class"
                  value={classId}
                  onChange={(event) => changeClass(event.target.value)}
                >
                  <option value="">Select a class</option>
                  {classes.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.id}>
                      {classLabel(schoolClass)}
                    </option>
                  ))}
                </select>
                {fieldErrors.class_id && <span className="lesson-field-error">{fieldErrors.class_id}</span>}
              </label>
              <label className="lesson-form-field">
                Subject
                <select
                  aria-label="Lesson subject"
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  disabled={!selectedSubjects.length}
                >
                  <option value="">Select a subject</option>
                  {selectedSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name || subject.code || subject.id}
                    </option>
                  ))}
                </select>
                {fieldErrors.subject_id && <span className="lesson-field-error">{fieldErrors.subject_id}</span>}
              </label>
            </div>

            <section className="lesson-import-panel" aria-labelledby="lesson-import-title">
              <div>
                <h4 id="lesson-import-title">Import text from a file</h4>
                <p>
                  Import TXT (2 MiB max) or selectable PDF text (20 MiB, 100 pages max).
                  Scanned PDFs require manual text entry; OCR is not supported.
                </p>
              </div>
              <div className="lesson-import-controls">
                <label className="lesson-form-field">
                  TXT file
                  <input
                    aria-label="TXT file to import"
                    type="file"
                    accept=".txt,text/plain"
                    onChange={(event) => selectImportFile("txt", event.target.files?.[0])}
                  />
                </label>
                <label className="lesson-form-field">
                  PDF file
                  <input
                    aria-label="PDF file to import"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(event) => selectImportFile("pdf", event.target.files?.[0])}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={importLessonText}
                  disabled={!importFile || importing || saving}
                >
                  {importing ? "Extracting..." : "Preview import"}
                </button>
              </div>
              {importing && <p role="status">Extracting file text...</p>}
              {importError && <p className="lesson-field-error" role="alert">{importError}</p>}
              {importMessage && <p className="lesson-notice info" role="status">{importMessage}</p>}
              {importPreview !== "" && (
                <div className="lesson-import-preview">
                  <label className="lesson-form-field">
                    Extracted text preview (editable)
                    <textarea
                      aria-label="Extracted text preview"
                      rows={10}
                      maxLength={MAX_IMPORTED_TEXT_LENGTH}
                      value={importPreview}
                      onChange={(event) => setImportPreview(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={applyImportPreview}
                  >
                    Use imported text
                  </button>
                </div>
              )}
            </section>

            <div className="lesson-block-list-heading">
              <div>
                <h4>Lesson content</h4>
                <p>Arrange headings, paragraphs, and bullet lists in reading order.</p>
              </div>
              <div className="lesson-add-block-actions" aria-label="Add content block">
                <button type="button" className="secondary-button" onClick={() => addBlock("heading")}>
                  Add heading
                </button>
                <button type="button" className="secondary-button" onClick={() => addBlock("paragraph")}>
                  Add paragraph
                </button>
                <button type="button" className="secondary-button" onClick={() => addBlock("bullet_list")}>
                  Add bullet list
                </button>
              </div>
            </div>
            {fieldErrors.blocks && (
              <p className="lesson-field-error" role="alert">
                {fieldErrors.blocks}
              </p>
            )}
            <div className="lesson-content-blocks">
              {blocks.map((block, index) => (
                <LessonBlockEditor
                  block={block}
                  index={index}
                  key={`block-${index}`}
                  total={blocks.length}
                  onChange={changeBlock}
                  onMove={moveBlock}
                  onRemove={removeBlock}
                />
              ))}
            </div>

            {formError && (
              <p className="lesson-notice error" role="alert">
                {formError}
              </p>
            )}
            <footer className="lesson-form-actions">
              <button type="button" className="secondary-button" onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Saving..." : formMode === "edit" ? "Save changes" : "Save as draft"}
              </button>
            </footer>
          </form>
          )}
        </section>
      )}

      <section className="lesson-list-panel" aria-labelledby="lesson-list-title">
        <header className="lesson-panel-header">
          <div>
            <h3 id="lesson-list-title">Your lessons</h3>
            <p>Only lessons you are currently authorized to manage are listed.</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => refreshData(user)}
            disabled={loading}
          >
            Refresh
          </button>
        </header>

        {loading ? (
          <div className="lesson-list-state" role="status">
            Loading your lessons...
          </div>
        ) : lessonsError ? (
          <div className="lesson-list-state error" role="alert">
            <p>{lessonsError}</p>
            <button type="button" className="secondary-button" onClick={() => refreshData(user)}>
              Retry
            </button>
          </div>
        ) : lessons.length === 0 ? (
          <div className="lesson-list-state">
            <p>You have not created any accessible lessons yet.</p>
            {teachingPairs.length > 0 && (
              <button type="button" className="primary-button" onClick={startCreate}>
                Create your first lesson
              </button>
            )}
          </div>
        ) : (
          <div className="lesson-table-wrap">
            <table className="lesson-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Topic</th>
                  <th scope="col">Class</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => {
                  const pair = teachingPairs.find(
                    (item) =>
                      item.class_id === lesson.class_id &&
                      item.subject_id === lesson.subject_id,
                  );
                  return (
                    <tr key={lesson.id}>
                      <td data-label="Title">{lesson.title}</td>
                      <td data-label="Topic">{lesson.topic}</td>
                      <td data-label="Class">
                        {pair?.class_label || lesson.class_id || "Unavailable"}
                      </td>
                      <td data-label="Subject">
                        {pair?.subject_label || lesson.subject_id || "Unavailable"}
                      </td>
                      <td data-label="Status">
                        <span className={`lesson-status-badge ${lesson.status}`}>
                          {lesson.status}
                        </span>
                      </td>
                      <td data-label="Actions">
                        <div className="lesson-row-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => startEdit(lesson, true)}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => startEdit(lesson)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={lesson.status === "published" ? "secondary-button" : "primary-button"}
                            disabled={
                              publishingLessonId === lesson.id ||
                              deletingLessonId === lesson.id
                            }
                            onClick={() => changePublication(lesson)}
                          >
                            {publishingLessonId === lesson.id
                              ? lesson.status === "published"
                                ? "Unpublishing..."
                                : "Publishing..."
                              : lesson.status === "published"
                                ? "Unpublish"
                                : "Publish"}
                          </button>
                          <button
                            type="button"
                            className="lesson-delete-button"
                            disabled={
                              deletingLessonId === lesson.id ||
                              publishingLessonId === lesson.id
                            }
                            onClick={() => deleteLesson(lesson)}
                          >
                            {deletingLessonId === lesson.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PortalLayout>
  );
}
