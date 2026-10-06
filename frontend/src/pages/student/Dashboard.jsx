import React from "react";
import PortalLayout from "../../components/PortalLayout.jsx";
import StudentNavigation from "../../components/navigation/StudentNavigation.jsx";
import "../../styles/student.css";

const cards = [
  ["Lessons", "0", "Available lessons"],
  ["Quizzes", "0", "Available quizzes"],
  ["Completed", "0", "Completed quizzes"],
  ["Average Score", "0%", "Quiz performance"],
];

export default function StudentDashboard() {
  return (
    <PortalLayout
      role="student"
      title="Student Dashboard"
      description="Welcome back, Student"
      navigation={<StudentNavigation activePath="/student/dashboard" />}
    >
      <section className="dashboard-cards">
        {cards.map(([title, value, description]) => (
          <div className="dashboard-card" key={title}>
            <h3>{title}</h3>
            <p>{value}</p>
            <span>{description}</span>
          </div>
        ))}
      </section>

      <section className="dashboard-section">
        <div className="section-header">
          <h3>Recent Activity</h3>
        </div>
        <div className="empty-state">
          <p>No recent activity.</p>
        </div>
      </section>
    </PortalLayout>
  );
}
