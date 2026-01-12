// ---------------------------------------------------------
// Firebase Config + Initialization (Final Clean Version)
// ---------------------------------------------------------

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDU5NoZEXltxUNyzUMgEVBpCMQ2iwgSPs4",
  authDomain: "kapil-power-crm.firebaseapp.com",
  projectId: "kapil-power-crm",
  storageBucket: "kapil-power-crm.firebasestorage.app",   // ✅ Correct storage bucket
  messagingSenderId: "725025183223",
  appId: "1:725025183223:web:3f4d64e21ff1acd16e8af2",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Firestore DB
export const db = getFirestore(app);
export const storage = getStorage(app);

// Export Auth
export const auth = getAuth(app);

export default app;
