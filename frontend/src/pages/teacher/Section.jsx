import React from "react";
import SectionPage from "../../components/SectionPage.jsx";
import TeacherNavigation from "../../components/navigation/TeacherNavigation.jsx";
import "../../styles/teacher.css";

const sectionByPath = {
  "/teacher/lessons": "Lessons",
  "/teacher/quizzes": "Quizzes",
  "/teacher/reports": "Reports",
};

export default function TeacherSection() {
  const activePath = window.location.pathname.replace(/\/+$/, "");
  const title = sectionByPath[activePath] ?? "Teacher";

  return (
    <SectionPage
      role="teacher"
      title={title}
      navigation={<TeacherNavigation activePath={activePath} />}
    />
  );
}
