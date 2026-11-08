import React from "react";

export default function TeacherClassGroup({ title, classGroup, isAdvisory }) {
  function renderClassCard(schoolClass, isAdvisory) {
    return (
      <article
        className="teacher-class-card"
        key={`${isAdvisory ? "advisory" : "subject"}-${schoolClass.id}`}
      >
        <div className="teacher-class-header">
          <div>
            <p className="teacher-class-kicker">
              {isAdvisory ? "Advisory Class" : "Subject Teaching"}
            </p>
            <h4>
              {schoolClass.grade_level || "Grade"} - {schoolClass.section || "Section"}
            </h4>
          </div>
          <div className="teacher-class-badges">
            {isAdvisory && (
              <span className="teacher-advisory-badge">Advisory Class</span>
            )}
            <span
              className={`teacher-class-status ${schoolClass.status || "active"}`}
            >
              {schoolClass.status || "active"}
            </span>
          </div>
        </div>

        <div className="teacher-class-meta">
          <div>
            <span>Active students</span>
            <strong>{Number(schoolClass.student_count || 0)}</strong>
          </div>
          <div>
            <span>Subjects you teach</span>
            <strong>
              {Array.isArray(schoolClass.assigned_subjects)
                ? schoolClass.assigned_subjects.length
                : 0}
            </strong>
          </div>
        </div>

        <div className="teacher-class-schedule">
          <h5>Subjects you teach</h5>
          {Array.isArray(schoolClass.assigned_subjects) &&
          schoolClass.assigned_subjects.length ? (
            <ul>
              {schoolClass.assigned_subjects.map((subject) => (
                <li key={subject.id}>
                  <span className="teacher-subject-code">
                    {subject.code || "SUBJ"}
                  </span>
                  <span>{subject.name || "Unnamed subject"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="teacher-class-empty">
              {isAdvisory
                ? "You are the primary adviser; no subject assignments are attached to your account for this class."
                : "No active subject assignments for this class."}
            </p>
          )}
        </div>

        {Array.isArray(schoolClass.students) &&
          schoolClass.students.length > 0 && (
            <div className="teacher-class-students">
              <h5>Students</h5>
              <ul>
                {schoolClass.students.slice(0, 5).map((student) => (
                  <li key={student.uid || student.name}>
                    {student.name || student.uid}
                  </li>
                ))}
              </ul>
              {schoolClass.students.length > 5 && (
                <p className="teacher-class-more">
                  +{schoolClass.students.length - 5} more students
                </p>
              )}
            </div>
          )}
      </article>
    );
  }

  function renderClassGroup(title, classGroup, isAdvisory) {
    return (
      <section
        className="teacher-class-group"
        aria-label={title}
        key={title}
      >
        <h4>{title}</h4>
        {classGroup.length ? (
          <div className="teacher-class-list">
            {classGroup.map((schoolClass) =>
              renderClassCard(schoolClass, isAdvisory),
            )}
          </div>
        ) : (
          <p className="teacher-class-group-empty">
            {isAdvisory
              ? "No advisory classes are assigned to you."
              : "No active subject-teaching classes are assigned to you."}
          </p>
        )}
      </section>
    );
  }

  return renderClassGroup(title, classGroup, isAdvisory);
}
