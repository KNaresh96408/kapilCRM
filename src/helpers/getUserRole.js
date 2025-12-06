// src/helpers/getUserRole.js

import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

/**
 * Loads the user role only AFTER Firebase Auth is ready.
 */
export const getUserRoleFromDB = () => {
  const auth = getAuth();

  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.warn("⚠️ No authenticated user.");
        return resolve(null); // <= IMPORTANT
      }

      const uid = user.uid;

      try {
        const userRef = doc(db, "Users", uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          return resolve(null);
        }

        const data = snap.data();

        resolve({
          role: (data.role || "").toLowerCase(),
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
          user: data,
        });

      } catch (err) {
        console.error("❌ Error loading role:", err);
        resolve(null);
      }
    });
  });
};
