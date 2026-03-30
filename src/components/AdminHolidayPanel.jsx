// src/components/AdminHolidayPanel.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
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
  const [holidaySelectedUsers, setHolidaySelectedUsers] = useState([]);
  const [holidayUserQuery, setHolidayUserQuery] = useState("");
  const [showHolidayList, setShowHolidayList] = useState(false);

  // -------------- WORKING DAYS --------------
  const [workingDays, setWorkingDays] = useState([]);
  const [newWorkingDate, setNewWorkingDate] = useState("");
  const [workingLabel, setWorkingLabel] = useState("");
  const [workingSelectedUsers, setWorkingSelectedUsers] = useState([]);
  const [workingUserQuery, setWorkingUserQuery] = useState("");
  const [showWorkingDayList, setShowWorkingDayList] = useState(false);
  const [belongsToFilter, setBelongsToFilter] = useState("all");

  // users
  const [users, setUsers] = useState([]);

  useEffect(() => {
    loadHolidays();
    loadWorkingDays();
    loadUsers();
  }, []);

  useEffect(() => {
    const refresh = () => loadUsers();
    window.addEventListener("focus", refresh);
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30 * 1000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, []);

  // Helpers: resilient users fetch and name resolver
  const userNamesForList = (uids = []) => {
    if (!uids || !uids.length) return "0 users";
    const names = uids.map((id) => {
      const u = users.find((x) => x.id === id);
      return getUserDisplayName(u || { id });
    });
    const first = names.slice(0, 5).join(", ");
    return names.length > 5 ? `${first} + ${names.length - 5} more` : first;
  };

  const getUserDisplayName = (u) => {
    const plain = String(u?.displayName || u?.name || u?.Name || "").trim();
    if (plain) return plain;
    const email = String(u?.email || u?.Email || "").trim();
    if (email) return email.split("@")[0];
    return String(u?.id || "Unknown");
  };

  const getUserSearchBlob = (u) => {
    const name = getUserDisplayName(u).toLowerCase();
    const email = String(u?.email || u?.Email || "").toLowerCase();
    return `${name} ${email}`.trim();
  };

  const loadUsers = async () => {
    try {
      const rows = await import('../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('Users'));
      const list = rows.map((r) => ({ id: r.id, ...r }));
      setUsers(list);
    } catch (e) {
      console.warn("users fetch error (fallback)", e);
      // fallback to direct DB read as last resort
     try {
  const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
  const token = stored.idToken;

  if (!token) throw new Error("No idToken");

  // ✅ iOS-safe REST fetch
  const { fetchCollectionREST } = await import("../helpers/firestoreRest");

  const rows = await fetchCollectionREST("Users", token);

  const list = (rows || []).map((u) => ({
    id: u.id,
    ...u,
  }));

  setUsers(list);
} catch (e) {
  console.warn("users fetch error (REST)", e);
  setUsers([]);
}}};

  const normalizeBelongsTo = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const belongsToFilteredUsers =
    belongsToFilter === "all"
      ? users
      : users.filter((u) => normalizeBelongsTo(u.belongsTo || u.belongs_to || u.team) === belongsToFilter);

  const holidayFilteredUsers = belongsToFilteredUsers.filter((u) => {
    const q = String(holidayUserQuery || "").trim().toLowerCase();
    if (!q) return true;
    return getUserSearchBlob(u).includes(q);
  });

  const workingFilteredUsers = belongsToFilteredUsers.filter((u) => {
    const q = String(workingUserQuery || "").trim().toLowerCase();
    if (!q) return true;
    return getUserSearchBlob(u).includes(q);
  });

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
    if (!holidaySelectedUsers.length) return alert("Select at least one user");
    try {
      await addHolidayFn(newHolidayDate, {
        label: holidayLabel,
        applyToAll: false,
        users: holidaySelectedUsers,
      });

      setNewHolidayDate("");
      setHolidayLabel("");
      setHolidaySelectedUsers([]);
      setHolidayUserQuery("");
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
    if (!workingSelectedUsers.length) return alert("Select at least one user");
    try {
      await addWorkingDay(newWorkingDate, {
        label: workingLabel,
        applyToAll: false,
        users: workingSelectedUsers,
      });

      setNewWorkingDate("");
      setWorkingLabel("");
      setWorkingSelectedUsers([]);
      setWorkingUserQuery("");
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

  const renderSelectedChips = (selected, setSelected, tone = "holiday") => (
    <div style={{ marginTop: 8 }}>
      <div style={styles.selectedTitle}>Selected users ({selected.length})</div>
      {!selected.length ? (
        <div style={styles.emptyHint}>No users selected yet.</div>
      ) : (
        <div style={styles.chipWrap}>
          {selected.map((uid) => {
            const u = users.find((x) => x.id === uid);
            return (
              <button
                key={uid}
                type="button"
                onClick={() => setSelected((prev) => prev.filter((x) => x !== uid))}
                style={{
                  ...styles.chip,
                  ...(tone === "working" ? styles.chipWorking : styles.chipHoliday),
                }}
                title="Remove"
              >
                {getUserDisplayName(u)} ×
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderSelectableUsers = (filtered, selected, setSelected, tone = "holiday") => (
    <>
      <div style={styles.listMeta}>Showing {filtered.length} users</div>
      <div style={styles.resultsBoxLarge}>
        {filtered.map((u) => {
          const active = selected.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                )
              }
              style={{
                ...styles.resultItem,
                ...(active ? (tone === "working" ? styles.resultItemActiveWorking : styles.resultItemActiveHoliday) : {}),
              }}
            >
              <span style={styles.resultItemCheck}>{active ? "☑" : "☐"}</span>
              <span>{getUserDisplayName(u)}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div style={styles.wrapper}>
      {/* ---------------------------- HOLIDAY MANAGEMENT ---------------------------- */}
      <h3 style={styles.sectionTitle}>Holiday Management</h3>

      <div style={styles.topFilterRow}>
        <label style={styles.topFilterLabel}>Belongs To</label>
        <select
          value={belongsToFilter}
          onChange={(e) => {
            setBelongsToFilter(e.target.value);
            setHolidaySelectedUsers([]);
            setWorkingSelectedUsers([]);
            setHolidayUserQuery("");
            setWorkingUserQuery("");
          }}
          style={styles.teamSelect}
        >
          <option value="all">All Teams</option>
          <option value="rooftop">Kapil Power Rooftop Team</option>
          <option value="operations">Kapil Power Operations Team</option>
        </select>
      </div>

      <div style={styles.sectionCard}>
        <div style={styles.fieldRow}>
        <input
          type="date"
          value={newHolidayDate}
          onChange={(e) => setNewHolidayDate(e.target.value)}
          style={styles.input}
        />
        <input
          placeholder="Label (optional)"
          value={holidayLabel}
          onChange={(e) => setHolidayLabel(e.target.value)}
          style={styles.input}
        />
        </div>

        <div style={{ marginTop: 10, marginBottom: 8 }}>
          <div style={styles.labelTiny}>
            Select Users (Type name or mail)
          </div>
          <input
            value={holidayUserQuery}
            onChange={(e) => setHolidayUserQuery(e.target.value)}
            placeholder="Enter name or mail"
            style={styles.inputWide}
          />

          {renderSelectedChips(holidaySelectedUsers, setHolidaySelectedUsers, "holiday")}

          {renderSelectableUsers(holidayFilteredUsers, holidaySelectedUsers, setHolidaySelectedUsers, "holiday")}
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            onClick={addHoliday}
            style={styles.addHolidayBtn}
          >
            ➕ Add Holiday
          </button>
        </div>
      </div>

      {/* Holiday list */}
      <div style={{ marginBottom: 30 }}>
        <button
          type="button"
          onClick={() => setShowHolidayList((prev) => !prev)}
          style={styles.toggleListBtn}
        >
          {showHolidayList ? "Hide Existing Holidays" : "Existing Holidays"} ({holidays.length})
        </button>

        {showHolidayList && (
          <div style={{ marginTop: 10 }}>
            {holidays.map((h) => (
              <div
                key={h.id}
                style={styles.rowCard}
              >
                <div>
                  <div>
                    <b>{h.date}</b> {h.label ? `— ${h.label}` : ""}
                  </div>
                  <div style={styles.appliesText}>
                    {h.applyToAll ? (
                      "Applies to: All users"
                    ) : (
                      <span>Applies to: {h.users && h.users.length ? userNamesForList(h.users) : '0 users'}</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => removeHoliday(h.id)}
                  style={styles.deleteBtn}
                >
                  Delete
                </button>
              </div>
            ))}
            {!holidays.length && <div style={styles.emptyHint}>No holidays found.</div>}
          </div>
        )}
      </div>

      {/* ---------------------------- WORKING DAY MANAGEMENT ---------------------------- */}
      <h3 style={styles.sectionTitle}>Working Day Management</h3>

      <div style={styles.sectionCard}>
        <div style={styles.fieldRow}>
        <input
          type="date"
          value={newWorkingDate}
          onChange={(e) => setNewWorkingDate(e.target.value)}
          style={styles.input}
        />
        <input
          placeholder="Label (optional)"
          value={workingLabel}
          onChange={(e) => setWorkingLabel(e.target.value)}
          style={styles.input}
        />
        </div>
        <div style={{ marginTop: 10, marginBottom: 8 }}>
          <div style={styles.labelTiny}>
            Select Users (Type name or mail)
          </div>
          <input
            value={workingUserQuery}
            onChange={(e) => setWorkingUserQuery(e.target.value)}
            placeholder="Enter name or mail"
            style={styles.inputWide}
          />

          {renderSelectedChips(workingSelectedUsers, setWorkingSelectedUsers, "working")}

          {renderSelectableUsers(workingFilteredUsers, workingSelectedUsers, setWorkingSelectedUsers, "working")}
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            onClick={handleAddWorkingDay}
            style={styles.addWorkingBtn}
          >
            ➕ Add Working Day
          </button>
        </div>
      </div>

      {/* Working day list */}
      <div>
        <button
          type="button"
          onClick={() => setShowWorkingDayList((prev) => !prev)}
          style={styles.toggleListBtn}
        >
          {showWorkingDayList ? "Hide Existing Working Days" : "Existing Working Days"} ({workingDays.length})
        </button>

        {showWorkingDayList && (
          <div style={{ marginTop: 10 }}>
            {workingDays.map((w) => (
              <div
                key={w.id}
                style={styles.rowCard}
              >
                <div>
                  <div>
                    <b>{w.date}</b> — {w.label || "Working Day"}
                  </div>
                  <div style={styles.appliesText}>
                    {w.applyToAll ? (
                      "Applies to: All users"
                    ) : (
                      <span>Applies to: {w.users && w.users.length ? userNamesForList(w.users) : '0 users'}</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => removeWorkingDay(w.id)}
                  style={styles.deleteBtn}
                >
                  Delete
                </button>
              </div>
            ))}
            {!workingDays.length && <div style={styles.emptyHint}>No working days found.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    padding: 15,
  },
  sectionTitle: {
    color: "#800000",
    marginBottom: 10,
  },
  topFilterRow: {
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  topFilterLabel: {
    fontWeight: 700,
    color: "#374151",
  },
  teamSelect: {
    padding: 7,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    minWidth: 220,
  },
  sectionCard: {
    marginBottom: 20,
    padding: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
  },
  fieldRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  input: {
    padding: 8,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    minWidth: 170,
  },
  inputWide: {
    padding: 8,
    width: 360,
    maxWidth: "100%",
    borderRadius: 8,
    border: "1px solid #d1d5db",
  },
  labelTiny: {
    fontSize: 12,
    fontWeight: 700,
    color: "#555",
    marginBottom: 6,
  },
  selectedTitle: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 6,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  emptyHint: {
    fontSize: 12,
    color: "#9ca3af",
  },
  chipWrap: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  chip: {
    borderRadius: 999,
    padding: "4px 9px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
  },
  chipHoliday: {
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#9f1239",
  },
  chipWorking: {
    border: "1px solid #bbf7d0",
    background: "#ecfdf5",
    color: "#166534",
  },
  resultsBox: {
    maxHeight: 150,
    overflowY: "auto",
    marginTop: 8,
    border: "1px solid #eee",
    borderRadius: 8,
    background: "#fff",
  },
  resultsBoxLarge: {
    maxHeight: 260,
    overflowY: "auto",
    marginTop: 8,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    background: "#fff",
  },
  listMeta: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
    fontWeight: 600,
  },
  resultItem: {
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottom: "1px solid #f3f4f6",
    background: "#fff",
    padding: "7px 8px",
    cursor: "pointer",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  resultItemCheck: {
    fontSize: 14,
    width: 16,
    textAlign: "center",
  },
  resultItemActiveHoliday: {
    background: "#fff1f2",
    color: "#9f1239",
  },
  resultItemActiveWorking: {
    background: "#ecfdf5",
    color: "#166534",
  },
  addHolidayBtn: {
    background: "#800000",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
  },
  addWorkingBtn: {
    background: "#047857",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
  },
  rowCard: {
    padding: 10,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    marginBottom: 8,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    background: "#fff",
  },
  appliesText: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  deleteBtn: {
    background: "#ef4444",
    color: "#fff",
    padding: "6px 10px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  },
  toggleListBtn: {
    background: "#f8fafc",
    color: "#1f2937",
    border: "1px solid #cbd5e1",
    padding: "8px 12px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
  },
};
