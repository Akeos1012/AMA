import React from "react";

const links = [
  { label: "Dashboard", path: "/student/dashboard" },
  { label: "Lessons", path: "/student/lessons" },
  { label: "Quizzes", path: "/student/quizzes" },
  { label: "Results", path: "/student/results" },
];

export default function StudentNavigation({ activePath }) {
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
