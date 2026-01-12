import React from "react";

export default function SectionCard({ title, children }) {
  return (
    <div
      style={{
        marginTop: 25,
        padding: 20,
        background: "white",
        borderRadius: "18px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
      }}
    >
      <h3 style={{ marginBottom: 10 }}>{title}</h3>
      {children}
    </div>
  );
}
