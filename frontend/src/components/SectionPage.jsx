import React from "react";
import PortalLayout from "./PortalLayout.jsx";

export default function SectionPage({ role, title, navigation }) {
  return (
    <PortalLayout
      role={role}
      title={title}
      description={`Manage ${title.toLowerCase()}.`}
      navigation={navigation}
    >
      <section className="dashboard-section">
        <div className="empty-state">
          <p>This section is not available yet.</p>
        </div>
      </section>
    </PortalLayout>
  );
}
