// src/components/ActiveInactiveToday.jsx

import React, { useMemo, useState } from "react";

export default function ActiveInactiveToday({
  attendance,
  users,
  selectedDate,
  belongsToFilter = "all",
  onUserClick, // future: open map
}) {
  const [employeeFilter, setEmployeeFilter] = useState("");

  const normalizeBelongsTo = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const pad = (n) => String(n).padStart(2, "0");

  const localYYYYMMDDFromDate = (d) => {
    if (!d || !(d instanceof Date)) return null;
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const toLocalDateStringFromTimestamp = (ts) => {
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
      if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
      const d = new Date(ts);
      if (!isNaN(d.getTime())) return localYYYYMMDDFromDate(d);
    }
    if (ts instanceof Date) return localYYYYMMDDFromDate(ts);
    return null;
  };

  const resolveRecordDate = (r) => {
    if (!r) return null;
    if (typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) return r.date;
    if (typeof r.recordDate === "string" && r.recordDate.includes("T")) return r.recordDate.split("T")[0];
    if (typeof r.recordDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.recordDate)) return r.recordDate;
    return toLocalDateStringFromTimestamp(r.checkInTime || r._clientCheckIn || r.checkIn);
  };

  const hasCheckIn = (r) => !!(r && (r.checkInTime || r.checkIn || r._clientCheckIn));

  // Attendance of today only
  const todayAttendance = (attendance || []).filter((a) =>
    resolveRecordDate(a) === selectedDate && hasCheckIn(a)
  );

  // Active userIds
  const activeUserIds = new Set(todayAttendance.map(a => a.userId));

  const normalizedFilter = employeeFilter.trim().toLowerCase();

  const visibleUsers = useMemo(
    () =>
      (users || []).filter((u) => {
        const belongsToMatch =
          belongsToFilter === "all" || normalizeBelongsTo(u.belongsTo) === belongsToFilter;
        if (!belongsToMatch) return false;

        if (!normalizedFilter) return true;

        const haystack = `${u.name || ""} ${u.email || ""} ${u.id || ""}`.toLowerCase();
        return haystack.includes(normalizedFilter);
      }),
    [users, belongsToFilter, normalizedFilter]
  );

  const activeUsers = visibleUsers.filter(u => activeUserIds.has(u.id));
  const inactiveUsers = visibleUsers.filter(u => !activeUserIds.has(u.id));

  return (
    <div style={{ marginTop: 30 }}>
      <h3 style={{ marginBottom: 12 }}>Today Status</h3>

      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          placeholder="Filter by employee name or email"
          style={{
            width: "100%",
            maxWidth: 420,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            outline: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 40 }}>
        {/* ACTIVE */}
        <div style={{ flex: 1 }}>
          <h4 style={{ color: "green" }}>Active Employees</h4>

          {activeUsers.length === 0 && (
            <div style={{ fontSize: 13, color: "#666" }}>
              No active users
            </div>
          )}

          {activeUsers.map(u => (
            <div
              key={u.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "green",
                  }}
                />
                {u.name} {u.email && `(${u.email})`}
              </div>

              {typeof onUserClick === "function" && (
                <button
                  type="button"
                  onClick={() => onUserClick(u)}
                  style={{
                    border: "1px solid #800000",
                    background: "#fff",
                    color: "#800000",
                    borderRadius: 6,
                    padding: "4px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  See Map
                </button>
              )}
            </div>
          ))}
        </div>

        {/* INACTIVE */}
        <div style={{ flex: 1 }}>
          <h4 style={{ color: "red" }}>Inactive Employees</h4>

          {inactiveUsers.length === 0 && (
            <div style={{ fontSize: 13, color: "#666" }}>
              No inactive users
            </div>
          )}

          {inactiveUsers.map(u => (
            <div
              key={u.id}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "red",
                }}
              />
              {u.name} {u.email && `(${u.email})`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
