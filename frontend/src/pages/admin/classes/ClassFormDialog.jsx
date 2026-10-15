import React from "react";

export default function ClassFormDialog({
  isOpen,
  editingClassId,
  form,
  formError,
  classGrades,
  teachers,
  teachersLoading,
  teachersError,
  onClose,
  onFormChange,
  onSubmit,
}) {
  return (
    <div
      className={`modal-overlay${isOpen ? " active" : ""}`}
      aria-hidden={!isOpen}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <form className="class-form" onSubmit={onSubmit}>
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
              onChange={onFormChange}
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
              onChange={onFormChange}
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
              onChange={onFormChange}
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
              onChange={onFormChange}
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
              onClick={onClose}
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
  );
}
