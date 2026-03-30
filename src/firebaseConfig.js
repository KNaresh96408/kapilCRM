// src/firebaseConfig.js

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithCustomToken,
  onAuthStateChanged,
} from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

/* ================= FIREBASE CONFIG ================= */

const firebaseConfig = {
  apiKey: "AIzaSyDU5NoZEXltxUNyzUMgEVBpCMQ2iwgSPs4",
  authDomain: "kapil-power-crm.firebaseapp.com",
  projectId: "kapil-power-crm",
  storageBucket: "kapil-power-crm.firebasestorage.app",
  messagingSenderId: "725025183223",
  appId: "1:725025183223:web:3f4d64e21ff1acd16e8af2",
};

/* ================= APP INIT (ONCE ONLY) ================= */

// ✅ iOS / Android / Web safe (single Firebase app)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* ================= SINGLETON SERVICES ================= */

// ❗ NEVER call getAuth() anywhere else
const auth = getAuth(app);

// ❗ NEVER call getFirestore() anywhere else
let db;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false,
    ignoreUndefinedProperties: true,
  });
} catch (e) {
  // Firestore may already be initialized during hot reload.
  db = getFirestore(app);
}

// ❗ NEVER call getStorage() anywhere else
const storage = getStorage(app);

/* ================= EXPORTS ================= */

export {
  // core singletons
  auth,
  db,
  storage,

  // auth helpers (needed for iOS native → web sync)
  signInWithCustomToken,
  onAuthStateChanged,

  // firestore helpers
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
};

export default app;