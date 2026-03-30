// ------------------------------------------------------------
//  src/services/attendanceService.js (FINAL STABLE VERSION)
// ------------------------------------------------------------

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  arrayUnion,
} from "firebase/firestore";
import { db, serverTimestamp } from "../../firebaseConfig";
import { fetchCollectionREST } from "../../helpers/firestoreRest";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

export const makeDocId = (uid, dateStr) => `${uid}_${dateStr}`;

export const getTodayStr = (d = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// ------------------------------------------------------------
// Fetch a single attendance doc
// ------------------------------------------------------------
export const fetchAttendanceDoc = async (uid, dateStr = null) => {
  const date = dateStr || getTodayStr();
  const id = makeDocId(uid, date);
  const ref = doc(db, "attendance", id);

  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// ------------------------------------------------------------
// Create doc if missing
// ------------------------------------------------------------
export const createOrEnsureDoc = async (uid, userName, dateStr = null) => {
  if (!uid) throw new Error("UID missing");

  const date = dateStr || getTodayStr();
  const id = makeDocId(uid, date);
  const ref = doc(db, "attendance", id);

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const base = {
      userId: uid,
      userName: userName || "",
      date,
      checkInTime: null,
      checkOutTime: null,
      checkInLocation: null,
      locations: [],
      totalMinutes: 0,
      status: "absent",
      createdAt: serverTimestamp(),
      _clientCheckIn: null,
    };
    await setDoc(ref, base);
    return { id, ...base };
  }

  return { id: snap.id, ...snap.data() };
};

// ------------------------------------------------------------
// CHECK IN
// ------------------------------------------------------------
export const checkIn = async ({ uid, userName, dateStr, coords }) => {
  const date = dateStr || getTodayStr();
  const id = makeDocId(uid, date);
  const ref = doc(db, "attendance", id);

  // Write check-in information
  await setDoc(
    ref,
    {
      userId: uid,
      userName: userName || "",
      date,
      checkInTime: serverTimestamp(),
      checkInLocation: coords ? { lat: coords.lat, lng: coords.lng } : null,
      status: "present",
      createdAt: serverTimestamp(),
      _clientCheckIn: new Date().toISOString(),
    },
    { merge: true }
  );

  // Add the initial tracking point
  if (coords) {
    await updateDoc(ref, {
      locations: arrayUnion({
        lat: coords.lat,
        lng: coords.lng,
        timestamp: new Date().toISOString(),
      }),
    });
  }

  return id;
};

// ------------------------------------------------------------
// Add a tracking point every 5 minutes
// ------------------------------------------------------------
export const pollAddLocation = async ({ uid, dateStr, coords }) => {
  if (!uid) throw new Error("UID missing");

  const date = dateStr || getTodayStr();
  const id = makeDocId(uid, date);
  const ref = doc(db, "attendance", id);

  await updateDoc(ref, {
    locations: arrayUnion({
      lat: coords.lat,
      lng: coords.lng,
      timestamp: new Date().toISOString(),
    }),
    updatedAt: serverTimestamp(),
  });
};

// ------------------------------------------------------------
// CHECK OUT
// ------------------------------------------------------------
export const checkOut = async ({ uid, dateStr, clientCheckOutDate }) => {
  if (!uid) throw new Error("UID missing");

  const date = dateStr || getTodayStr();
  const id = makeDocId(uid, date);
  const ref = doc(db, "attendance", id);

  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Attendance doc not found");

  const data = snap.data();

  let totalMinutes = 0;
  const now = clientCheckOutDate || new Date();

  // Calculate total minutes
  if (data._clientCheckIn) {
    const inTime = new Date(data._clientCheckIn);
    totalMinutes = Math.round((now - inTime) / 60000);
  }

  // Status logic
  const FULL = 9 * 60;
  const HALF = FULL / 2;

  let status = "absent";
  if (totalMinutes >= FULL) status = "present";
  else if (totalMinutes >= HALF) status = "half-day";

  await updateDoc(ref, {
    checkOutTime: serverTimestamp(),
    totalMinutes,
    status,
    updatedAt: serverTimestamp(),
  });

  return { id, totalMinutes, status };
};

// ADMIN — Load attendance range (iOS SAFE)
// ------------------------------------------------------------
export const fetchAttendanceRange = async (from, to) => {
  const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
  const token = stored.idToken;

  if (!token) {
    console.warn("No idToken found, cannot load attendance");
    return [];
  }

  const rows = await fetchCollectionREST("attendance", token);

  return (rows || []).filter(
    (d) => d.date && d.date >= from && d.date <= to
  );
};
