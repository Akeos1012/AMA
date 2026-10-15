import React from "react";

export default function ClassScheduleDialog({
  selectedClass,
  editingScheduleId,
  scheduleError,
  scheduleForm,
  weekdays,
  teachers,
  subjects,
  onClose,
  onSave,
  onFormChange,
  getScheduleSubjects,
  getTeacherName,
}) {
  if (!selectedClass) return null;

  return (
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
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <form className="class-form" onSubmit={onSave}>
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
              onChange={onFormChange}
            >
              {weekdays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
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
                onChange={onFormChange}
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
                onChange={onFormChange}
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
              onChange={onFormChange}
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
              onChange={onFormChange}
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
              onClick={onClose}
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
  );
}
