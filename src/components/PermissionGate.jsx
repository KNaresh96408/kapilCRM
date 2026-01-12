// src/components/PermissionGate.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export default function PermissionGate({ moduleName, children }) {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return setAllowed(false);

        // 🔥 refresh token (important!)
        await user.getIdToken(true);

        const uid = user.uid;

        // --------------------------
        // 1️⃣ CHECK USER ROLE
        // --------------------------
        const userRef = doc(db, "Users", uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          console.warn("User record missing!");
          return setAllowed(false);
        }

        const role = userSnap.data().role;

        // 🔥 Admin always allowed
        if (role === "admin") {
          return setAllowed(true);
        }

        // --------------------------
        // 2️⃣ CHECK MODULE PERMISSION
        // Firestore path:
        // modulePermissions / <moduleName> / users / <uid>
        // --------------------------
        const permRef = doc(
          db,
          "modulePermissions",
          moduleName,
          "users",
          uid
        );

        const permSnap = await getDoc(permRef);

        if (!permSnap.exists()) {
          // No permission entry → deny
          return setAllowed(false);
        }

        const perm = permSnap.data();

        // Allow only if READ is true
        setAllowed(perm.read === true);
      } catch (err) {
        console.error("PermissionGate error:", err);
        setAllowed(false);
      }
    };

    checkPermission();
  }, [moduleName]);

  // --------------------------
  // UI Conditions
  // --------------------------
  if (allowed === null) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        Checking permissions…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div
        style={{
          padding: 40,
          color: "#800000",
          fontWeight: "bold",
          textAlign: "center",
        }}
      >
        ❌ You don’t have permission to view this module.
      </div>
    );
  }

  // Allowed → Render children
  return children;
}
