import React from "react";

export default function UserAccountDialog({
  isOpen,
  editingUser,
  form,
  createError,
  isSubmitting,
  grades,
  editingRoleLabel,
  onClose,
  onFormChange,
  onCreate,
  onEdit,
}) {
  return (
    <div
      id="create-user-modal"
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
        aria-labelledby="create-user-title"
      >
        <div className="modal-header">
          <div>
            <h3 id="create-user-title">
              {editingUser ? "Edit Account" : "Create Account"}
            </h3>
            <p>
              {editingUser
                ? `Update ${editingRoleLabel.toLowerCase()} account details.`
                : "Create a student or teacher account."}
            </p>
          </div>
          <button
            type="button"
            id="close-create-user-modal"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <form
          id="create-user-form"
          onSubmit={editingUser ? onEdit : onCreate}
        >
          {createError && (
            <div className="form-message error" role="alert">
              {createError}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="user-role">Role</label>
            <select
              id="user-role"
              name="role"
              value={form.role}
              onChange={onFormChange}
              required
              disabled={Boolean(editingUser)}
            >
              <option value="">Select role</option>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="user-name">Full Name</label>
            <input
              type="text"
              id="user-name"
              name="name"
              placeholder="Enter full name"
              value={form.name}
              onChange={onFormChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="user-email">Email</label>
            <input
              type="email"
              id="user-email"
              name="email"
              placeholder="Enter email"
              value={form.email}
              onChange={onFormChange}
              required
            />
          </div>

          {form.role === "student" && (
            <div id="student-fields">
              <div className="form-group">
                <label htmlFor="student-id">Student ID</label>
                <input
                  type="text"
                  id="student-id"
                  name="student_id"
                  placeholder="Enter student ID"
                  value={form.student_id}
                  onChange={onFormChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="grade-level">Grade Level</label>
                <select
                  id="grade-level"
                  name="grade_level"
                  value={form.grade_level}
                  onChange={onFormChange}
                  required
                >
                  <option value="">Select grade level</option>
                  {grades.map((grade) => (
                    <option value={grade} key={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="student-section">Section</label>
                <input
                  type="text"
                  id="student-section"
                  name="section"
                  placeholder="Enter section"
                  value={form.section}
                  onChange={onFormChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="student-sex">Sex</label>
                <select
                  id="student-sex"
                  name="sex"
                  value={form.sex}
                  onChange={onFormChange}
                  required
                >
                  <option value="">Select</option>
                  <option value="boy">Boy</option>
                  <option value="girl">Girl</option>
                </select>
              </div>
            </div>
          )}

          {form.role === "teacher" && (
            <div id="teacher-fields">
              <div className="form-group">
                <label htmlFor="employee-id">Employee ID</label>
                <input
                  type="text"
                  id="employee-id"
                  name="employee_id"
                  placeholder="Enter employee ID"
                  value={form.employee_id}
                  onChange={onFormChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="department-subject">
                  Department / Subject
                </label>
                <input
                  type="text"
                  id="department-subject"
                  name="department_subject"
                  placeholder="Enter department or subject"
                  value={form.department_subject}
                  onChange={onFormChange}
                  required
                />
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="cancel-create-user"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="submit-create-user"
              className="primary-button"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? editingUser
                  ? "Saving..."
                  : "Creating..."
                : editingUser
                  ? "Save Changes"
                  : "Create Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
