// src/components/ApprovedLeavePanel.jsx

import React, { useEffect, useState } from "react";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

export default function ApprovedLeavePanel() {
  const [leaves, setLeaves] = useState([]);
  const [filter, setFilter] = useState("overall"); // overall | currentMonth
  const today = new Date().toISOString().slice(0, 7); // YYYY-MM

  useEffect(() => {
    const load = async () => {
      try {
        const q = query(
  collection(db, "leaveRequests"),
  where("final_status", "==", "approved")
);

        const snap = await getDocs(q);
        const rows = [];

        snap.forEach(doc => {
          rows.push({ id: doc.id, ...doc.data() });
        });

        setLeaves(rows);
      } catch (e) {
        console.error("ApprovedLeavePanel error:", e);
      }
    };

    load();
  }, []);

  const filteredLeaves = leaves.filter(l => {
    if (filter === "overall") return true;
    if (filter === "currentMonth") {
      return l.from?.startsWith(today) || l.to?.startsWith(today);
    }
    return true;
  });

 return (
  <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    {/* Header */}
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
      }}
    >

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          padding: "4px 6px",
          borderRadius: 6,
          border: "1px solid #ccc",
        }}
      >
        <option value="overall">Overall</option>
        <option value="currentMonth">Current Month</option>
      </select>
    </div>

    {/* Scrollable content */}
    <div style={{ flex: 1, overflowY: "auto" }}>
      {filteredLeaves.length === 0 && (
        <div style={{ fontSize: 14, color: "#666" }}>
          No approved leaves
        </div>
      )}

      {filteredLeaves.map((l) => (
        <div
          key={l.id}
          style={{
            background: "#fff",
            padding: 10,
            borderRadius: 8,
            marginBottom: 10,
            border: "1px solid #ddd",
          }}
        >
          <b>{l.userEmail}</b>

          <div style={{ fontSize: 13 }}>
            {l.type?.toUpperCase()} | {l.from} → {l.to}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
  ✔ Approved by{" "}
  {l.finalApprovedBy?.name
    ? `${l.finalApprovedBy.name} (${l.finalApprovedBy.role})`
    : l.approverEmail
    ? `${l.approverEmail}`
    : "System (admin)"}
</div>

        </div>
      ))}
    </div>
  </div>
);
}