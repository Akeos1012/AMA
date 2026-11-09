import React, { useEffect, useMemo, useState } from "react";

export default function ClassStudentsDialog({
  studentsClass,
  visibleStudents,
  availableStudents,
  accountsLoading,
  accountsError,
  isAssigningStudents,
  studentSearch,
  onStudentSearchChange,
  onClose,
  onCsvFile,
  onRemoveStudent,
  onAssignStudents,
  onRetryAccounts,
  studentMutationUid,
  csvPreview,
  csvErrors,
  onCloseCsvPreview,
  onImportCsv,
}) {
  const [isAddingStudents, setIsAddingStudents] = useState(false);
  const [availableSearch, setAvailableSearch] = useState("");
  const [selectedStudentUids, setSelectedStudentUids] = useState([]);
  const filteredAvailableStudents = useMemo(() => {
    const search = availableSearch.trim().toLowerCase();
    return availableStudents.filter((student) =>
      [student.name, student.studentId, student.email]
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  }, [availableSearch, availableStudents]);

  useEffect(() => {
    setIsAddingStudents(false);
    setAvailableSearch("");
    setSelectedStudentUids([]);
  }, [studentsClass?.id]);

  function toggleStudent(uid) {
    setSelectedStudentUids((current) =>
      current.includes(uid)
        ? current.filter((selectedUid) => selectedUid !== uid)
        : [...current, uid],
    );
  }

  function toggleAllStudents(checked) {
    setSelectedStudentUids((current) => {
      if (checked) {
        return [
          ...new Set([
            ...current,
            ...availableStudents.map((student) => student.uid),
          ]),
        ];
      }
      const availableUids = new Set(
        availableStudents.map((student) => student.uid),
      );
      return current.filter((uid) => !availableUids.has(uid));
    });
  }

  async function assignSelectedStudents() {
    if (!selectedStudentUids.length || isAssigningStudents) return;
    const result = await onAssignStudents(selectedStudentUids);
    const succeededUids = new Set(result?.succeededUids ?? []);
    setSelectedStudentUids((current) =>
      current.filter((uid) => !succeededUids.has(uid)),
    );
  }

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
                disabled={isAssigningStudents}
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
                {studentsClass.status === "Active" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={isAssigningStudents}
                    onClick={() => {
                      setIsAddingStudents(true);
                      setSelectedStudentUids([]);
                      setAvailableSearch("");
                    }}
                  >
                    Add Students
                  </button>
                )}
                <label className="secondary-button class-csv-picker">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={onCsvFile}
                  />
                </label>
              </div>
              {isAddingStudents && studentsClass.status === "Active" && (
                <section
                  className="class-add-students"
                  aria-labelledby="add-students-title"
                >
                  <div className="class-add-students-heading">
                    <div>
                      <h4 id="add-students-title">Add Students</h4>
                      <p>
                        {selectedStudentUids.length} student
                        {selectedStudentUids.length === 1 ? "" : "s"} selected
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isAssigningStudents}
                      onClick={() => {
                        setIsAddingStudents(false);
                        setSelectedStudentUids([]);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {accountsLoading ? (
                    <p role="status">Loading eligible student accounts...</p>
                  ) : accountsError ? (
                    <div className="class-add-students-error" role="alert">
                      <p>{accountsError}</p>
                      <button
                        type="button"
                        className="classes-retry-button"
                        onClick={onRetryAccounts}
                      >
                        Retry
                      </button>
                    </div>
                  ) : availableStudents.length ? (
                    <>
                      <input
                        type="search"
                        value={availableSearch}
                        onChange={(event) =>
                          setAvailableSearch(event.target.value)
                        }
                        placeholder="Search by name, student ID, or email"
                        aria-label="Search eligible students"
                      />
                      <label className="class-select-all-students">
                        <input
                          type="checkbox"
                          checked={
                            availableStudents.length > 0 &&
                            availableStudents.every((student) =>
                              selectedStudentUids.includes(student.uid),
                            )
                          }
                          onChange={(event) =>
                            toggleAllStudents(event.target.checked)
                          }
                          disabled={isAssigningStudents}
                        />
                        Select all eligible students
                      </label>
                      {filteredAvailableStudents.length ? (
                        <ul className="class-available-students">
                          {filteredAvailableStudents.map((student) => (
                            <li key={student.uid}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={selectedStudentUids.includes(
                                    student.uid,
                                  )}
                                  onChange={() => toggleStudent(student.uid)}
                                  disabled={isAssigningStudents}
                                />
                                <span>
                                  <strong>{student.name}</strong>
                                  <span>
                                    {student.studentId || "No student ID"}
                                    {student.email ? ` · ${student.email}` : ""}
                                  </span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="class-add-students-empty">
                          No eligible students match this search.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="class-add-students-empty">
                      No eligible students are available for this class.
                    </p>
                  )}
                  {!accountsLoading && !accountsError && (
                    <div className="class-add-students-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={assignSelectedStudents}
                        disabled={
                          isAssigningStudents || selectedStudentUids.length === 0
                        }
                      >
                        {isAssigningStudents
                          ? "Assigning..."
                          : "Confirm Assignment"}
                      </button>
                    </div>
                  )}
                </section>
              )}
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
                disabled={isAssigningStudents}
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
