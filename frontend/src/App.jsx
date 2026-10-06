import React, { lazy, Suspense, useEffect, useState } from "react";

const routes = {
  "/": lazy(() => import("./pages/Landing.jsx")),
  "/login": lazy(() => import("./pages/Login.jsx")),
  "/admin/dashboard": lazy(() => import("./pages/admin/Dashboard.jsx")),
  "/admin/users": lazy(() => import("./pages/admin/Users.jsx")),
  "/admin/classes": lazy(() => import("./pages/admin/Classes.jsx")),
  "/admin/subjects": lazy(() => import("./pages/admin/Subjects.jsx")),
  "/admin/settings": lazy(() => import("./pages/admin/Section.jsx")),
  "/teacher/dashboard": lazy(() => import("./pages/teacher/Dashboard.jsx")),
  "/teacher/lessons": lazy(() => import("./pages/teacher/Section.jsx")),
  "/teacher/quizzes": lazy(() => import("./pages/teacher/Section.jsx")),
  "/teacher/reports": lazy(() => import("./pages/teacher/Section.jsx")),
  "/student/dashboard": lazy(() => import("./pages/student/Dashboard.jsx")),
  "/student/lessons": lazy(() => import("./pages/student/Section.jsx")),
  "/student/quizzes": lazy(() => import("./pages/student/Section.jsx")),
  "/student/results": lazy(() => import("./pages/student/Section.jsx")),
};

export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    function updatePathname() {
      setPathname(window.location.pathname);
    }

    window.addEventListener("popstate", updatePathname);
    return () => window.removeEventListener("popstate", updatePathname);
  }, []);

  const normalizedPath =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
const Page = routes[normalizedPath] ?? routes["/"];

  return (
    <Suspense fallback={<p>Loading AMA LMS...</p>}>
      <Page />
    </Suspense>
  );
}
