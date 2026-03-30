// 🔥 WRITES ONLY — SAFE FOR iOS

import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";

import { db, serverTimestamp } from "./firebaseConfig";

// In-memory cache of locations per docPath to avoid read-before-write delays
const locationsCache = new Map();

const format12HourTime = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

const enrichLocationPoint = (coords = {}) => {
  const capturedAtMs = Date.now();
  const ts = new Date(capturedAtMs).toISOString();
  return {
    ...coords,
    sourceTimestamp: coords?.timestamp || null,
    capturedAtMs,
    capturedAtIso: ts,
    capturedAt12h: format12HourTime(ts),
    timestamp: ts,
    time12h: format12HourTime(ts),
  };
};

// ⏱️ Write with timeout + REST fallback
async function setDocWithFallback(docPath, data, options = {}) {
  const TIMEOUT_MS = 3000;
  const ref = doc(db, ...docPath.split('/'));
  
  try {
    const setPromise = setDoc(ref, data, options);
    await Promise.race([
      setPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('write timeout')), TIMEOUT_MS)),
    ]);
    return;
  } catch (err) {
    console.warn('🟡 Firestore write failed, trying REST fallback', {
      message: err?.message,
      code: err?.code,
      name: err?.name,
    });
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;

      const { updateDocumentREST, createDocumentREST } = await import('../helpers/firestoreRest');
      // Split docPath: "attendance/uid_dateStr" → "attendance" + "uid_dateStr"
      const [collection, docId] = docPath.split('/');

      // Convert Firestore serverTimestamp sentinel to Date for REST
      const restData = { ...data };
      if (data.updatedAt && data.updatedAt._methodName === 'serverTimestamp') {
        restData.updatedAt = new Date();
      }
      if (data.createdAt && data.createdAt._methodName === 'serverTimestamp') {
        restData.createdAt = new Date();
      }
      if (data.checkInTime && data.checkInTime._methodName === 'serverTimestamp') {
        restData.checkInTime = new Date();
      }
      if (data.checkOutTime && data.checkOutTime._methodName === 'serverTimestamp') {
        restData.checkOutTime = new Date();
      }

      // Try update first (merge-like). If it fails (e.g., doc missing), create.
      try {
        await updateDocumentREST(collection, docId, restData, token || null);
      } catch (updateErr) {
        await createDocumentREST(collection, restData, token || null, docId);
      }
      return;
    } catch (restErr) {
      console.warn('⚠️ REST fallback also failed', {
        message: restErr?.message,
        code: restErr?.code,
        name: restErr?.name,
        raw: restErr,
      });
      const errMsg = (restErr && restErr.message) || (err && err.message) || 'unknown error';
      throw new Error(`Write failed: ${errMsg}`);
    }
  }
}

// -------------------------------
// Utility — get local YYYY-MM-DD
// -------------------------------
export const getTodayStr = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// -------------------------------
// CREATE attendance doc if missing
// -------------------------------
export async function createOrEnsureDoc(uid, userName, dateStr) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDocWithFallback(`attendance/${uid}_${dateStr}`, {
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

// -------------------------------
// CHECK-IN
// -------------------------------
export async function checkIn({ uid, userName, dateStr, coords, clientIso }) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  const initialPoint = coords ? enrichLocationPoint(coords) : null;
  const cacheKey = `attendance/${uid}_${dateStr}`;
  if (initialPoint) locationsCache.set(cacheKey, [initialPoint]);
  const data = {
    userId: uid,
    userName: userName || "",
    date: dateStr,
    checkInTime: serverTimestamp(),
    _clientCheckIn: clientIso || new Date().toISOString(),
    checkInLocation: coords || null,
    locations: initialPoint ? [initialPoint] : [],
    status: "present",
    updatedAt: serverTimestamp(),
  };

  // Use fallback-enabled write
  await setDocWithFallback(`attendance/${uid}_${dateStr}`, data, { merge: true });
}

// -------------------------------
// ADD LOCATION (polling)
// -------------------------------
export async function pollAddLocation({ uid, dateStr, coords }) {
  const point = enrichLocationPoint(coords || {});
  const cacheKey = `attendance/${uid}_${dateStr}`;
  let existing = locationsCache.get(cacheKey) || [];
  if (existing.length === 0) {
    // try to seed cache from backend once to avoid overwriting existing locations
    try {
      const ref = doc(db, "attendance", `${uid}_${dateStr}`);
      const snap = await Promise.race([
        getDoc(ref),
        new Promise((_, reject) => setTimeout(() => reject(new Error("seed timeout")), 800)),
      ]);
      const data = snap?.data ? snap.data() : {};
      existing = Array.isArray(data.locations) ? data.locations : [];
    } catch (err) {
      try {
        const { fetchDocumentREST } = await import('../helpers/firestoreRest');
        const docPath = `attendance/${uid}_${dateStr}`;
        const restData = await fetchDocumentREST(docPath, null);
        existing = Array.isArray(restData?.locations) ? restData.locations : [];
      } catch (_) {
        existing = [];
      }
    }
  }
  const updated = [...existing, point];
  locationsCache.set(cacheKey, updated);
  const writeData = {
    userId: uid,
    locations: updated,
    updatedAt: serverTimestamp(),
  };

  // Use fallback-enabled write
  await setDocWithFallback(`attendance/${uid}_${dateStr}`, writeData, { merge: true });
  console.log("🟢 pollAddLocation write success", {
    uid,
    dateStr,
    timestamp: point?.timestamp || null,
    lat: point?.lat,
    lng: point?.lng,
  });
}

// -------------------------------
// CHECK-OUT
// -------------------------------
export async function checkOut({ uid, dateStr, clientCheckOutDate, clientCheckInIso = null }) {
  const ref = doc(db, "attendance", `${uid}_${dateStr}`);
  let data = {};
  if (!clientCheckInIso) {
    try {
      const snap = await Promise.race([
        getDoc(ref),
        new Promise((_, reject) => setTimeout(() => reject(new Error("checkout read timeout")), 1500)),
      ]);
      data = snap?.data ? snap.data() : {};
    } catch (err) {
      try {
        const stored = typeof window !== "undefined" ? localStorage.getItem("kp-user") : null;
        const parsed = stored ? JSON.parse(stored) : null;
        const token = (parsed && parsed.idToken) || null;
        if (token) {
          const { fetchDocumentREST } = await import("../helpers/firestoreRest");
          const docPath = `attendance/${uid}_${dateStr}`;
          const restData = await fetchDocumentREST(docPath, token);
          data = restData || {};
        }
      } catch (restErr) {
        data = {};
      }
    }
  }

  let totalMinutes = data.totalMinutes || 0;

  try {
    let start = null;

    if (clientCheckInIso) {
      start = new Date(clientCheckInIso);
    } else if (data._clientCheckIn) {
      start = new Date(data._clientCheckIn);
    } else if (data.checkInTime?.toDate) {
      start = data.checkInTime.toDate();
    }

    const end =
      clientCheckOutDate instanceof Date
        ? clientCheckOutDate
        : new Date(clientCheckOutDate);

    if (start && end) {
      totalMinutes = Math.max(
        0,
        Math.floor((end - start) / 60000)
      );
    }
  } catch (e) {
    console.warn("checkOut calc error", e);
  }

  const writeData = {
    checkOutTime: serverTimestamp(),
    totalMinutes,
    status: totalMinutes < 240 ? "half-day" : "present",
    updatedAt: serverTimestamp(),
  };

  // Use fallback-enabled write
  await setDocWithFallback(`attendance/${uid}_${dateStr}`, writeData, { merge: true });

  return { totalMinutes };
}