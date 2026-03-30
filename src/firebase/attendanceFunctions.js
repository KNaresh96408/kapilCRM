// FIREBASE IMPORTS
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
} from "firebase/firestore";

import { db, serverTimestamp } from "./firebaseConfig";
import { fastCache } from "../helpers/fastCache";

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
  const TIMEOUT_MS = 2500;
  const cacheKey = 'kp-attendance-holidays-cache-v1';
  const cacheTtlMs = 10 * 60 * 1000;
  try {
    const cachedRaw = typeof window !== 'undefined' ? localStorage.getItem(cacheKey) : null;
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && Array.isArray(cached.data) && Date.now() - cached.ts < cacheTtlMs) {
        // background refresh
        fetchHolidays().catch(() => {});
        return cached.data;
      }
    }
  } catch (_) {}
  try {
    const snap = await Promise.race([
      getDocs(collection(db, "holidays")),
      new Promise((_, reject) => setTimeout(() => reject(new Error('holidays fetch timeout')), TIMEOUT_MS)),
    ]);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    try {
      if (typeof window !== 'undefined') localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: rows }));
    } catch (_) {}
    return rows;
  } catch (err) {
    console.warn('🟡 fetchHolidays DB failed, trying REST fallback', err && (err.message || err));
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        const { fetchDocumentREST } = await import('../helpers/firestoreRest');
        // Firestore REST returns map of fields per document; easier to call list docs via collection is not directly supported, so we fetch docs by listing known ids is not possible here — instead read all via collection REST list (documents:list)
        const projectId = (await import('../firebaseConfig')).default.options.projectId || 'kapil-power-crm';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/holidays`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) throw new Error('holidays REST fetch failed ' + resp.status);
        const body = await resp.json();
        const { fieldsToObject } = await import('../helpers/firestoreRest');
        const docs = (body.documents || []).map((doc) => {
          const id = doc.name.split('/').pop();
          const fields = doc.fields || {};
          return { id, ...fieldsToObject(fields) };
        });
        try {
          if (typeof window !== 'undefined') localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: docs }));
        } catch (_) {}
        return docs;
      }
    } catch (restErr) {
      console.warn('⚠️ fetchHolidays REST fallback failed', restErr && (restErr.message || restErr));
    }
    return [];
  }
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
  const TIMEOUT_MS = 2500;
  const cacheKey = 'kp-attendance-workingdays-cache-v1';
  const cacheTtlMs = 10 * 60 * 1000;
  try {
    const cachedRaw = typeof window !== 'undefined' ? localStorage.getItem(cacheKey) : null;
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && Array.isArray(cached.data) && Date.now() - cached.ts < cacheTtlMs) {
        // background refresh
        fetchWorkingDays().catch(() => {});
        return cached.data;
      }
    }
  } catch (_) {}
  try {
    const snap = await Promise.race([
      getDocs(collection(db, "attendance_workingDays")),
      new Promise((_, reject) => setTimeout(() => reject(new Error('workingDays fetch timeout')), TIMEOUT_MS)),
    ]);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    try {
      if (typeof window !== 'undefined') localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: rows }));
    } catch (_) {}
    return rows;
  } catch (err) {
    console.warn('🟡 fetchWorkingDays DB failed, trying REST fallback', err && (err.message || err));
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        const projectId = (await import('../firebaseConfig')).default.options.projectId || 'kapil-power-crm';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/attendance_workingDays`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) throw new Error('workingDays REST fetch failed ' + resp.status);
        const body = await resp.json();
        const { fieldsToObject } = await import('../helpers/firestoreRest');
        const docs = (body.documents || []).map((doc) => {
          const id = doc.name.split('/').pop();
          const fields = doc.fields || {};
          return { id, ...fieldsToObject(fields) };
        });
        try {
          if (typeof window !== 'undefined') localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: docs }));
        } catch (_) {}
        return docs;
      }
    } catch (restErr) {
      console.warn('⚠️ fetchWorkingDays REST fallback failed', restErr && (restErr.message || restErr));
    }
    return [];
  }
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
  const TIMEOUT_MS = 2500;
  const cacheKey = `kp-attendance-doc-${uid}_${dateStr}`;
  return fastCache({
    key: cacheKey,
    maxAgeMs: 30 * 1000,
    allowStaleMs: 6 * 60 * 60 * 1000,
    fetcher: async () => {
      try {
        const ref = doc(db, "attendance", `${uid}_${dateStr}`);
        const getPromise = getDoc(ref);
        const snap = await Promise.race([
          getPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('attendance doc fetch timeout')), TIMEOUT_MS)),
        ]);

        return snap && snap.exists && snap.exists() ? snap.data() : null;
      } catch (err) {
        console.warn('🟡 fetchAttendanceDoc DB failed, trying REST fallback', err && (err.message || err));
        try {
          const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
          const parsed = stored ? JSON.parse(stored) : null;
          const token = (parsed && parsed.idToken) || null;
          if (token) {
            const { fetchDocumentREST } = await import('../helpers/firestoreRest');
            const docPath = `attendance/${uid}_${dateStr}`;
            const restData = await fetchDocumentREST(docPath, token);
            return restData || null;
          }
        } catch (restErr) {
          console.warn('⚠️ fetchAttendanceDoc REST fallback failed', restErr && (restErr.message || restErr));
        }
        return null;
      }
    },
  });
}

// -------------------------------------------------------
// ATTENDANCE DOC (FRESH, BYPASS CACHE)
// -------------------------------------------------------
export async function fetchAttendanceDocFresh(uid, dateStr) {
  const TIMEOUT_MS = 2500;
  try {
    const ref = doc(db, "attendance", `${uid}_${dateStr}`);
    const getPromise = getDoc(ref);
    const snap = await Promise.race([
      getPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('attendance doc fetch timeout')), TIMEOUT_MS)),
    ]);

    return snap && snap.exists && snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn('🟡 fetchAttendanceDocFresh DB failed, trying REST fallback', err && (err.message || err));
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        const { fetchDocumentREST } = await import('../helpers/firestoreRest');
        const docPath = `attendance/${uid}_${dateStr}`;
        const restData = await fetchDocumentREST(docPath, token);
        return restData || null;
      }
    } catch (restErr) {
      console.warn('⚠️ fetchAttendanceDocFresh REST fallback failed', restErr && (restErr.message || restErr));
    }
    return null;
  }
}

export async function deleteAttendanceRecord(userId, dateStr) {
  if (!userId || !dateStr) {
    throw new Error("Missing userId/date for attendance delete");
  }
  await deleteDoc(doc(db, "attendance", `${userId}_${dateStr}`));
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

  const initialPoint = coords ? enrichLocationPoint(coords) : null;

await setDoc(
  ref,
  {
    userId: uid,
    userName: userName || "",
    date: dateStr,
    checkInTime: serverTimestamp(),
    _clientCheckIn: clientIso || new Date().toISOString(),
    checkInLocation: initialPoint || null,
    locations: initialPoint ? [initialPoint] : [],
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

  const withTs = enrichLocationPoint(coords || {});
  const updated = [...(data.locations || []), withTs];

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
export async function fetchAttendanceRange(from, to, _skipCache = false) {
  if (_skipCache) {
    return fetchAttendanceRangeRaw(from, to);
  }

  const cacheKey = `kp-attendance-range-${from}-${to}`;
  return fastCache({
    key: cacheKey,
    maxAgeMs: 30 * 1000,
    allowStaleMs: 10 * 60 * 1000,
    fetcher: () => fetchAttendanceRangeRaw(from, to),
  });
}

async function fetchAttendanceRangeRaw(from, to) {
  const TIMEOUT_MS = 4000;
  try {
    const q = query(
      collection(db, "attendance"),
      where("date", ">=", from),
      where("date", "<=", to),
      orderBy("date")
    );
    const snap = await Promise.race([
      getDocs(q),
      new Promise((_, reject) => setTimeout(() => reject(new Error('attendance range fetch timeout')), TIMEOUT_MS)),
    ]);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('🟡 fetchAttendanceRange DB failed, trying REST fallback', err && (err.message || err));
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        const projectId = (await import('./firebaseConfig')).default.options.projectId || 'kapil-power-crm';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
        const body = JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'attendance' }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: from } } },
                  { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: to } } },
                ],
              },
            },
          },
        });
        const resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error('attendance range REST failed ' + resp.status + ' ' + text);
        }
        const rows = await resp.json();
        const { fieldsToObject } = await import('../helpers/firestoreRest');
        const docs = rows.map((r) => (r.document ? { id: r.document.name.split('/').pop(), ...fieldsToObject(r.document.fields || {}) } : null)).filter(Boolean);
        return docs.filter((r) => r.date >= from && r.date <= to);
      }
    } catch (restErr) {
      console.warn('⚠️ fetchAttendanceRange REST fallback failed', restErr && (restErr.message || restErr));
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
        const parsed = stored ? JSON.parse(stored) : null;
        const token = (parsed && parsed.idToken) || null;
        if (token) {
          const { fetchCollectionREST } = await import('../helpers/firestoreRest');
          const all = await fetchCollectionREST('attendance', token);
          return (all || []).filter((r) => r.date >= from && r.date <= to);
        }
      } catch (restListErr) {
        console.warn('⚠️ fetchAttendanceRange REST list fallback failed', restListErr && (restListErr.message || restListErr));
      }
    }
    return [];
  }
}
