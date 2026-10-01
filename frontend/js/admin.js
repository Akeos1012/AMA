import { auth } from "./firebase.js";
import { onAuthStateChanged, getIdTokenResult } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace("../login.html");
        return;
    }

    try {
        const tokenResult = await getIdTokenResult(user, true);
        const role = tokenResult.claims.role;

        if (role !== "admin") {
            window.location.replace("../login.html?notice=unconfigured");
        }
    } catch (error) {
        console.error("Admin authentication check failed:", error);
        window.location.replace("../login.html");
    }
});