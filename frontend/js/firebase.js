import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAw2djEMWVZe2TQio04fYyh7fMt8zmVdig",
  authDomain: "ama-lms.firebaseapp.com",
  projectId: "ama-lms",
  storageBucket: "ama-lms.firebasestorage.app",
  messagingSenderId: "194680373686",
  appId: "1:194680373686:web:9a92c7818645b7b4fb8117",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);