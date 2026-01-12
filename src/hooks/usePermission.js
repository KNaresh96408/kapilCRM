import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export function usePermission(moduleName) {
  const [perm, setPerm] = useState({
    loading: true,
    create: false,
    read: false,
    update: false,
    delete: false,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) return;

        // ADMIN FULL ACCESS
        if (user.email === "loan@kapilpower.com") {
          setPerm({
            loading: false,
            create: true,
            read: true,
            update: true,
            delete: true,
          });
          return;
        }

        const ref = doc(
          db,
          "modulePermissions",
          moduleName,
          "users",
          user.uid
        );

        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setPerm({ loading: false });
          return;
        }

        setPerm({ ...snap.data(), loading: false });
      } catch (e) {
        console.error(e);
        setPerm({ loading: false });
      }
    };

    load();
  }, [moduleName]);

  return perm;
}
