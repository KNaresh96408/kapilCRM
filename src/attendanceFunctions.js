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
  const snap = await getDocs(collection(db, "holidays"));
  return snap.docs.map((d) => d.data().date);
}
