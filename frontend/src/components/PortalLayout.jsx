import React from "react";
import "./PortalLayout.css";
import "./navigation/SidebarNavigation.css";

export default function PortalLayout({
  role,
  pageClassName,
  title,
  description,
  headerAction,
  navigation,
  children,
}) {
  return (
    <div
      className={`dashboard dashboard-${role}${pageClassName ? ` ${pageClassName}` : ""}`}
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>AMA LMS</h1>
          <p>{role[0].toUpperCase() + role.slice(1)} Portal</p>
        </div>

        {navigation}

        <div className="sidebar-footer">
          <a href="/" className="logout-link">
            Logout
          </a>
        </div>
      </aside>

      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {headerAction}
        </header>
        {children}
      </main>
    </div>
  );
}
