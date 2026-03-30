// src/components/AttendanceMonthCalendar.jsx
import React, { useMemo, useState, useEffect } from "react";
import { getTodayStr } from "../firebase/attendanceFunctions";

/**
 * AttendanceMonthCalendar
 *
 * Props:
 *  - records
 *  - holidays
 *  - workingDays  <-- NEW
 *  - currentUserId
 */

const MAX_VALID_MINUTES = 24 * 60;

function pad(n) { return String(n).padStart(2, "0"); }

const getAttendanceMonthRangeFromDate = (baseDate = new Date()) => {
  const startDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 26);
  const endDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 25);
  return {
    startDate,
    endDate,
    from: localYYYYMMDDFromDate(startDate),
    to: localYYYYMMDDFromDate(endDate),
  };
};

function localYYYYMMDDFromDate(d) {
  if (!d || !(d instanceof Date)) return null;
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

function toLocalDateStringFromTimestamp(ts) {
  if (!ts) return null;
  try {
    if (typeof ts.toDate === "function") {
      return localYYYYMMDDFromDate(ts.toDate());
    }
  } catch {}
  if (ts && typeof ts.seconds === "number") {
    const ms = ts.seconds * 1000 + (ts.nanoseconds ? Math.floor(ts.nanoseconds / 1e6) : 0);
    return localYYYYMMDDFromDate(new Date(ms));
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return localYYYYMMDDFromDate(d);
  }
  if (ts instanceof Date) return localYYYYMMDDFromDate(ts);
  return null;
}

function parseCheckInDate(ts) {
  if (!ts) return null;
  try { if (typeof ts.toDate === "function") return ts.toDate(); } catch {}
  if (ts && typeof ts.seconds === "number")
    return new Date(ts.seconds * 1000 + (ts.nanoseconds ? Math.floor(ts.nanoseconds / 1e6) : 0));
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  if (ts instanceof Date) return ts;
  return null;
}

function AttendanceMonthCalendar({
  records = [],
  holidays = [],
  workingDays = [],      // NEW
  approvedLeaves = [],
  currentUserId = null,
  currentUserEmail = "",
  onMonthChange,
}) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  const [monthOffset, setMonthOffset] = useState(0);

  // ⭐ Calculate live minutes every 60s for TODAY's running check-in
  const [now, setNow] = useState(Date.now());
  
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const focus = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [monthOffset]);

  useEffect(() => {
    if (typeof onMonthChange !== "function") return;
    const { from, to } = getAttendanceMonthRangeFromDate(focus);
    onMonthChange(from, to);
  }, [focus, onMonthChange]);

  const { startDate, endDate } = getAttendanceMonthRangeFromDate(focus);

  // map of records { YYYY-MM-DD : doc }
  const attendanceMap = useMemo(() => {
    const map = {};
    (records || []).forEach(r => {
      if (!r) return;
let dateKey = null;

// 1️⃣ If date field is a clean yyyy-mm-dd → use it
if (typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
  dateKey = r.date;
}
// 2️⃣ If recordDate exists and looks ISO → extract date part
else if (typeof r.recordDate === "string" && r.recordDate.includes("T")) {
  dateKey = r.recordDate.split("T")[0];
}

// 3️⃣ If recordDate is already yyyy-mm-dd
else if (typeof r.recordDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.recordDate)) {
  dateKey = r.recordDate;
}

// 4️⃣ LAST fallback → only if no other date exists
else {
  dateKey = toLocalDateStringFromTimestamp(
    r.checkInTime || r._clientCheckIn || r.checkIn
  );
}

// ❗ If still no date, skip
if (!dateKey) return;

      if (!map[dateKey]) map[dateKey] = r;
      else {
        const ex = map[dateKey];
        const exM = Number(ex.totalMinutes ?? ex.minutes ?? ex.durationMinutes ?? 0);
        const rM  = Number(r.totalMinutes ?? r.minutes ?? r.durationMinutes ?? 0);
        const exOut = !!(ex.checkOutTime || ex.checkOut);
        const rOut  = !!(r.checkOutTime || r.checkOut);
        if (rOut && !exOut) map[dateKey] = r;
        else if (rM > exM) map[dateKey] = r;
      }
    });
    return map;
  }, [records]);

  // holiday map
  const holidayMap = useMemo(() => {
    const m = {};
    (holidays || []).forEach(h => {
      if (!h || !h.date) return;
      const applies =
        h.applyToAll ||
        !h.users ||
        (Array.isArray(h.users) && h.users.length === 0) ||
        (currentUserId && Array.isArray(h.users) && h.users.includes(currentUserId));
      if (applies) m[h.date] = h;
    });
    return m;
  }, [holidays, currentUserId]);

  const approvedLeaveMap = useMemo(() => {
    const map = {};
    const email = String(currentUserEmail || "").trim().toLowerCase();

    const normalizeTypeLabel = (type) => {
      const t = String(type || "").toLowerCase();
      if (t === "leave") return "Leave";
      if (t === "comp_off") return "Comp-Off";
      if (t === "early_checkin") return "Early Check-in";
      if (t === "early_checkout") return "Early Check-out";
      return "Leave";
    };

    const isApproved = (row) => {
      const s1 = String(row?.final_status || "").toLowerCase();
      const s2 = String(row?.status || "").toLowerCase();
      return s1 === "approved" || s2 === "approved";
    };

    const belongsToCurrentUser = (row) => {
      if (currentUserId && row?.userId && row.userId === currentUserId) return true;
      if (email && row?.userEmail && String(row.userEmail).toLowerCase() === email) return true;
      return false;
    };

    (approvedLeaves || []).forEach((row) => {
      if (!row || !isApproved(row) || !belongsToCurrentUser(row)) return;
      const from = String(row.from || "");
      const to = String(row.to || from);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;

      let cursor = from;
      const label = normalizeTypeLabel(row.type);
      while (cursor <= to) {
        if (!map[cursor]) map[cursor] = { label, type: row.type || "leave" };
        const d = new Date(`${cursor}T00:00:00`);
        d.setDate(d.getDate() + 1);
        cursor = localYYYYMMDDFromDate(d);
      }
    });

    return map;
  }, [approvedLeaves, currentUserId, currentUserEmail]);

  // ⭐ WORKING DAY override map (NEW)
  const workingDayMap = useMemo(() => {
    const m = {};
    (workingDays || []).forEach(w => {
      if (!w || !w.date) return;
      const applies =
        w.applyToAll ||
        !w.users ||
        (Array.isArray(w.users) && w.users.length === 0) ||
        (currentUserId && Array.isArray(w.users) && w.users.includes(currentUserId));
      if (applies) m[w.date] = w;
    });
    return m;
  }, [workingDays, currentUserId]);

  const todayStrLocal = getTodayStr();

  const days = [];
  for (let i = 0; i < startDate.getDay(); i++) days.push({ empty: true });

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayDate = new Date(d);
    dayDate.setHours(0, 0, 0, 0);
    const dateStr = localYYYYMMDDFromDate(dayDate);

    const isSunday = dayDate.getDay() === 0;
    const holidayObj = holidayMap[dateStr];
    const workingOverride = workingDayMap[dateStr];   // ⭐
    const record = attendanceMap[dateStr];
    const approvedLeave = approvedLeaveMap[dateStr];

    const isPast = dateStr < todayStrLocal;
    const isToday = dateStr === todayStrLocal;
    const isPastOrToday = dateStr <= todayStrLocal;

    let bg = "#fff";
    let text = "";
    let title = "";

    // ⭐ NEW LOGIC — if working override exists → DO NOT color purple
    const treatAsWorkingDay = !!workingOverride;

    // Sunday / Holiday
    if (approvedLeave) {
      bg = "#d9ecff";
      text = approvedLeave.label;
      title = approvedLeave.label;
    }
    else if (!treatAsWorkingDay && (isSunday || holidayObj)) {
      bg = "#e2c4ff";
      text = holidayObj?.label || "Holiday";
      title = holidayObj?.label || "Holiday / Sunday";
    } 
    else if (record) {
      const minutes = Number(
        record.totalMinutes ?? record.minutes ?? record.durationMinutes ?? 0
      ) || 0;

      const hasCheckIn  = !!(record.checkInTime || record.checkIn || record._clientCheckIn);
      const hasCheckOut = !!(record.checkOutTime || record.checkOut);

      if (dateStr > todayStrLocal) {
        bg = "#fff";
        text = "";
        title = "Future (record date > today)";
      } 
      else {
        let liveMinutes = null;
        if (isToday && hasCheckIn && !hasCheckOut) {
          // ⭐ Calculate live minutes using current time
          const ci = parseCheckInDate(
            record.checkInTime || record._clientCheckIn || record.checkIn
          );
          if (ci) {
            liveMinutes = Math.floor((now - ci.getTime()) / 60000);
          } else {
            liveMinutes = minutes;
          }
        }

        const forgotPast = isPast && hasCheckIn && !hasCheckOut && minutes === 0;
        const invalidBig = minutes > MAX_VALID_MINUTES;

        if (isToday && hasCheckIn && !hasCheckOut) {
          bg = "#b0fcb0";
          text = `${liveMinutes ?? 0} mins (running)`;
          title = "Running (checked in)";
        } 
        else if (forgotPast) {
          bg = "#fff7a8";
          text = "Half Day (>240 mins)";
          title = "Forgot checkout — Half Day";
        } 
        else if (invalidBig) {
          bg = "#fff7a8";
          text = "Half Day (>240 mins)";
          title = "Invalid minutes";
        } 
        else if (minutes > 0) {
          if (minutes >= 240) {
            bg = "#b0fcb0";
            text = `${minutes} mins`;
            title = "Present";
          } else {
            bg = "#fff7a8";
            text = `${minutes} mins`;
            title = "Half Day";
          }
        } 
        else {
          if (isPast) {
            bg = "#ffb3b3";
            text = "Absent";
            title = "Absent";
          }
        }
      }
    } 
    else if (isPast) {
      bg = "#ffb3b3";
      text = "Absent";
      title = "Absent";
    }

    days.push({ date: dayDate.getDate(), full: dateStr, bg, text, title });
  }

  const monthName = focus.toLocaleString(undefined, { month: "long", year: "numeric" });
  const rangeLabel = `${startDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} - ${endDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;

return (
  <div
    className="attendance-month-calendar-container"
    style={{
      width: "100%",
      maxWidth: 1100
    }}
  >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginBottom: 10, color: "#800000" }}>Monthly Attendance — {monthName} ({rangeLabel})</h3>
        <div>
          <button onClick={() => setMonthOffset(m => m - 1)} style={navBtn}>Prev</button>
          <button onClick={() => setMonthOffset(0)} style={{ ...navBtn, marginLeft: 8 }}>This Month</button>
          <button onClick={() => setMonthOffset(m => m + 1)} style={{ ...navBtn, marginLeft: 8 }}>Next</button>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 6,
        textAlign: "center",
        fontWeight: 700,
      }}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 6,
        marginTop: 10,
      }}>
        {days.map((d, idx) =>
          d.empty ? (
            <div key={"e" + idx} />
          ) : (
            <div
              key={d.full}
              title={d.title}
              style={{
                padding: 10,
                borderRadius: 6,
                background: d.bg,
                border: "1px solid #ccc",
                minHeight: 50,
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              <div>{d.date}</div>
              <div style={{ fontSize: 11, marginTop: 6, color: "#333" }}>
                {d.text}
              </div>
            </div>
          )
        )}
      </div>

      <div style={{ marginTop: 30 }}>
        <h4>Legend</h4>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 18, height: 18, background: "#b0fcb0", borderRadius: 3 }} /> Present
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 18, height: 18, background: "#fff7a8", borderRadius: 3 }} /> Half Day
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 18, height: 18, background: "#ffb3b3", borderRadius: 3 }} /> Absent
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 18, height: 18, background: "#e2c4ff", borderRadius: 3 }} /> Holiday
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 18, height: 18, background: "#d9ecff", borderRadius: 3 }} /> Leave / Comp-Off / Early Check
          </div>
        </div>
      </div>
    </div>
  );
}

const navBtn = {
  marginLeft: 8,
  background: "#fff",
  color: "#800000",
  border: "1px solid #800000",
  padding: "6px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};

export default React.memo(AttendanceMonthCalendar);
