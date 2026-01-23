// src/components/ActiveInactiveToday.jsx

import React from "react";

export default function ActiveInactiveToday({
  attendance,
  users,
  selectedDate,
  onUserClick, // future: open map
}) {
  // Attendance of today only
  const todayAttendance = attendance.filter(
    a => a.date === selectedDate && a.checkInTime
  );

  // Active userIds
  const activeUserIds = new Set(todayAttendance.map(a => a.userId));

  const activeUsers = users.filter(u => activeUserIds.has(u.id));
  const inactiveUsers = users.filter(u => !activeUserIds.has(u.id));

  return (
    <div style={{ marginTop: 30 }}>
      <h3 style={{ marginBottom: 12 }}>Today Status</h3>

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
                gap: 8,
                cursor: "pointer",
              }}
              onClick={() => onUserClick?.(u)} // future map hook
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "green",
                }}
              />
              {u.name}
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
              {u.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
