// FIREBASE IMPORTS
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "./firebaseConfig";

// -------------------------------------------------------
// Utility — get local YYYY-MM-DD (Timezone safe)
// -------------------------------------------------------
export const getTodayStr = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// -------------------------------------------------------
// HOLIDAYS
// -------------------------------------------------------
export async function fetchHolidays() {
  const snap = await getDocs(collection(db, "holidays"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addHoliday(date, payload = {}) {
  const ref = doc(db, "holidays", date);
  await setDoc(ref, {
    date,
    label: payload.label || "",
    applyToAll: payload.applyToAll ? true : false,
    users: payload.users || [],
    createdAt: serverTimestamp(),
  });
}

export async function deleteHoliday(id) {
  await deleteDoc(doc(db, "holidays", id));
}

// -------------------------------------------------------
// WORKING DAYS (attendance_workingDays)
// -------------------------------------------------------
export async function fetchWorkingDays() {
  const snap = await getDocs(collection(db, "attendance_workingDays"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// **ADDED — EXACTLY AS REQUIRED**
export async function addWorkingDay(date, payload = {}) {
  const ref = doc(db, "attendance_workingDays", date);
  await setDoc(ref, {
    date,
    label: payload.label || "",
    applyToAll: payload.applyToAll ? true : false,
    users: payload.users || [],
    createdAt: serverTimestamp(),
  });
}

export async function deleteWorkingDay(id) {
  await deleteDoc(doc(db, "attendance_workingDays", id));
}

// -------------------------------------------------------
// 🔍 Holiday Detector for ANY user
// -------------------------------------------------------
export function isHolidayForUser(dateStr, uid, holidayList) {
  if (!holidayList || !Array.isArray(holidayList)) return false;

  const found = holidayList.find((h) => h.date === dateStr);
  if (!found) return false;

  if (found.applyToAll) return true;

  return found.users?.includes(uid);
}

// -------------------------------------------------------
// 🔍 Working-Day Detector for ANY user
// -------------------------------------------------------
export function isWorkingDayForUser(dateStr, uid, workingList) {
  if (!workingList || !Array.isArray(workingList)) return false;

  const found = workingList.find((w) => w.date === dateStr);
  if (!found) return false;

  if (found.applyToAll) return true;

  return found.users?.includes(uid);
}

// -------------------------------------------------------
// ATTENDANCE SYSTEM
// -------------------------------------------------------
export async function fetchAttendanceDoc(uid, dateStr) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// CREATE IF NOT EXISTS
export async function createOrEnsureDoc(uid, userName, dateStr) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      userId: uid,
      userName,
      date: dateStr,
      createdAt: serverTimestamp(),
      checkInTime: null,
      _clientCheckIn: null,
      checkOutTime: null,
      locations: [],
      status: "absent",
      totalMinutes: 0,
    });
  }
}

// -------------------------------------------------------
// CHECK-IN
// -------------------------------------------------------
export async function checkIn({ uid, userName, dateStr, coords, clientIso }) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);

await setDoc(
  ref,
  {
    userId: uid,
    userName: userName || "",
    date: dateStr,
    checkInTime: serverTimestamp(),
    _clientCheckIn: clientIso || new Date().toISOString(),
    checkInLocation: coords || null,
    status: "present",
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);
}

// -------------------------------------------------------
// ADD LOCATION (EVERY 5 MIN)
// -------------------------------------------------------
export async function pollAddLocation({ uid, dateStr, coords }) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  const snap = await getDoc(ref);
  const data = snap.data() || {};

  const updated = [...(data.locations || []), coords];

await setDoc(
  ref,
  {
    userId: uid,
    userName: data.userName || "",
    locations: updated,
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);
}

// -------------------------------------------------------
// CHECK-OUT
// -------------------------------------------------------
export async function checkOut({ uid, dateStr, clientCheckOutDate }) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  const snap = await getDoc(ref);
  const data = snap.data() || {};

  let totalMinutes = data.totalMinutes || 0;

  try {
    let start = null;

    if (data._clientCheckIn) {
      start = new Date(data._clientCheckIn);
    } else if (data.checkInTime && typeof data.checkInTime.toDate === "function") {
      start = data.checkInTime.toDate();
    } else if (data.checkInTime) {
      start = new Date(data.checkInTime);
    }

    const end =
      clientCheckOutDate instanceof Date
        ? clientCheckOutDate
        : new Date(clientCheckOutDate);

    if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
      totalMinutes = Math.floor((end - start) / 60000);
      if (totalMinutes < 0) totalMinutes = 0;
    }
  } catch (e) {
    console.warn("checkOut calc error", e);
  }

await setDoc(
  ref,
  {
    userId: uid,
    userName: data.userName || "",
    checkOutTime: serverTimestamp(),
    totalMinutes,
    status: totalMinutes < 240 ? "half-day" : "present",
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);

  return { status: data.status, totalMinutes };
}

// -------------------------------------------------------
// RANGE FETCH
// -------------------------------------------------------
export async function fetchAttendanceRange(from, to) {
  const snap = await getDocs(collection(db, "attendance"));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return list.filter((r) => r.date >= from && r.date <= to);
}
