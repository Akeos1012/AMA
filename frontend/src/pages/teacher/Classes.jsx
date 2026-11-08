import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  auth,
  getIdTokenResult,
  onAuthStateChanged,
} from "../../services/firebase.js";
import { authenticatedFetch } from "../../services/api.js";
import PortalLayout from "../../components/PortalLayout.jsx";
import TeacherNavigation from "../../components/navigation/TeacherNavigation.jsx";
import TeacherClassGroup from "./classes/TeacherClassGroup.jsx";
import "./Classes.css";

export default function TeacherClasses() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teacherName, setTeacherName] = useState("Teacher");
  const [activeUser, setActiveUser] = useState(null);

  const loadTeacherClasses = useCallback(async (user) => {
    setLoading(true);
    setError("");

    try {
      const response = await authenticatedFetch(user, "/api/teacher/classes");
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status}).`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("The teacher class response was not a list.");
      }

      setClasses(data);
    } catch (loadError) {
      console.error("Could not load teacher classes:", loadError);
      setError("Unable to load your assigned classes right now. Please try again.");
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (!user) {
          window.location.replace("/login");
          return;
        }

        setActiveUser(user);

        try {
          const tokenResult = await getIdTokenResult(user, true);
          if (tokenResult.claims.role !== "teacher") {
            window.location.replace("/login?notice=unconfigured");
            return;
          }

          setTeacherName(
            tokenResult.claims.displayName || user.email || "Teacher",
          );
          await loadTeacherClasses(user);
        } catch (authError) {
          console.error("Teacher authentication check failed:", authError);
          setError("Your teacher account could not be verified. Please sign in again.");
          setLoading(false);
        }
      },
      (authFailure) => {
        console.error("Teacher authentication check failed:", authFailure);
        setError("Your teacher account could not be verified. Please sign in again.");
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [loadTeacherClasses]);

  const summary = useMemo(() => {
    const classIds = new Set();
    const studentUids = new Set();
    const subjectIds = new Set();

    for (const schoolClass of classes) {
      if (schoolClass.id) classIds.add(schoolClass.id);
      for (const student of schoolClass.students ?? []) {
        if (student.uid) studentUids.add(student.uid);
      }
      for (const subject of schoolClass.assigned_subjects ?? []) {
        if (subject.id) subjectIds.add(subject.id);
      }
    }

    return {
      totalClasses: classIds.size,
      totalStudents: studentUids.size,
      totalSubjects: subjectIds.size,
    };
  }, [classes]);

  const advisoryClasses = classes.filter((schoolClass) => schoolClass.is_adviser);
  const subjectClasses = classes.filter(
    (schoolClass) =>
      Array.isArray(schoolClass.assigned_subjects) &&
      schoolClass.assigned_subjects.length > 0,
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="empty-state">
          <p>Loading your assigned classes...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="empty-state teacher-empty-state">
          <div>
            <p>{error}</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => activeUser && loadTeacherClasses(activeUser)}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (!classes.length) {
      return (
        <div className="empty-state">
          <p>You are not assigned to any active classes yet.</p>
        </div>
      );
    }

    return (
      <div className="teacher-class-groups">
        <TeacherClassGroup
          title="Advisory Classes"
          classGroup={advisoryClasses}
          isAdvisory
        />
        <TeacherClassGroup
          title="Subject-Teaching Classes"
          classGroup={subjectClasses}
          isAdvisory={false}
        />
      </div>
    );
  };

  return (
    <PortalLayout
      role="teacher"
      pageClassName="page-teacher-classes"
      title="My Classes"
      description={
        loading
          ? "Loading your class assignments..."
          : `Welcome back, ${teacherName}`
      }
      navigation={<TeacherNavigation activePath="/teacher/classes" />}
    >
      <section className="dashboard-cards">
        <div className="dashboard-card">
          <h3>Classes</h3>
          <p>{summary.totalClasses}</p>
          <span>Assigned sections</span>
        </div>
        <div className="dashboard-card">
          <h3>Students</h3>
          <p>{summary.totalStudents}</p>
          <span>Total students</span>
        </div>
        <div className="dashboard-card">
          <h3>Subjects</h3>
          <p>{summary.totalSubjects}</p>
          <span>Assigned subjects</span>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-header">
          <h3>My Teaching Assignments</h3>
        </div>
        {renderContent()}
      </section>
    </PortalLayout>
  );
}
