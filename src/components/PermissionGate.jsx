import React, { useEffect, useState } from "react";
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export default function PermissionGate({ moduleName, children }) {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    const load = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return setAllowed(false);

      // Admin always allowed
      const userRef = doc(db, "Users", uid);
      const userSnap = await getDoc(userRef);
      const role = userSnap.data()?.role;
      if (role === "admin") {
        setAllowed(true);
        return;
      }

      // Get module permission
      const permRef = doc(db, "modulePermissions", moduleName, "users", uid);
      const permSnap = await getDoc(permRef);

      if (!permSnap.exists()) {
        setAllowed(false);
      } else {
        const p = permSnap.data();
        setAllowed(p.read === true); // allow only if read permission exists
      }
    };

    load();
  }, [moduleName]);

  if (allowed === null) {
    return <div style={{ padding: 40 }}>Checking permissions…</div>;
  }

  if (!allowed) {
    return (
      <div style={{ padding: 40, color: "#800000", fontWeight: "bold" }}>
        ❌ You don’t have permission to view this module.
      </div>
    );
  }

  return children;
}
