import { db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export async function getUserNameFromDB(uid) {
  try {
    const ref = doc(db, "Users", uid);
    const getPromise = getDoc(ref);
    const snap = await Promise.race([
      getPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('user fetch timeout')), 2500)),
    ]);

    if (snap && snap.exists && snap.exists()) {
      return (
        snap.data().Name ||      // FIX: Firestore uses "Name"
        snap.data().name ||
        snap.data().displayName ||
        ""
      );
    }

    // Try REST fallback
    try {
      const stored = localStorage.getItem('kp-user');
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        const { fetchDocumentREST } = await import('./firestoreRest');
        const rest = await fetchDocumentREST(`Users/${uid}`, token);
        return rest.Name || rest.name || rest.displayName || '';
      }
    } catch (restErr) {
      console.warn('getUserNameFromDB REST fetch failed', restErr && (restErr.message || restErr));
    }

    return "";
  } catch (err) {
    console.error("getUserNameFromDB error:", err);
    return "";
  }
}
