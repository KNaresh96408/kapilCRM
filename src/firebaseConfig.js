// ============================================================
// 🔥 Firebase Configuration for Kapil Power CRM
// ============================================================

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  serverTimestamp,
} from "firebase/firestore";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getStorage } from "firebase/storage";

// ============================================================
// ✅ Firebase Project Config (Kapil Power CRM)
// ============================================================
// ⚠️ Updated `storageBucket` to new .firebasestorage.app endpoint
const firebaseConfig = {
  apiKey: "AIzaSyDU5NoZEXltxUNyzUMgEVBpCMQ2iwgSPs4",
  authDomain: "kapil-power-crm.firebaseapp.com",
  projectId: "kapil-power-crm",
  storageBucket: "kapil-power-crm.firebasestorage.app", // ✅ FIXED
  messagingSenderId: "725025183223",
  appId: "1:725025183223:web:3f4d64e21ff1acd16e8af2",
};

// ============================================================
// 🚀 Initialize Firebase Services
// ============================================================

// App
const app = initializeApp(firebaseConfig);

// Firestore Database
const db = getFirestore(app);

// Authentication
const auth = getAuth(app);

// File Storage
const storage = getStorage(app, "gs://kapil-power-crm.firebasestorage.app"); // ✅ explicit reference to correct bucket

// ============================================================
// 🔒 Set Auth Persistence — keeps user logged in after refresh
// ============================================================
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log("✅ Firebase Auth persistence set to LOCAL (browser cache)");
  })
  .catch((error) => {
    console.error("❌ Failed to set auth persistence:", error);
  });

// ============================================================
// 🔍 Debug Helpers (Expose Firebase to Browser Console)
// ============================================================
if (typeof window !== "undefined") {
  window.__firebase = {
    app,
    auth,
    db,
    storage,
  };
}

// ============================================================
// 📤 Export Configured Services
// ============================================================
export { db, auth, storage, serverTimestamp };
export default app;
