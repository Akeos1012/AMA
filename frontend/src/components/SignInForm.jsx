import React, { useState } from "react";
import signinImage from "../../assets/images/signin-bg.jpg";
import {
  auth,
  getIdTokenResult,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "../services/firebase.js";
import "./SignInForm.css";

const routeByRole = {
  admin: "/admin/dashboard",
  student: "/student/dashboard",
  teacher: "/teacher/dashboard",
};

function PasswordVisibilityIcon({ isVisible }) {
  return (
    <svg
      aria-hidden="true"
      className="password-visibility-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {isVisible ? (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      ) : (
        <>
          <path d="m3 3 18 18" />
          <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.3 18.3 0 0 1-3.1 3.7" />
          <path d="M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.4-.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      )}
    </svg>
  );
}

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
  const [isResetting, setIsResetting] = useState(false);

  function getAuthErrorMessage(error) {
    if (error.code === "auth/invalid-credential") {
      return "The email or password is incorrect.";
    }
    if (error.code === "auth/user-disabled") {
      return "This account is disabled. Please contact your school administrator.";
    }
    if (error.code === "auth/too-many-requests") {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (error.code === "auth/network-request-failed") {
      return "We could not connect to the login service. Check your connection and try again.";
    }
    return "We could not sign you in. Please try again.";
  }

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

      console.log("Signed-in email:", user.email);
      console.log("Firebase role claim:", tokenResult.claims.role);

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
      setMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setMessage("Enter your personal email address to receive a password reset link.");
      return;
    }

    setMessage("");
    setIsResetting(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setMessage("If an account exists for this email, password-reset instructions have been sent.");
    } catch (error) {
      setMessage(
        error.code === "auth/invalid-email"
          ? "Enter a valid email address before requesting a reset."
          : "We could not send reset instructions. Please try again or contact your school administrator.",
      );
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <main className="signin-page">
      <section className="signin-panel">
        <div className="signin-header">
          <h1>AMA LMS</h1>
          <p>Learn today, innovate tomorrow!</p>
          <p>Your learning adventure starts here.</p>
        </div>

        <form id="signin-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="form-group password-group">
            <label htmlFor="password">Password</label>
            <div className="password-input-wrap">
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
              >
                <PasswordVisibilityIcon isVisible={showPassword} />
              </button>
            </div>
          </div>

          <button
            type="submit"
            id="signin-button"
            disabled={isSubmitting || isResetting}
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>

          <button
            type="button"
            className="forgot-password-button"
            onClick={handlePasswordReset}
            disabled={isSubmitting || isResetting}
          >
            {isResetting ? "Sending reset link..." : "Forgot password?"}
          </button>

          <p id="signin-message" role="alert">
            {message}
          </p>
        </form>

        <p className="signin-help">
          Need an account? Contact your school administrator.
        </p>
      </section>

      <section className="signin-image">
        <img src={signinImage} alt="AMA LMS" />
      </section>
    </main>
  );
}
