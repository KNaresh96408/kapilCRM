// ============================================================
// Attendance Functions
// ============================================================

import { 
  db, 
  serverTimestamp 
} from "./firebaseConfig";

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy
} from "firebase/firestore";
import { fetchCollectionREST } from "../helpers/firestoreRest";

// ------------------------------------------------------------
// CHECK-IN
// ------------------------------------------------------------
export async function markCheckIn(userId, dateString, location) {
  const ref = doc(db, "attendance", `${userId}_${dateString}`);

  await setDoc(
    ref,
    {
      userId,
      date: dateString,
      checkIn: serverTimestamp(),
      location,
      status: "present",
    },
    { merge: true }
  );

  return true;
}

// ------------------------------------------------------------
// CHECK-OUT
// ------------------------------------------------------------
export async function markCheckOut(userId, dateString, location) {
  const ref = doc(db, "attendance", `${userId}_${dateString}`);

  await updateDoc(ref, {
    checkOut: serverTimestamp(),
    checkoutLocation: location,
  });

  return true;
}

// ------------------------------------------------------------
// GET USER MONTH ATTENDANCE
// ------------------------------------------------------------
export async function fetchUserMonthAttendance(userId) {
  const month = new Date().toISOString().slice(0, 7); // 2025-11
  const start = month + "-01";
  const end = month + "-31";

  const q = query(
    collection(db, "attendance"),
    where("userId", "==", userId),
    where("date", ">=", start),
    where("date", "<=", end),
    orderBy("date", "asc")
  );

  const snap = await getDocs(q);

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ------------------------------------------------------------
// HOLIDAYS
// ------------------------------------------------------------
export async function addHoliday(dateString, reason = "Holiday") {
  await setDoc(doc(db, "holidays", dateString), {
    date: dateString,
    reason,
  });
}

export async function getHolidays() {
  try {
    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const token = stored.idToken;

    if (!token) throw new Error("No idToken for getHolidays");

    const { fetchCollectionREST } = await import("../helpers/firestoreRest");

    const rows = await fetchCollectionREST("holidays", token);

    return (rows || [])
      .map((d) => d.date)
      .filter(Boolean);
  } catch (e) {
    console.warn("getHolidays failed (REST)", e);
    return [];
  }
}