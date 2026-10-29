import React from "react";

const links = [
  { label: "Dashboard", path: "/teacher/dashboard" },
  { label: "My Classes", path: "/teacher/classes" },
  { label: "Lessons", path: "/teacher/lessons" },
  { label: "Quizzes", path: "/teacher/quizzes" },
  { label: "Reports", path: "/teacher/reports" },
];

export default function TeacherNavigation({ activePath }) {
  return (
    <nav className="sidebar-nav">
      {links.map((link) => (
        <a
          href={link.path}
          className={`nav-link${activePath === link.path ? " active" : ""}`}
          aria-current={activePath === link.path ? "page" : undefined}
          key={link.path}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
