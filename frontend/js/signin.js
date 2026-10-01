import { auth } from "./firebase.js";
import {
  getIdTokenResult,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const form = document.querySelector("#signin-form");
const message = document.querySelector("#signin-message");
const submitButton = document.querySelector("#signin-button");

if (form && message && submitButton) {
  const notice = new URLSearchParams(window.location.search).get("notice");

  if (notice === "admin") {
    message.textContent = "Admin access is not available in this MVP.";
    window.history.replaceState({}, "", window.location.pathname);
  } else if (notice === "unconfigured") {
    message.textContent =
      "Your account is not configured. Please contact your administrator.";
    window.history.replaceState({}, "", window.location.pathname);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    try {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      const tokenResult = await getIdTokenResult(user, true);
      const uid = user.uid;
      const idToken = tokenResult.token;
      const role = tokenResult.claims.role;

      if (!uid || !idToken) {
        throw new Error("Firebase did not return an authenticated identity.");
      }

      if (role === "student") {
        window.location.assign("student/student_dashboard.html");
      } else if (role === "teacher") {
        window.location.assign("teacher/teacher_dashboard.html");
      } else if (role === "admin") {
        window.location.assign("admin/admin_dashboard.html");
      } else {
        message.textContent =
          "Your account is not configured. Please contact your administrator.";
      }
    } catch (error) {
      message.textContent =
        error.code === "auth/invalid-credential"
          ? "Email or password is incorrect."
          : "Unable to sign in. Please try again.";
    } finally {
      submitButton.disabled = false;
    }
  });
}
