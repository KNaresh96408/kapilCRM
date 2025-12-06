import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export default function EditModule() {
  const { moduleName } = useParams();
  const navigate = useNavigate();

  const [moduleData, setModuleData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModule();
  }, []);

  const loadModule = async () => {
    try {
      const ref = doc(db, "crm_modules", moduleName);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        setModuleData(snap.data());
      } else {
        alert("Module not found");
        navigate("/settings");
      }
    } catch (err) {
      console.error("Failed to load module", err);
      alert("Error loading module");
      navigate("/settings");
    }

    setLoading(false);
  };

  if (loading) return <h2 style={{ padding: 40 }}>Loading...</h2>;

  return (
    <div style={{ padding: "40px", maxWidth: "800px" }}>
      <h1 style={{ fontSize: "32px", marginBottom: "20px" }}>
        Edit Module — {moduleData.displayName}
      </h1>

      {/* ------ ACTION BUTTONS ------ */}
      <div style={{ display: "flex", gap: "20px", marginBottom: "40px" }}>
<button
  onClick={() =>
    navigate(`/settings/edit-layout?module=${moduleName}`)
  }
  style={{
    padding: "12px 18px",
    background: "#800000",
    color: "white",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
  }}
>
  🧩 Edit Layout
</button>

        <button
          onClick={() =>
            navigate(`/settings/module/${moduleName}/permissions`)
          }
          style={{
            padding: "12px 18px",
            background: "#800000",
            color: "white",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
          }}
        >
          🔐 Module Permission
        </button>
      </div>

      {/* ------ MODULE DETAILS ------ */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "8px",
          boxShadow: "0 3px 8px rgba(0,0,0,0.15)",
        }}
      >
        <p><strong>Display Name:</strong> {moduleData.displayName}</p>
        <p><strong>Module Name:</strong> {moduleData.moduleName}</p>
        <p><strong>Status:</strong> {moduleData.status ? "Enabled" : "Disabled"}</p>
      </div>
    </div>
  );
}
