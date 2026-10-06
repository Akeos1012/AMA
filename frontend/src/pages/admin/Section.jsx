import React from "react";
import SectionPage from "../../components/SectionPage.jsx";
import AdminNavigation from "../../components/navigation/AdminNavigation.jsx";
import "../../styles/admin.css";

const sectionByPath = {
  "/admin/classes": "Classes",
  "/admin/subjects": "Subjects",
  "/admin/settings": "Settings",
};

export default function AdminSection() {
  const activePath = window.location.pathname.replace(/\/+$/, "");
  const title = sectionByPath[activePath] ?? "Admin";

  return (
    <SectionPage
      role="admin"
      title={title}
      navigation={<AdminNavigation activePath={activePath} />}
    />
  );
}
