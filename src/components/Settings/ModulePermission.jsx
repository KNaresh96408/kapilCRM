import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { setDoc, doc } from "firebase/firestore";
import { fetchCollectionREST } from "../../helpers/firestoreRest";


export default function ModulePermission({ moduleName }) {
  const [users, setUsers] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [saving, setSaving] = useState(false);

  // Load users + permissions
// Load users + permissions (FAST LOAD)
useEffect(() => {
  const loadData = async () => {
    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const token = stored.idToken;

    if (!token) return;

    const usersData = await fetchCollectionREST("Users", token);
    const normalizedUsers = (usersData || []).map((u) => ({
      ...u,
      name: u.Name || u.name || u.displayName || u.email || u.Email || u.id || "",
      role: String(u.role || u.Role || u.designation || u.Designation || "").toLowerCase(),
    }));
    setUsers(normalizedUsers);

    const permDocs = await fetchCollectionREST(
      `modulePermissions/${moduleName}/users`,
      token
    );

    const perms = {};
    (permDocs || []).forEach((p) => {
      perms[p.id] = p;
    });

    setPermissions(perms);
  };

  loadData();
}, [moduleName]);

  // Toggle checkbox
  const toggle = (uid, key) => {
    setPermissions((prev) => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        [key]: !prev[uid]?.[key],
      },
    }));
  };

  // Save permissions
  const savePermissions = async () => {
    setSaving(true);
    try {
      for (let u of users) {
        const uid = u.id;

        // Admin always gets full access
        if (u.role === "admin") {
          await setDoc(doc(db, "modulePermissions", moduleName, "users", uid), {
            create: true,
            read: true,
            update: true,
            delete: true,
          });
          continue;
        }

        await setDoc(
          doc(db, "modulePermissions", moduleName, "users", uid),
          permissions[uid] || {
            create: false,
            read: false,
            update: false,
            delete: false,
          },
          { merge: true }
        );
      }

      alert("Permissions saved!");
    } catch (err) {
      console.error(err);
      alert("Error saving permissions");
    }
    setSaving(false);
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>
        Module Permissions — {moduleName}
      </h2>

      <table style={styles.table}>
        <thead>
          <tr style={styles.headerRow}>
            <th style={styles.th}>User</th>
            <th style={styles.th}>Create</th>
            <th style={styles.th}>Read</th>
            <th style={styles.th}>Update</th>
            <th style={styles.th}>Delete</th>
          </tr>
        </thead>

        <tbody>
          {users.map((u) => {
            const isAdmin = String(u.role || "").toLowerCase() === "admin";
            const p = permissions[u.id] || {};

            return (
              <tr key={u.id} style={styles.row}>
                <td style={styles.userCell}>
                  {u.name || u.Name || u.email || u.Email || u.id} {isAdmin ? " (Admin)" : ""}
                </td>

                {["create", "read", "update", "delete"].map((key) => (
                  <td key={key} style={styles.cell}>
                    <input
                      type="checkbox"
                      checked={isAdmin ? true : p[key] || false}
                      disabled={isAdmin}
                      onChange={() => toggle(u.id, key)}
                      style={styles.checkbox}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <button
        onClick={savePermissions}
        disabled={saving}
        style={styles.saveBtn}
      >
        {saving ? "Saving..." : "Save Permissions"}
      </button>
    </div>
  );
}

/* 🎨 THEME-BASED STYLES */
const styles = {
  container: {
    padding: "30px",
    maxWidth: "700px",
    fontFamily: "Poppins, sans-serif",
  },

  heading: {
    color: "#800000",
    fontSize: "26px",
    fontWeight: "700",
    marginBottom: "20px",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    background: "#fff",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 3px 10px rgba(0,0,0,0.1)",
  },

  headerRow: {
    backgroundColor: "#800000",
    color: "#fff",
  },

  th: {
    padding: "12px",
    fontWeight: "600",
    textAlign: "left",
    borderRight: "1px solid rgba(255,255,255,0.2)",
  },

  row: {
    borderBottom: "1px solid #eee",
  },

  userCell: {
    padding: "10px",
    fontWeight: "600",
    color: "#800000",
  },

  cell: {
    padding: "10px",
    textAlign: "center",
  },

  checkbox: {
    transform: "scale(1.3)",
    cursor: "pointer",
  },

  saveBtn: {
    marginTop: "20px",
    padding: "12px 20px",
    background: "#800000",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "700",
    fontSize: "15px",
  },
};
