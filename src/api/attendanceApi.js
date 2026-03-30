// 🔵 READ-ONLY API LAYER
// ❌ No Firebase imports here
// ✅ Only HTTPS fetch to Cloud Functions

const API = import.meta.env.VITE_API_BASE;
// Example:
// https://asia-south1-kapil-power-crm.cloudfunctions.net

// -----------------------------------
// Helper: Auth Header
// -----------------------------------
const getSessionUser = () => {
  try {
    return JSON.parse(localStorage.getItem("kp-user") || "{}");
  } catch {
    return {};
  }
};

const getSessionUid = () => {
  const stored = getSessionUser();
  return stored?.uid || stored?.id || stored?.userId || "";
};

const getSessionRole = () => {
  const stored = getSessionUser();
  return String(stored?.role || stored?.Role || stored?.profile?.role || "").toLowerCase();
};

const isAdminRole = (role) =>
  ["admin", "sales_head", "director", "dgm", "agm", "hr_executive"].includes(role);

const authHeader = (includeUid = false) => {
  const stored = getSessionUser();

  if (!stored?.idToken) {
    throw new Error("Auth token missing");
  }

  const headers = {
    Authorization: `Bearer ${stored.idToken}`,
    "Content-Type": "application/json",
  };

  if (includeUid) {
    const uid = getSessionUid();
    if (uid) headers.uid = uid;
  }

  return headers;
};

// -----------------------------------
// TODAY ATTENDANCE
// -----------------------------------
export const getTodayAttendance = async () => {
  const res = await fetch(`${API}/getAttendanceToday`, {
    method: "GET",
    headers: authHeader(true),
  });

  if (!res.ok) {
    throw new Error(`getTodayAttendance failed (${res.status})`);
  }

  return await res.json();
};

// -----------------------------------
// ATTENDANCE RANGE
// (calendar / history / admin)
// -----------------------------------
export const getAttendanceRange = async (from, to) => {
  if (!from || !to) {
    throw new Error("from & to dates are required");
  }
  const uid = getSessionUid();
  const role = getSessionRole();
  const qs = new URLSearchParams({ from, to });
  if (uid && !isAdminRole(role)) {
    qs.set("uid", uid);
  }
  const res = await fetch(
    `${API}/getAttendanceRange?${qs.toString()}`,
    {
      method: "GET",
      headers: authHeader(),
    }
  );

  if (!res.ok) {
    throw new Error(`getAttendanceRange failed (${res.status})`);
  }

  return await res.json();
};

// -----------------------------------
// HOLIDAYS
// -----------------------------------
export const getHolidaysApi = async () => {
  const res = await fetch(`${API}/getHolidays`, {
    method: "GET",
    headers: authHeader(),
  });

  if (!res.ok) {
    throw new Error(`getHolidays failed (${res.status})`);
  }

  return await res.json();
};

// -----------------------------------
// WORKING DAYS
// -----------------------------------
export const getWorkingDaysApi = async () => {
  const res = await fetch(`${API}/getWorkingDays`, {
    method: "GET",
    headers: authHeader(),
  });

  if (!res.ok) {
    throw new Error(`getWorkingDays failed (${res.status})`);
  }

  return await res.json();
};