import { db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export const getModulePermission = async (moduleName, userId) => {
  try {
    const ref = doc(db, "modulePermissions", moduleName, "Users", userId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return { create:false, read:false, update:false, delete:false };
    }

    return snap.data();
  } 
  catch (e) {
    console.error("Permission load failed", e);
    return { create:false, read:false, update:false, delete:false };
  }
};
