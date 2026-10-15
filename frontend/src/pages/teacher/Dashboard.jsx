import React from "react";
import PortalLayout from "../../components/PortalLayout.jsx";
import TeacherNavigation from "../../components/navigation/TeacherNavigation.jsx";

const cards = [
  ["Classes", "0", "Active classes"],
  ["Students", "0", "Total students"],
  ["Lessons", "0", "Created lessons"],
  ["Quizzes", "0", "Created quizzes"],
];

export default function TeacherDashboard() {
  return (
    <PortalLayout
      role="teacher"
      title="Teacher Dashboard"
      description="Welcome back, Teacher"
      navigation={<TeacherNavigation activePath="/teacher/dashboard" />}
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
