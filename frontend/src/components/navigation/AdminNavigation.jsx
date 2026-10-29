import React from "react";

const links = [
  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Users", path: "/admin/users" },
  { label: "Teachers", path: "/admin/teachers" },
  { label: "Classes", path: "/admin/classes" },
  { label: "Subjects", path: "/admin/subjects" },
  { label: "Settings", path: "/admin/settings" },
];

export default function AdminNavigation({ activePath }) {
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
