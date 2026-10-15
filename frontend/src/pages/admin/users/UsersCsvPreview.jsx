import React from "react";

export default function UsersCsvPreview({ preview, onClose }) {
  return (
    <div
      className={`modal-overlay${preview ? " active" : ""}`}
      aria-hidden={!preview}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {preview && (
        <section
          className="modal users-csv-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-csv-title"
        >
          <div className="modal-header">
            <div>
              <h3 id="users-csv-title">Student CSV Preview</h3>
              <p>{preview.fileName}</p>
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
          <div className="users-csv-content">
            <p className="users-csv-notice" role="status">
              Preview only: bulk account creation is not available, and no
              accounts have been created. Use Create Account to create
              accounts individually.
            </p>
            {preview.errors.length > 0 && (
              <div className="users-csv-errors" role="alert">
                <strong>
                  Fix {preview.errors.length} validation issue
                  {preview.errors.length === 1 ? "" : "s"} before using this
                  data:
                </strong>
                <ul>
                  {preview.errors.map((error, index) => (
                    <li key={`${index}-${error}`}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="users-table-wrap users-csv-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Grade</th>
                    <th>Section</th>
                    <th>Sex</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.student_id}-${index}`}>
                      <td>{row.student_id || "—"}</td>
                      <td>{row.name || "—"}</td>
                      <td>{row.email || "—"}</td>
                      <td>{row.grade_level || "—"}</td>
                      <td>{row.section || "—"}</td>
                      <td>{row.sex || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Close Preview
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
