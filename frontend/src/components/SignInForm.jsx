import React, { useState } from "react";
import signinImage from "../../assets/images/signin-bg.jpg";
import {
  auth,
  getIdTokenResult,
  signInWithEmailAndPassword,
} from "../services/firebase.js";
import "../styles/signin.css";

const routeByRole = {
  admin: "/admin/dashboard",
  student: "/student/dashboard",
  teacher: "/teacher/dashboard",
};

export default function SignInForm({ variant = "login" }) {
  const isLanding = variant === "landing";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const notice = params.get("notice");
    if (!notice) return "";

    window.history.replaceState({}, "", window.location.pathname);
    if (notice === "admin") {
      return "Admin access is not available in this MVP.";
    }
    if (notice === "unconfigured") {
      return "Your account is not configured. Please contact your administrator.";
    }
    return "";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const { user } = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      const tokenResult = await getIdTokenResult(user, true);

      if (!user.uid || !tokenResult.token) {
        throw new Error("Firebase did not return an authenticated identity.");
      }

      const destination = routeByRole[tokenResult.claims.role];
      if (destination) {
        window.location.assign(destination);
      } else {
        setMessage(
          "Your account is not configured. Please contact your administrator.",
        );
      }
    } catch (error) {
      setMessage(
        error.code === "auth/invalid-credential"
          ? "Email or password is incorrect."
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="signin-page">
      <section className="signin-panel">
        <div className="signin-header">
          <h1>{isLanding ? "AMA LMS" : "Welcome Back"}</h1>
          <p>
            {isLanding
              ? "Learning Management System"
              : "Sign in to your AMA LMS account"}
          </p>
        </div>

        <form id="signin-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              placeholder="Enter your email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            id="signin-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in..." : isLanding ? "Sign In" : "Login"}
          </button>
          {isLanding && (
            <a href="/login" className="login-button">
              Login
            </a>
          )}

          <p id="signin-message" role="alert">
            {message}
          </p>
        </form>

        {!isLanding && (
          <a href="/" className="back-link">
            Back to Home
          </a>
        )}
      </section>

      <section className="signin-image">
        <img src={signinImage} alt="AMA LMS" />
      </section>
    </main>
  );
}
