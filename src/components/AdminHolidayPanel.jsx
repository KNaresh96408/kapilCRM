// src/components/AdminHolidayPanel.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";

import {
  addHoliday as addHolidayFn,
  fetchHolidays,
  fetchWorkingDays,
  addWorkingDay,
  deleteWorkingDay,
} from "../firebase/attendanceFunctions";

/**
 * Combined Panel:
 *  - Holiday Management
 *  - Working Day Management
 */
export default function AdminHolidayPanel() {
  // ---------------- HOLIDAYS ----------------
  const [holidays, setHolidays] = useState([]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [holidayLabel, setHolidayLabel] = useState("");
  const [holidayApplyAll, setHolidayApplyAll] = useState(true);
  const [holidaySelectedUsers, setHolidaySelectedUsers] = useState([]);

  // -------------- WORKING DAYS --------------
  const [workingDays, setWorkingDays] = useState([]);
  const [newWorkingDate, setNewWorkingDate] = useState("");
  const [workingLabel, setWorkingLabel] = useState("");
  const [workingApplyAll, setWorkingApplyAll] = useState(true);
  const [workingSelectedUsers, setWorkingSelectedUsers] = useState([]);

  // users
  const [users, setUsers] = useState([]);

  useEffect(() => {
    loadHolidays();
    loadWorkingDays();
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const snap = await getDocs(collection(db, "Users"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(list);
    } catch (e) {
      console.warn("users fetch error", e);
    }
  };

  // -------- HOLIDAY LOAD -----
  const loadHolidays = async () => {
    const list = await fetchHolidays();
    setHolidays(list || []);
  };

  // -------- WORKING DAY LOAD -----
  const loadWorkingDays = async () => {
    const list = await fetchWorkingDays();
    setWorkingDays(list || []);
  };

  // -------- ADD HOLIDAY -----
  const addHoliday = async () => {
    if (!newHolidayDate) return alert("Choose a date");
    try {
      await addHolidayFn(newHolidayDate, {
        label: holidayLabel,
        applyToAll: holidayApplyAll,
        users: holidayApplyAll ? [] : holidaySelectedUsers,
      });

      setNewHolidayDate("");
      setHolidayLabel("");
      setHolidayApplyAll(true);
      setHolidaySelectedUsers([]);
      loadHolidays();
    } catch (e) {
      console.error("addHoliday err", e);
      alert("Failed to add holiday");
    }
  };

  // -------- DELETE HOLIDAY -----
  const removeHoliday = async (id) => {
    if (!window.confirm("Delete holiday?")) return;
    await deleteDoc(doc(db, "holidays", id));
    loadHolidays();
  };

  // -------- ADD WORKING DAY -----
  const handleAddWorkingDay = async () => {
    if (!newWorkingDate) return alert("Choose date");
    try {
      await addWorkingDay(newWorkingDate, {
        label: workingLabel,
        applyToAll: workingApplyAll,
        users: workingApplyAll ? [] : workingSelectedUsers,
      });

      setNewWorkingDate("");
      setWorkingLabel("");
      setWorkingApplyAll(true);
      setWorkingSelectedUsers([]);
      loadWorkingDays();
    } catch (e) {
      console.error("add working day err", e);
      alert("Failed to add working day");
    }
  };

  // -------- DELETE WORKING DAY -----
  const removeWorkingDay = async (id) => {
    if (!window.confirm("Delete working day?")) return;
    await deleteWorkingDay(id);
    loadWorkingDays();
  };

  return (
    <div style={{ padding: 15 }}>
      {/* ---------------------------- HOLIDAY MANAGEMENT ---------------------------- */}
      <h3 style={{ color: "#800000" }}>Holiday Management</h3>

      <div style={{ marginBottom: 20 }}>
        <input
          type="date"
          value={newHolidayDate}
          onChange={(e) => setNewHolidayDate(e.target.value)}
          style={{ padding: 6, marginRight: 10 }}
        />
        <input
          placeholder="Label (optional)"
          value={holidayLabel}
          onChange={(e) => setHolidayLabel(e.target.value)}
          style={{ padding: 6, marginRight: 10 }}
        />

        <label style={{ marginRight: 8 }}>
          <input
            type="checkbox"
            checked={holidayApplyAll}
            onChange={(e) => setHolidayApplyAll(e.target.checked)}
          />{" "}
          Apply to all users
        </label>

        {!holidayApplyAll && (
          <select
            multiple
            value={holidaySelectedUsers}
            onChange={(e) =>
              setHolidaySelectedUsers(
                Array.from(e.target.selectedOptions).map((o) => o.value)
              )
            }
            style={{ display: "block", marginTop: 8, minHeight: 90 }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.name || u.email || u.id}
              </option>
            ))}
          </select>
        )}

        <div style={{ marginTop: 8 }}>
          <button
            onClick={addHoliday}
            style={{
              background: "#800000",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
            }}
          >
            ➕ Add Holiday
          </button>
        </div>
      </div>

      {/* Holiday list */}
      <div style={{ marginBottom: 30 }}>
        {holidays.map((h) => (
          <div
            key={h.id}
            style={{
              padding: 10,
              border: "1px solid #ddd",
              borderRadius: 6,
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div>
                <b>{h.date}</b> {h.label ? `— ${h.label}` : ""}
              </div>
              <div style={{ fontSize: 13, color: "#555" }}>
                {h.applyToAll
                  ? "Applies to: All users"
                  : `Applies to ${h.users?.length || 0} user(s)`}
              </div>
            </div>

            <button
              onClick={() => removeHoliday(h.id)}
              style={{
                background: "#ff5555",
                color: "#fff",
                padding: "5px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {/* ---------------------------- WORKING DAY MANAGEMENT ---------------------------- */}
      <h3 style={{ color: "#800000" }}>Working Day Management</h3>

      <div style={{ marginBottom: 20 }}>
        <input
          type="date"
          value={newWorkingDate}
          onChange={(e) => setNewWorkingDate(e.target.value)}
          style={{ padding: 6, marginRight: 10 }}
        />
        <input
          placeholder="Label (optional)"
          value={workingLabel}
          onChange={(e) => setWorkingLabel(e.target.value)}
          style={{ padding: 6, marginRight: 10 }}
        />

        <label style={{ marginRight: 8 }}>
          <input
            type="checkbox"
            checked={workingApplyAll}
            onChange={(e) => setWorkingApplyAll(e.target.checked)}
          />{" "}
          Apply to all users
        </label>

        {!workingApplyAll && (
          <select
            multiple
            value={workingSelectedUsers}
            onChange={(e) =>
              setWorkingSelectedUsers(
                Array.from(e.target.selectedOptions).map((o) => o.value)
              )
            }
            style={{ display: "block", marginTop: 8, minHeight: 90 }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.name || u.email || u.id}
              </option>
            ))}
          </select>
        )}

        <div style={{ marginTop: 8 }}>
          <button
            onClick={handleAddWorkingDay}
            style={{
              background: "green",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
            }}
          >
            ➕ Add Working Day
          </button>
        </div>
      </div>

      {/* Working day list */}
      <div>
        {workingDays.map((w) => (
          <div
            key={w.id}
            style={{
              padding: 10,
              border: "1px solid #ddd",
              borderRadius: 6,
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div>
                <b>{w.date}</b> — {w.label || "Working Day"}
              </div>
              <div style={{ fontSize: 13, color: "#555" }}>
                {w.applyToAll
                  ? "Applies to: All users"
                  : `Applies to ${w.users?.length || 0} user(s)`}
              </div>
            </div>

            <button
              onClick={() => removeWorkingDay(w.id)}
              style={{
                background: "#ff5555",
                color: "#fff",
                padding: "5px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
