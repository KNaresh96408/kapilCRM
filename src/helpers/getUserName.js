import { db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export async function getUserNameFromDB(uid) {
  try {
    const ref = doc(db, "Users", uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      return (
        snap.data().Name ||      // FIX: Firestore uses "Name"
        snap.data().name ||
        snap.data().displayName ||
        ""
      );
    }

    return "";
  } catch (err) {
    console.error("getUserNameFromDB error:", err);
    return "";
  }
}
