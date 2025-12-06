// src/lib/attendanceHelpers.js

import { db } from "../firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";

// --------------------------------------------
// FETCH ALL ATTENDANCE RECORDS FOR RANGE
// --------------------------------------------
export async function fetchAttendanceForMonth(startDate, endDate) {
  const snap = await getDocs(collection(db, "attendance"));

  const map = new Map();

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const uid = data.userId;

    if (!map.has(uid)) map.set(uid, {});

    map.get(uid)[data.date] = data;
  });

  return map;
}

// --------------------------------------------
// FETCH HOLIDAYS IN RANGE
// --------------------------------------------
export async function fetchHolidaysInRange(start, end) {
  const holSnap = await getDocs(collection(db, "holidays"));

  const holSet = new Set();

  holSnap.docs.forEach((d) => {
    const date = d.id;
    if (date >= start && date <= end) holSet.add(date);
  });

  return holSet;
}

// --------------------------------------------
// BUILD MONTH TABLE MATRIX
// --------------------------------------------
export function computeMonthlyMatrix(users, start, end, attMap, holidays) {
  const cols = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    cols.push(d.toISOString().slice(0, 10));
  }

  const rows = users.map((u) => {
    const rec = attMap.get(u.uid) || {};

    let present = 0;
    let totalMinutes = 0;
    let workingDays = 0;

    const row = { user: u.name };

    cols.forEach((date) => {
      if (holidays.has(date)) {
        row[date] = "H";
      } else if (rec[date]) {
        workingDays++;
        totalMinutes += rec[date].minutes || 0;
        present++;
        row[date] = "P";
      } else {
        workingDays++;
        row[date] = "A";
      }
    });

    row.__workingDays = workingDays;
    row.__presentDays = present;
    row.__totalMinutes = totalMinutes;

    return row;
  });

  return { cols, rows };
}
