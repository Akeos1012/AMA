const signinForm = document.getElementById("signin-form");

signinForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const message = document.getElementById("signin-message");

    if (!email || !password) {
        message.textContent = "Please enter your email and password.";
        return;
    }

    /*
     * TEMPORARY ROLE CHECK
     *
     * This is only for frontend testing.
     * Firebase Authentication + Firestore will replace this later.
     */

    if (email.toLowerCase().includes("teacher")) {
        window.location.href = "teacher_dashboard.html";
        return;
    }

    window.location.href = "student_dashboard.html";
});