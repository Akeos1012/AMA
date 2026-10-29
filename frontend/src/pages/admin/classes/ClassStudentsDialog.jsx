import React from "react";

export default function ClassStudentsDialog({
  studentsClass,
  visibleStudents,
  studentSearch,
  onStudentSearchChange,
  onClose,
  onCsvFile,
  onRemoveStudent,
  studentMutationUid,
  csvPreview,
  csvErrors,
  onCloseCsvPreview,
  onImportCsv,
}) {
  return (
    <>
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
                onClick={onClose}
              >
                &times;
              </button>
            </div>
            <div className="class-students-modal-content">
              <div className="class-students-toolbar">
                <input
                  type="search"
                  value={studentSearch}
                  onChange={onStudentSearchChange}
                  placeholder="Search students by ID or name"
                  aria-label="Search students"
                />
                <label className="secondary-button class-csv-picker">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={onCsvFile}
                  />
                </label>
              </div>
              <p className="class-demo-inline-note">
                Student memberships are managed in the school database.
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
                              disabled={studentMutationUid === student.uid}
                              onClick={() => onRemoveStudent(student)}
                            >
                              {studentMutationUid === student.uid
                                ? "Removing..."
                                : "Remove"}
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
                onClick={onClose}
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
                onClick={onCloseCsvPreview}
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
                onClick={onCloseCsvPreview}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={onImportCsv}
                disabled={!csvPreview.length || csvErrors.length > 0}
              >
                Import Students
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
