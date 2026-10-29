import React from "react";

export default function SubjectFormDialog({
  isOpen,
  editingSubjectId,
  form,
  formError,
  isSaving,
  selectableTeachers,
  gradeLevels,
  onClose,
  onSubmit,
  onFormChange,
  onToggleSelection,
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
        aria-labelledby="subject-dialog-heading"
      >
        <div className="modal-header">
          <div>
            <h3 id="subject-dialog-heading">
              {editingSubjectId ? "Edit Subject" : "Add Subject"}
            </h3>
            <p>
              Teacher eligibility for a subject is separate from section
              assignments.
            </p>
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

        <form className="subject-form" onSubmit={onSubmit}>
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
              onChange={onFormChange}
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
              onChange={onFormChange}
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
              onChange={onFormChange}
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
                    onChange={() => onToggleSelection("grade_levels", grade)}
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
              onChange={onFormChange}
              required
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <fieldset className="subject-checkbox-group subject-teacher-options">
            <legend>Subject-Eligible Teachers</legend>
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
                          onToggleSelection("teacher_ids", teacher.id)
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
              onClick={onClose}
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
  );
}
