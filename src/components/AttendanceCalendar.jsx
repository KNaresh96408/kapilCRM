import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { fetchCollectionREST } from "../helpers/firestoreRest";

/**
 * AttendanceCalendar component
 * - If parent passes `records` prop (array), it will use that.
 * - Otherwise it will fetch all attendance docs (admin view).
 *
 * Props:
 *  - records: optional array of attendance records (each should have at least date, userId, userName/checkIn/checkOut/status)
 *  - userId: optional (filter)
 */
export default function AttendanceCalendar({ records: propRecords, userId }) {
  const [records, setRecords] = useState(Array.isArray(propRecords) ? propRecords : []);
  const [loading, setLoading] = useState(!Array.isArray(propRecords));
  const [error, setError] = useState(null);

  // ⭐ Memoize filtered records to prevent unnecessary re-renders
  const memoizedRecords = useMemo(() => {
    if (!Array.isArray(records)) return [];
    return userId ? records.filter(r => r.userId === userId) : records;
  }, [records, userId]);

  // If parent didn't pass records, fetch attendance collection for admin view
  useEffect(() => {
    if (Array.isArray(propRecords) && propRecords.length > 0) {
      setRecords(propRecords);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
  setLoading(true);
  setError(null);

  try {
    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const token = stored.idToken;

    if (!token) throw new Error("No idToken available");

    // ✅ REST fetch (iOS SAFE)
    const rows = await fetchCollectionREST("attendance", token);

    if (cancelled) return;

    const data = (rows || []).map((dd) => ({
      id: dd.id,
      userId: dd.userId,
      userName: dd.userName || dd.user || dd.name || "Unknown",
      date: dd.date || "",
      checkIn: dd.checkInTime || dd.checkIn || null,
      checkOut: dd.checkOutTime || dd.checkOut || null,
      status: dd.status || (dd.checkInTime ? "present" : "absent"),
      totalMinutes:
        typeof dd.totalMinutes === "number"
          ? dd.totalMinutes
          : dd.totalMinutes === 0
          ? 0
          : dd.minutes || dd.durationMinutes || null,
      raw: dd,
    }));

    setRecords(data);
  } catch (e) {
    if (!cancelled) {
      console.error("attendance load failed", e);
      setError("Failed to load attendance");
    }
  } finally {
    if (!cancelled) setLoading(false);
  }
})();

    return () => { cancelled = true; };
  }, [propRecords, userId]);

  // keep local state in-sync when parent changes propRecords
  useEffect(() => {
    if (Array.isArray(propRecords)) setRecords(propRecords);
  }, [propRecords]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {userId ? "My Attendance" : "Attendance (Admin)"}
        </h3>
        {loading && <small style={{ color: "#666" }}>Loading…</small>}
      </div>

      {error && (
        <div style={{ marginTop: 12, color: "#842029", background: "#f8d7da", padding: 8, borderRadius: 6 }}>
          Error: {error}
        </div>
      )}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ background: "#f1f1f1" }}>
              <th style={{ textAlign: "left" }}>User</th>
              <th style={{ textAlign: "left" }}>Date</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Minutes</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {memoizedRecords.length === 0 && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 20 }}>No records found</td>
              </tr>
            )}

            {memoizedRecords.map((rec) => (
              <tr key={rec.id || `${rec.userId}_${rec.date}`}>
                <td>{rec.userName || rec.userId || "Unknown"}</td>
                <td>{rec.date || (rec.raw && rec.raw.date) || ""}</td>
                <td>{formatTimestamp(rec.checkIn)}</td>
                <td>{formatTimestamp(rec.checkOut)}</td>
                <td>{typeof rec.totalMinutes === "number" ? rec.totalMinutes : (rec.raw && (rec.raw.totalMinutes ?? "-")) ?? "-"}</td>
                <td>{rec.status || (rec.checkIn ? "Present" : "Absent")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
        Tip: For personal view, open the page while logged in as a user. For admin, this lists all attendance docs.
      </div>
    </div>
  );
}

// small helper to present Firestore serverTimestamp-like objects or ISO strings
function formatTimestamp(val) {
  if (!val) return "-";
  // If it's a Firestore Timestamp object (has toDate), use it
  if (typeof val === "object" && typeof val.toDate === "function") {
    return toLocalString(val.toDate());
  }
  // If it's ISO string
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return toLocalString(d);
    return val;
  }
  // fallback
  return String(val);
}

function toLocalString(date) {
  return date.toLocaleString();
}
