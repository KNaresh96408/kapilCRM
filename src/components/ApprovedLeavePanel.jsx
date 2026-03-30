// src/components/ApprovedLeavePanel.jsx

import React, { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { fetchCollectionREST } from "../helpers/firestoreRest";

const REQUEST_TYPE_LABEL = {
  leave: "Leave",
  comp_off: "Comp-Off",
  early_checkin: "Early Check-in",
  early_checkout: "Early Check-out",
};

export default function ApprovedLeavePanel() {
  const [leaves, setLeaves] = useState([]);
  const [filter, setFilter] = useState("overall"); // overall | currentMonth
  const today = new Date().toISOString().slice(0, 7); // YYYY-MM

  useEffect(() => {
    const load = async () => {
      try {
        const TIMEOUT_MS = 3000;
        
        // Try Firestore SDK with timeout
        try {
          const q = query(
            collection(db, "leaveRequests"),
            where("final_status", "==", "approved")
          );

          const sdkPromise = getDocs(q);
          const snap = await Promise.race([
            sdkPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('SDK timeout')), TIMEOUT_MS)),
          ]);

          const rows = [];
          snap.forEach(doc => {
            rows.push({ id: doc.id, ...doc.data() });
          });

          setLeaves(rows);
          return;
        } catch (sdkErr) {
          console.warn('🟡 ApprovedLeavePanel SDK failed, trying REST fallback', sdkErr?.message);
        }

        // REST fallback
        try {
          const stored = localStorage.getItem('kp-user');
          const parsed = stored ? JSON.parse(stored) : null;
          const token = parsed?.idToken;

          if (token) {
            const data = await fetchCollectionREST('leaveRequests', token);
            const filtered = data.filter(
              (d) =>
                String(d.final_status || "").toLowerCase() === "approved" ||
                String(d.status || "").toLowerCase() === "approved"
            );
            setLeaves(filtered);
            return;
          }
        } catch (restErr) {
          console.warn('⚠️ ApprovedLeavePanel REST fallback failed', restErr?.message);
        }

        // Both failed, show empty
        setLeaves([]);
      } catch (e) {
        console.error("ApprovedLeavePanel error:", e);
        setLeaves([]);
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
            {(REQUEST_TYPE_LABEL[l.type] || l.type || "Request")} | {l.from} → {l.to}
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