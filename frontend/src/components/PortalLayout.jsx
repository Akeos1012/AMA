import React from "react";
import { auth, signOut } from "../services/firebase.js";
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
  async function handleLogout() {
    try {
      await signOut(auth);
      window.location.replace("/login");
    } catch (error) {
      console.error("Could not sign out:", error);
    }
  }

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
          <button type="button" className="logout-link" onClick={handleLogout}>
            Logout
          </button>
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
