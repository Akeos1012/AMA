import React from "react";
import SectionPage from "../../components/SectionPage.jsx";
import StudentNavigation from "../../components/navigation/StudentNavigation.jsx";

const sectionByPath = {
  "/student/lessons": "Lessons",
  "/student/quizzes": "Quizzes",
  "/student/results": "Results",
};

export default function StudentSection() {
  const activePath = window.location.pathname.replace(/\/+$/, "");
  const title = sectionByPath[activePath] ?? "Student";

  return (
    <SectionPage
      role="student"
      title={title}
      navigation={<StudentNavigation activePath={activePath} />}
    />
  );
}
