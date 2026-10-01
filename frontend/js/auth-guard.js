import { auth } from "./firebase.js";
import { getIdTokenResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const dashboardPaths = {
  student: "../student/student_dashboard.html",
  teacher: "../teacher/teacher_dashboard.html",
};

function waitForUser() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

export async function requireRole(requiredRole) {
  try {
    const user = await waitForUser();
    if (!user) {
      window.location.replace("../login.html");
      return null;
    }

    const tokenResult = await getIdTokenResult(user);
    const idToken = tokenResult.token;
    const role = tokenResult.claims.role;

    if (!user.uid || !idToken || !["student", "teacher", "admin"].includes(role)) {
      window.location.replace("../login.html?notice=unconfigured");
      return null;
    }

    if (role !== requiredRole) {
      const destination = role === "admin"
        ? "../login.html?notice=admin"
        : dashboardPaths[role];
      window.location.replace(destination);
      return null;
    }

    return { user, uid: user.uid, idToken, role };
  } catch {
    window.location.replace("../login.html");
    return null;
  }
}