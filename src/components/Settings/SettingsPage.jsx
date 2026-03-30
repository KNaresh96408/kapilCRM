import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);

  // 🔥 PREDEFINED CRM modules (existing system)
  const defaultModules = [];

  useEffect(() => {
    const loadModules = async () => {
      try {
        const rows = await import('../../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('crm_modules'));
        setModules(rows);
      } catch (err) {
        console.error("Error loading modules (fallback):", err);
        setModules(defaultModules); // fallback
      }
    };

    loadModules();
  }, []);

  return (
    <div style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "32px", marginBottom: "20px" }}>
        Modules & Fields
      </h1>

      <button
        onClick={() => navigate("/settings/create-module")}
        style={{
          padding: "10px 18px",
          background: "#800000",
          border: "none",
          color: "white",
          borderRadius: "6px",
          marginBottom: "20px",
          cursor: "pointer",
        }}
      >
        ➕ Create Module
      </button>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "white",
          boxShadow: "0 3px 8px rgba(0,0,0,0.15)",
        }}
      >
        <thead>
          <tr style={{ background: "#f0f0f0", textAlign: "left" }}>
            <th style={{ padding: "12px" }}>Displayed As</th>
            <th style={{ padding: "12px" }}>Module Name</th>
            <th style={{ padding: "12px" }}>Status</th>
            <th style={{ padding: "12px" }}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {modules.map((m, i) => (
            <tr key={i}>
              <td style={{ padding: "12px" }}>{m.displayName}</td>
              <td style={{ padding: "12px" }}>{m.moduleName}</td>
              <td style={{ padding: "12px" }}>
                {m.status ? "Enabled ✓" : "Disabled"}
              </td>
              <td style={{ padding: "12px" }}>
                <button
                  onClick={() =>
                    navigate(`/settings/module/${m.moduleName}`)
                  }
                  style={{
                    padding: "6px 12px",
                    background: "#800000",
                    border: "none",
                    color: "white",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Edit Module
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
