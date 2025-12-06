// src/components/History.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  fetchUserMonthAttendance,
  getHolidays
} from "../firebase/attendanceFunctions";
import { collection, getDocs, setDoc, doc } from "firebase/firestore";

export default function History() {
  const [userId, setUserId] = useState("");
  const [records, setRecords] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [monthDays, setMonthDays] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // ---------------------------
  // Load user info + admin role
  // ---------------------------
  useEffect(() => {
    const uid = localStorage.getItem("uid");
    const role = localStorage.getItem("role"); // admin, state_head, etc.

    if (uid) setUserId(uid);
    if (["admin", "state_head", "sales_head", "zonal_manager"].includes(role)) {
      setIsAdmin(true);
    }
  }, []);

  // --------------------------------
  // Load month data after user loads
  // --------------------------------
  useEffect(() => {
    if (!userId) return;

    (async () => {
      const rec = await fetchUserMonthAttendance(userId);
      const hol = await getHolidays();

      setRecords(rec || []);
      setHolidays(hol || []);

      generateMonthDays();
    })();
  }, [userId]);

  // -------------------------------------
  // Generate all days for current month
  // -------------------------------------
  function generateMonthDays() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const days = [];
    const total = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= total; d++) {
      const date = new Date(year, month, d).toISOString().slice(0, 10);
      days.push(date);
    }
    setMonthDays(days);
  }

  // -----------------------------------------
  // Colour logic for each day
  // -----------------------------------------
  function getDayStatus(date) {
    if (holidays.includes(date)) return "holiday";

    const rec = records.find((r) => r.date === date);
    if (!rec) return "absent";

    if (rec.minutes >= 240 && rec.minutes < 480) return "half";
    if (rec.minutes >= 480) return "present";
    return "present";
  }

  // --------------------------------------------
  // Admin Add Holiday
  // --------------------------------------------
  async function markHoliday(date) {
    await setDoc(doc(db, "holidays", date), { createdAt: new Date() });
    alert("Holiday added: " + date);
    setHolidays((prev) => [...prev, date]);
  }

  // --------------------------------------------
  // Colour Box Component
  // --------------------------------------------
  const ColorBox = ({ date }) => {
    const status = getDayStatus(date);

    const colors = {
      present: "#4caf50", // green
      half: "#ffcc00", // yellow
      absent: "#e53935", // red
      holiday: "#1976d2", // blue
    };

    const label = {
      present: "Present",
      half: "Half Day",
      absent: "Absent",
      holiday: "Holiday",
    };

    return (
      <div
        style={{
          width: "110px",
          padding: "8px",
          margin: "6px",
          borderRadius: "6px",
          background: colors[status],
          color: "#fff",
          textAlign: "center",
          fontSize: "12px",
          cursor: isAdmin ? "pointer" : "default",
        }}
        onClick={() => {
          if (isAdmin && status !== "holiday") {
            if (confirm(`Mark ${date} as Holiday?`)) {
              markHoliday(date);
            }
          }
        }}
      >
        <div><b>{date.split("-")[2]}</b></div>
        <div>{label[status]}</div>
      </div>
    );
  };

  // =====================================================
  //                      UI
  // =====================================================
  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ color: "#800000" }}>Monthly Attendance Calendar</h2>

      <div style={{ margin: "10px 0", fontSize: "14px" }}>
        🔵 <b>Holiday</b> —  
        🟢 <b>Present</b> —  
        🟡 <b>Half Day</b> —  
        🔴 <b>Absent</b>
      </div>

      {isAdmin && (
        <p style={{ color: "#1976d2" }}>
          👉 Click any day to mark it as <b>Holiday</b>
        </p>
      )}

      {/* Calendar Box */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        width: "800px",
        marginTop: "20px",
      }}>
        {monthDays.map((d) => (
          <ColorBox key={d} date={d} />
        ))}
      </div>
    </div>
  );
}
