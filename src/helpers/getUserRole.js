// src/helpers/getUserRole.js

import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

/**
 * Loads the user role using Firebase Web Auth (safe for Web, Android, iOS).
 */
export const getUserRoleFromDB = async () => {
    const user = auth.currentUser;

    if (!user) {
      console.warn("⚠️ No authenticated user.");
      return null;
    }

    const uid = user.uid;

    // ⚠️ Use SAME collection name everywhere (case-sensitive!)
    try {
      const userRef = doc(db, "Users", uid);
      const getPromise = getDoc(userRef);
      const snap = await Promise.race([
        getPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('user fetch timeout')), 2500)),
      ]);

      if (snap && snap.exists && snap.exists()) {
        const data = snap.data();
        return {
          role: (data.role || "").toLowerCase(),
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
          user: data,
        };
      }

      // If not found locally, try REST fallback using local idToken
      const stored = localStorage.getItem('kp-user');
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        try {
          const { fetchDocumentREST } = await import('./firestoreRest');
          const rest = await fetchDocumentREST(`Users/${uid}`, token);
          return {
            role: (rest.role || rest.Role || '').toLowerCase(),
            permissions: Array.isArray(rest.permissions) ? rest.permissions : [],
            user: rest,
          };
        } catch (restErr) {
          console.warn('⚠️ getUserRole REST fetch failed', restErr && (restErr.message || restErr));
        }
      }

      console.warn("⚠️ User document not found.");
      return null;
    } catch (err) {
      console.error("❌ Error loading role:", err);
      return null;
    }
};