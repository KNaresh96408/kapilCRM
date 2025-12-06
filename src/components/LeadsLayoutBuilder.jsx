// src/components/LeadsLayoutBuilder.jsx
import React from "react";

/**
 * Small wrapper to redirect to settings layout page with module param.
 * You can keep or remove this file — it's optional.
 */
export default function LeadsLayoutBuilder() {
  const goTo = (module) => {
    const url = `/settings/layout?module=${encodeURIComponent(module)}`;
    window.location.href = url;
  };

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ fontSize: 28 }}>Layout Builder shortcuts</h2>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={()=>goTo("leads")} style={btn}>Edit Leads Layout</button>
        <button onClick={()=>goTo("deals")} style={btn}>Edit Deals Layout</button>
        <button onClick={()=>goTo("salesOrders")} style={btn}>Edit Sales Orders</button>
      </div>
    </div>
  );
}

const btn = { background: "#800000", color: "#fff", padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer" };
