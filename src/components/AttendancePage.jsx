// src/components/AttendancePage.jsx  (FINAL — dual-map + export popup + admin inspect map drawing)
// Note: This file expects the helper functions you already have in ../firebase/attendanceFunctions
// and components LeaveRequest, AdminHolidayPanel, AttendanceMonthCalendar, plus getUserRoleFromDB.
// It also expects Leaflet available as a dynamic import when used.

import React, { useEffect, useState, useRef } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import {
  AttendanceService,
  setBackgroundLocationHandler,
  clearBackgroundLocationHandler,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "../native/AttendanceService";


import kapilLogo from "../kapil-logo.png";
import { useNavigate } from "react-router-dom";


// ------------------------------
// FOREGROUND LOCATION PERMISSION
// ------------------------------
async function requestLocationPermission() {
  try {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions();

      if (
        perm.location === "granted" ||
        perm.coarseLocation === "granted"
      ) {
        return true;
      }

      return false;
    }

    // Web fallback
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { enableHighAccuracy: true }
      );
    });
  } catch (e) {
    console.error("Location permission error:", e);
    return false;
  }
}

// ------------------------------
// BACKGROUND LOCATION PERMISSION (Android only)
// ------------------------------
async function requestBackgroundLocation() {
  if (!Capacitor.isNativePlatform()) return true;

  if (Capacitor.getPlatform() === "ios") return false;

  try {
    const perm = await Geolocation.checkPermissions();

    // Foreground not granted → stop
    if (
      perm.location !== "granted" &&
      perm.coarseLocation !== "granted"
    ) {
      alert("Please allow location permission first.");
      return false;
    }

    // Android 10+ → ask user to allow background manually
    if (Capacitor.getPlatform() === "android") {
      alert(
        "For background tracking, please allow Location → 'Allow all the time' in App Settings."
      );
      window.open("app-settings:/", "_self");
    }

    return true;
  } catch (e) {
    console.warn("Background permission error", e);
    return false;
  }
}
async function requestNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return true;

  const perm = await LocalNotifications.requestPermissions();
  return perm.display === "granted";
}

// 🔵 READS
import {
  getTodayAttendance,
  getAttendanceRange,
  getHolidaysApi,
  getWorkingDaysApi,
} from "../api/attendanceApi";

// 🟢 DIRECT FIRESTORE READS (with REST fallback)
import {
  fetchHolidays,
  fetchWorkingDays,
  fetchAttendanceRange,
} from "../firebase/attendanceFunctions";

// 🟢 WRITES
import {
  createOrEnsureDoc,
  checkIn,
  pollAddLocation,
  checkOut,
  getTodayStr,
} from "../firebase/attendanceWrites";

// 🟡 ATTENDANCE DOC FETCH
import {
  fetchAttendanceDoc,
  fetchAttendanceDocFresh,
  deleteAttendanceRecord,
} from "../firebase/attendanceFunctions";

import LeaveRequest from "./LeaveRequest";
import * as XLSX from "xlsx";
import AttendanceMonthCalendar from "./AttendanceMonthCalendar";
import AdminHolidayPanel from "./AdminHolidayPanel";
import ApprovedLeavePanel from "./ApprovedLeavePanel";
import LeaveApprovalsPanel from "./LeaveApprovalsPanel";
import ActiveInactiveToday from "./ActiveInactiveToday";
import { getUserRoleFromDB } from "../helpers/getUserRole";
import { useAuth } from "../context/AuthContext";
import { getUserNameFromDB } from "../helpers/getUserName";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";
import { fetchCollectionREST } from "../helpers/firestoreRest";
import SearchableSelect from "./Universal/SearchableSelect";
import { BRAND_MAROON_PURPLE_GRADIENT } from "../styles/brandTheme";


// Detect if GPS permission is denied
async function isLocationPermissionDenied() {
  try {
    if (!navigator.permissions) return false;
    const p = await navigator.permissions.query({ name: "geolocation" });
    return p.state === "denied";
  } catch (e) {
    return false;
  }
}

// dynamic leaflet import target
let L = null;

let foregroundNotified = false;


// load logged-in user from localStorage (your app already uses this)// <-- use real logged-in user from AuthContext

// helper: detect admin-like users
const isAdminUser = (role, user) => {
  if (role === "admin") return true;
  const adminEmails = ["loan@kapilpower.com", "kapiladmin@gmail.com"];
  const adminUIDs = ["26VHcREEDMMg8C24kXYVGzRXHe43"];
  if (user?.email && adminEmails.includes(user.email)) return true;
  if (user?.uid && adminUIDs.includes(user.uid)) return true;
  return false;
};

const canonicalRole = (raw) => {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  const compact = normalized.replace(/_/g, "");
  if (normalized === "finance" || normalized === "finance_manager" || normalized === "financemanager" || compact === "financemanager") return "dgm";
  if (normalized === "dgm" || compact === "dgm") return "dgm";
  if (normalized === "agm" || compact === "agm") return "agm";
  if (normalized === "hrexecutive" || compact === "hrexecutive") return "hr_executive";
  if (normalized === "saleshead" || compact === "saleshead") return "sales_head";
  if (normalized === "hroperationsmanager" || normalized === "hr_operations_manager" || compact === "hroperationsmanager") return "agm";
  return normalized;
};

const normalizeBelongsTo = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeWorkType = (value) => {
  const v = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!v) return "";
  if (v.includes("remote")) return "remote";
  if (v.includes("off") || v.includes("field")) return "off-site";
  if (v.includes("on") || v.includes("office")) return "onsite";
  return v;
};

const BELONGS_TO_OPTIONS = [
  { value: "all", label: "All Teams" },
  { value: "rooftop", label: "Kapil Power Rooftop Team" },
  { value: "operations", label: "Kapil Power Operations Team" },
];

// Map UID → display name using userList with immediate per-record fallback
const getUserNameById = (id, userList, fallbackName = "", fallbackEmail = "") => {
  const userObj = userList.find((u) => u.id === id);
  if (userObj) {
    return userObj.email ? `${userObj.name} (${userObj.email})` : userObj.name;
  }

  const safeFallbackName = String(fallbackName || "").trim();
  const safeFallbackEmail = String(fallbackEmail || "").trim();
  if (safeFallbackName && safeFallbackName !== id) {
    return safeFallbackEmail ? `${safeFallbackName} (${safeFallbackEmail})` : safeFallbackName;
  }
  if (safeFallbackEmail) return safeFallbackEmail;

  return id; // final fallback = UID
};

const getLocationTime12h = (locationPoint) => {
  if (locationPoint?.capturedAt12h) return locationPoint.capturedAt12h;
  if (locationPoint?.time12h) return locationPoint.time12h;

  const epoch = Number(locationPoint?.capturedAtMs || 0);
  if (epoch > 0) {
    const fromEpoch = new Date(epoch);
    if (!Number.isNaN(fromEpoch.getTime())) {
      return fromEpoch.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    }
  }

  const ts = locationPoint?.capturedAtIso || locationPoint?.timestamp || locationPoint?.sourceTimestamp;
  if (!ts) {
    return new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

const getCoordKey = (lat, lng) => {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return "";
  return `${nLat.toFixed(6)},${nLng.toFixed(6)}`;
};

const distanceMeters = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getPointLocationFallbackLabel = (point = {}) => {
  const rawLabel = [
    point?.placeName,
    point?.locationName,
    point?.locality,
    point?.address,
    point?.display_name,
    point?.city,
    point?.state,
    point?.country,
  ]
    .map((v) => String(v || "").trim())
    .find(Boolean);

  if (rawLabel) return rawLabel;

  const rawLat = point?.lat ?? point?.latitude ?? point?.coords?.lat ?? point?.coords?.latitude;
  const rawLng = point?.lng ?? point?.lon ?? point?.longitude ?? point?.coords?.lng ?? point?.coords?.longitude;
  const nLat = Number(rawLat);
  const nLng = Number(rawLng);
  if (Number.isFinite(nLat) && Number.isFinite(nLng)) {
    return `Lat ${nLat.toFixed(5)}, Lng ${nLng.toFixed(5)}`;
  }

  return "Location unavailable";
};

const shortPlaceFromReverse = (payload) => {
  const a = payload?.address || {};
  const locality =
    a.suburb ||
    a.neighbourhood ||
    a.city_district ||
    a.village ||
    a.town ||
    a.city ||
    a.county ||
    "";
  const state = a.state || "";
  const country = a.country || "";
  const compact = [locality, state, country].filter(Boolean).join(", ");
  if (compact) return compact;

  const fallback = String(payload?.display_name || "").trim();
  if (!fallback) return "Location not found";
  return fallback.length > 72 ? `${fallback.slice(0, 72)}…` : fallback;
};

const normalizeInspectLocations = (doc = {}) => {
  const list = Array.isArray(doc?.locations) ? doc.locations : [];
  if (!list.length) return list;

  const fallbackFromDoc = (() => {
    const v = doc?.updatedAt?.toDate?.() || doc?.createdAt?.toDate?.() || doc?.updatedAt || doc?.createdAt;
    const d = v ? new Date(v) : new Date();
    return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
  })();

  let cursor = fallbackFromDoc;

  return list.map((p, idx) => {
    const knownMs = Number(p?.capturedAtMs || 0);
    const ts = p?.capturedAtIso || p?.timestamp || p?.sourceTimestamp;
    const tsMs = ts ? new Date(ts).getTime() : NaN;
    const resolvedMs =
      knownMs > 0
        ? knownMs
        : !Number.isNaN(tsMs)
        ? tsMs
        : idx === 0
        ? fallbackFromDoc
        : cursor + 1000;

    cursor = resolvedMs;
    const iso = new Date(resolvedMs).toISOString();
    const time12h = new Date(resolvedMs).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    return {
      ...p,
      capturedAtMs: resolvedMs,
      capturedAtIso: p?.capturedAtIso || iso,
      capturedAt12h: p?.capturedAt12h || time12h,
      timestamp: p?.timestamp || iso,
      time12h: p?.time12h || time12h,
      sourceTimestamp: p?.sourceTimestamp || p?.timestamp || null,
    };
  });
};


// ms -> hh:mm:ss
const msToHMS = (ms) => {
  if (!ms || ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

// half-day threshold (minutes)
const HALF_DAY_MIN = 240; // 4 hours

const isMobile = window.matchMedia("(max-width: 768px)").matches; 
const isNative = Capacitor.isNativePlatform();

const getLocalCheckInKey = (uid, dateStr) => `kp-attendance-checkin:${uid || ""}:${dateStr || ""}`;
const getAttendanceCacheKey = (uid, dateStr) => `kp-attendance-doc-${uid || ""}_${dateStr || ""}`;

const setLocalCheckIn = (uid, dateStr, iso) => {
  try {
    if (!uid || !dateStr || !iso) return;
    localStorage.setItem(getLocalCheckInKey(uid, dateStr), JSON.stringify({ iso }));
  } catch (_) {}
};

const getLocalCheckIn = (uid, dateStr) => {
  try {
    const raw = localStorage.getItem(getLocalCheckInKey(uid, dateStr));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.iso || "";
  } catch (_) {
    return "";
  }
};

const clearLocalCheckIn = (uid, dateStr) => {
  try {
    localStorage.removeItem(getLocalCheckInKey(uid, dateStr));
  } catch (_) {}
};

const getCheckInIsoFromAttendance = (doc) => {
  if (!doc) return "";
  if (doc._clientCheckIn) return String(doc._clientCheckIn);
  if (doc.checkInTime?.toDate) {
    try {
      return doc.checkInTime.toDate().toISOString();
    } catch (_) {
      return "";
    }
  }
  if (typeof doc.checkInTime === "string") {
    const d = new Date(doc.checkInTime);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (doc.checkIn?.toDate) {
    try {
      return doc.checkIn.toDate().toISOString();
    } catch (_) {
      return "";
    }
  }
  if (typeof doc.checkIn === "string") {
    const d = new Date(doc.checkIn);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
};

const toIsoString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      return "";
    }
  }
  if (typeof value?.seconds === "number") {
    try {
      return new Date(value.seconds * 1000).toISOString();
    } catch (_) {
      return "";
    }
  }
  try {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  } catch (_) {
    return "";
  }
};

const normalizeAttendanceCache = (data) => {
  if (!data || typeof data !== "object") return data;
  const checkInIso = toIsoString(data.checkInTime) || data._clientCheckIn || "";
  const checkOutIso = toIsoString(data.checkOutTime) || data._clientCheckOut || "";
  return {
    ...data,
    checkInTime: checkInIso || data.checkInTime || null,
    checkOutTime: checkOutIso || data.checkOutTime || null,
    _clientCheckIn: data._clientCheckIn || checkInIso || null,
    _clientCheckOut: data._clientCheckOut || checkOutIso || null,
  };
};

const writeAttendanceCache = (uid, dateStr, data) => {
  try {
    if (!uid || !dateStr) return;
    localStorage.setItem(
      getAttendanceCacheKey(uid, dateStr),
      JSON.stringify({ ts: Date.now(), data: normalizeAttendanceCache(data) })
    );
  } catch (_) {}
};

const mergeAttendanceCache = (uid, dateStr, partial) => {
  try {
    if (!uid || !dateStr) return;
    const key = getAttendanceCacheKey(uid, dateStr);
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const existing = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
    writeAttendanceCache(uid, dateStr, { ...existing, ...partial });
  } catch (_) {}
};

const inflateAttendanceForUi = (data) => {
  if (!data || typeof data !== "object") return null;
  const checkInIso = toIsoString(data.checkInTime) || data._clientCheckIn || "";
  const checkOutIso = toIsoString(data.checkOutTime) || data._clientCheckOut || "";

  return {
    ...data,
    _clientCheckIn: data._clientCheckIn || checkInIso || null,
    _clientCheckOut: data._clientCheckOut || checkOutIso || null,
    checkInTime: checkInIso ? { toDate: () => new Date(checkInIso) } : data.checkInTime || null,
    checkOutTime: checkOutIso ? { toDate: () => new Date(checkOutIso) } : data.checkOutTime || null,
  };
};

const readAttendanceCache = (uid, dateStr, maxAgeMs = 12 * 60 * 60 * 1000) => {
  try {
    if (!uid || !dateStr) return null;
    const raw = localStorage.getItem(getAttendanceCacheKey(uid, dateStr));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    if (parsed?.ts && Date.now() - Number(parsed.ts) > maxAgeMs) return null;
    return inflateAttendanceForUi(parsed.data);
  } catch (_) {
    return null;
  }
};


export default function AttendancePage() {
  const { user, roleData } = useAuth();
  const backNavRef = useRef(false);

  const sessionRole = (() => {
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.role || parsed?.Role || parsed?.profile?.role || parsed?.profile?.Role || "";
    } catch {
      return "";
    }
  })();

  const sessionUser = (() => {
    try {
      const raw = localStorage.getItem("kp-user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const role = canonicalRole(
    roleData?.role ||
      roleData?.Role ||
      user?.role ||
      user?.Role ||
      sessionRole ||
      ""
  );

  const effectiveRole =
  role || (isAdminUser(role, user) ? "admin" : "");

  const userBelongsTo = normalizeBelongsTo(
    roleData?.belongsTo ||
      user?.belongsTo ||
      sessionUser?.belongsTo ||
      sessionUser?.belongs_to ||
      sessionUser?.team ||
      ""
  );

  const userWorkType = normalizeWorkType(
    roleData?.employeeType ||
      user?.employeeType ||
      sessionUser?.employeeType ||
      sessionUser?.employmentType ||
      ""
  );

  const canCheckInOnSunday = ["off-site", "offsite", "remote"].includes(userWorkType);

  // -------------------------
// PROMINENT DISCLOSURE STATE (Google Play requirement)
// -------------------------
const [showLocationDisclosure, setShowLocationDisclosure] = useState(
  localStorage.getItem("locationDisclosureAccepted") !== "true"
);


const uid = user?.uid;

    
  const [userName, setUserName] = useState("");

  const resolveUserName = async () => {
    if (!user?.uid) return user?.email || "Unknown";

    try {
      const name = await getUserNameFromDB(user.uid);
      if (name) return name;
    } catch (_) {}

    try {
      const rows = await fetchCollectionDocs("Users");
      const me = rows.find((r) => r.id === user.uid);
      const name = me?.Name || me?.name || me?.displayName || me?.email;
      if (name) return name;
    } catch (_) {}

    return user?.email || "Unknown";
  };

useEffect(() => {
  async function loadName() {
    if (!user?.uid) return;

    // Fast path: if AuthContext already has name, use it immediately (no DB call)
    const ctxName = user.name || user.Name || user.displayName;
    if (ctxName) {
      setUserName(ctxName);
      return;
    }

    // otherwise resolve from Users collection (SDK + REST fallback)
    try {
      const name = await resolveUserName();
      setUserName(name);
    } catch (e) {
      console.warn('Attendance: failed to resolve name', e);
      setUserName(user.email || 'Unknown');
    }
  }

  loadName();
}, [user]);
    const USER = user || {};  

  // basic
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  const [showGpsPermissionDialog, setShowGpsPermissionDialog] = useState(false);
  const [gpsDialogBusy, setGpsDialogBusy] = useState(false);
  const checkoutLockRef = useRef(false);
  const gpsPromptRef = useRef({ open: false, lastPromptAt: 0 });
  const [todayStr] = useState(getTodayStr());
  const [attendance, setAttendance] = useState(null); // today's attendance doc
  const attendanceRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [nowTime, setNowTime] = useState(new Date());
  const [tracking, setTracking] = useState(false);

  // holidays
  const [holidayList, setHolidayList] = useState([]);
  const [adminHolidayLoading, setAdminHolidayLoading] = useState(false);

  // working days (attendance_workingDays collection)
  const [workingDaysList, setWorkingDaysList] = useState([]);
  const [approvedLeaveList, setApprovedLeaveList] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState([]);

  // tabs
  const [tab, setTab] = useState("today");

  // history (last 7 days)
  const [history, setHistory] = useState([]);
  const [historySummary, setHistorySummary] = useState({ present: 0, half: 0, absent: 0 });

  // admin
  const [adminData, setAdminData] = useState([]);
  const [userList, setUserList] = useState([]);
  const [filterUser, setFilterUser] = useState("");
  const [belongsToFilter, setBelongsToFilter] = useState("all");

  // load guards
  const historyRangeRef = useRef({ from: null, to: null, ts: 0 });
  const historyLoadingRef = useRef(false);
  const adminLoadingRef = useRef(false);
  const userListLoadingRef = useRef(false);
  const holidaysLoadingRef = useRef(false);
  const workingDaysLoadingRef = useRef(false);
  const approvedLeavesLoadingRef = useRef(false);
  const todayAttendanceLoadingRef = useRef(false);
  const holidaysLastRef = useRef(0);
  const workingDaysLastRef = useRef(0);
  const approvedLeavesLastRef = useRef(0);
  const userListLastRef = useRef(0);
  const adminLastRef = useRef(0);
  const USER_LIST_CACHE_MS = 15 * 1000;


const canViewAdminPanels = [
  "admin",
  "sales_head",
  "director",
  "dgm",
  "agm",
  "hr_executive",
].includes(effectiveRole);

const canViewLeaveApprovals = [
  "admin",
  "sales_head",
  "director",
  "dgm",
  "agm",
  "hr_executive",
].includes(effectiveRole);


  // admin inspect user/day
  const [inspectUserId, setInspectUserId] = useState("");
  const [inspectDate, setInspectDate] = useState(getTodayStr());
  const [inspectRecord, setInspectRecord] = useState(null); // single day doc for inspect
  const [inspectLoading, setInspectLoading] = useState(false);
  const [deletingRecordKey, setDeletingRecordKey] = useState("");
  const [inspectPlaceNames, setInspectPlaceNames] = useState({});
  const placeNameCacheRef = useRef(new Map());

  // --- MAP: two separate refs & instances ---
  // Today tab map
  const todayMapRef = useRef(null); // DOM container for Today map
  const todayMapInstance = useRef(null); // Leaflet map instance
  const todayMarkersRef = useRef([]); // markers array for today map
  const todayPolyRef = useRef(null);

  // Admin tab map
  const adminMapRef = useRef(null); // DOM container for Admin map
  const adminMapInstance = useRef(null); // Leaflet map instance
  const adminMarkersRef = useRef([]); // markers array for admin map
  const adminPolyRef = useRef(null);

  // interval refs
  const pollRef = useRef(null);
  const nativeTrackingRef = useRef(false);

  // Check-in window (your rule)
  // Check-in allowed only between 8:30 AM and 11:00 AM
const CHECKIN_START = { h: 8, m: 30 };
const CHECKIN_END   = { h: 11, m: 0 };

  // Auto-checkout threshold when no location updates (in ms)
  const AUTO_CHECKOUT_AFTER = 30 * 60 * 1000; // 30 minutes
  const GPS_PROMPT_COOLDOWN_MS = 2 * 60 * 1000;

  // Export popup state
  const [showExportPopup, setShowExportPopup] = useState(false);
  const navigate = useNavigate();
  const bottomNavGap = "calc(84px + env(safe-area-inset-bottom, 0px))";
  const contentBottomGap = `calc(${bottomNavGap} + 140px)`;

  useEffect(() => {
    attendanceRef.current = attendance;
  }, [attendance]);

  useEffect(() => {
    // Keep admin-like users on "All Teams" by default so export/user selector sees full list.
    if (canViewAdminPanels) return;
    if (!userBelongsTo) return;
    if (belongsToFilter !== "all") return;
    if (userBelongsTo.includes("operations")) setBelongsToFilter("operations");
    else if (userBelongsTo.includes("rooftop")) setBelongsToFilter("rooftop");
  }, [userBelongsTo, belongsToFilter, canViewAdminPanels]);

  // -------------------------
  // dynamic leaflet load
  // -------------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import("leaflet");
        console.log("🟢 Leaflet loaded", !!mod);
        L = mod.default || mod;
        await import("leaflet/dist/leaflet.css");
        // initialize maps if containers present
        if (mounted) {
          // init today map if that DOM exists and role allows
          if (todayMapRef.current) {
  initTodayMap();
}
          // init admin map if admin DOM exists
          if (adminMapRef.current && canViewAdminPanels) {
  initAdminMap();
}
        }
      } catch (e) {
        // leaflet optional - map won't render for non-admins if import fails
        console.warn("Leaflet load failed:", e);
      }
    })();
    
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]); // role added so maps init when role changes to admin

  // load today's attendance + ensure doc exists
  // -------------------------
  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    const cachedDoc = readAttendanceCache(uid, todayStr);
    const localIso = getLocalCheckIn(uid, todayStr);
    if (cachedDoc) {
      const hydrated =
        !cachedDoc._clientCheckIn && localIso
          ? {
              ...cachedDoc,
              _clientCheckIn: localIso,
              checkInTime: { toDate: () => new Date(localIso) },
            }
          : cachedDoc;
      setAttendance(hydrated);
      setLoading(false);
      const hasCheckIn = !!(hydrated.checkInTime || hydrated.checkIn || hydrated._clientCheckIn);
      const hasCheckOut = !!(hydrated.checkOutTime || hydrated.checkOut);
      if (hasCheckIn && !hasCheckOut) startTracking();
    } else if (localIso) {
      const localDoc = {
        _clientCheckIn: localIso,
        checkInTime: { toDate: () => new Date(localIso) },
      };
      setAttendance(localDoc);
      setLoading(false);
      startTracking();
    }

    let cancelled = false;
    (async () => {
      try {
        await createOrEnsureDoc(uid, userName, todayStr);
        const hasLocalCheckIn = !!getLocalCheckIn(uid, todayStr);
        const shouldBypassCache = Capacitor.getPlatform() === "ios" || hasLocalCheckIn;
        const doc = shouldBypassCache
          ? await fetchAttendanceDocFresh(uid, todayStr)
          : await fetchAttendanceDoc(uid, todayStr);
        if (cancelled) return;
        
        if (!doc) {
          console.warn('Attendance doc not found or failed to fetch, retrying...');
          // Retry once after a short delay
          setTimeout(async () => {
            if (cancelled) return;
            const retryDoc = await fetchAttendanceDoc(uid, todayStr);
            if (retryDoc && !cancelled) {
              setAttendance(retryDoc);
              if (retryDoc.checkInTime && !retryDoc.checkOutTime) startTracking();
            } else if (!cancelled) {
              const localIso = getLocalCheckIn(uid, todayStr);
              if (localIso) {
                setAttendance({
                  _clientCheckIn: localIso,
                  checkInTime: { toDate: () => new Date(localIso) },
                });
                startTracking();
              }
            }
          }, 1000);
        } else {
          const localIso = getLocalCheckIn(uid, todayStr);
          const hasCheckIn = !!(doc.checkInTime || doc.checkIn || doc._clientCheckIn || localIso);
          const hasCheckOut = !!(doc.checkOutTime || doc.checkOut);
          if (!hasCheckOut && !doc.checkInTime && localIso) {
            setAttendance({
              ...doc,
              _clientCheckIn: localIso,
              checkInTime: { toDate: () => new Date(localIso) },
            });
            mergeAttendanceCache(uid, todayStr, {
              ...doc,
              _clientCheckIn: localIso,
              checkInTime: localIso,
            });
          } else {
            setAttendance(doc);
            writeAttendanceCache(uid, todayStr, doc);
          }
          // if checked in and not checked out, start tracking
          if (hasCheckIn && !hasCheckOut) startTracking();
        }
        
        setLoading(false);
      } catch (err) {
        console.error("Error loading today attendance", err);
        if (!cancelled) {
          setLoading(false);
          // Still try to start tracking if we have any check-in data
          if (attendance && attendance.checkInTime && !attendance.checkOutTime) {
            startTracking();
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, userName, todayStr]);

  // Refresh attendance when app returns to foreground (iOS-safe)
  useEffect(() => {
    if (!uid) return;

    const refreshAttendance = async () => {
      try {
        const fresh = await fetchAttendanceDocFresh(uid, todayStr);
        if (fresh) {
          setAttendance(fresh);
          writeAttendanceCache(uid, todayStr, fresh);
        }
      } catch (e) {
        console.warn("Attendance refresh failed", e);
      }
    };

    let appListener = null;
    if (Capacitor.isNativePlatform()) {
      appListener = App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) refreshAttendance();
      });
    } else {
      const onVisible = () => {
        if (!document.hidden) refreshAttendance();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    return () => {
      if (appListener && typeof appListener.remove === "function") {
        appListener.remove();
      }
    };
  }, [uid, todayStr]);

  // Background location handler (native only)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (Capacitor.getPlatform() === "ios") return;
    if (Capacitor.getPlatform() === "ios") return;

    let active = true;
    setBackgroundLocationHandler(async (location) => {
      if (!active) return;
      if (!uid) {
        console.log("🟡 BG skip: missing uid");
        return;
      }
      const doc = attendanceRef.current;
      if (!doc) {
        console.log("🟡 BG skip: missing attendance doc in memory");
        return;
      }
      const hasCheckIn = !!(doc.checkInTime || doc.checkIn || doc._clientCheckIn);
      const hasCheckOut = !!(doc.checkOutTime || doc.checkOut);
      if (!hasCheckIn) {
        console.log("🟡 BG skip: user not checked-in");
        return;
      }
      if (hasCheckOut) {
        console.log("🟡 BG skip: user already checked-out");
        return;
      }

      console.log("🧭 BG location event received", {
        lat: location?.coords?.latitude,
        lng: location?.coords?.longitude,
        ts: location?.timestamp || new Date().toISOString(),
      });

      try {
        const ts = new Date().toISOString();
        await pollAddLocation({
          uid,
          dateStr: todayStr,
          coords: {
            lat: location?.coords?.latitude,
            lng: location?.coords?.longitude,
            timestamp: ts,
          },
        });
        console.log("🟢 BG location write success", {
          uid,
          dateStr: todayStr,
          ts,
        });
      } catch (e) {
        console.warn("BG tracking write failed", e);
      }
    });

    return () => {
      active = false;
      clearBackgroundLocationHandler();
    };
  }, [uid, todayStr]);

  // update clock frequency based on running state
  useEffect(() => {
    const isRunning = !!(
      attendance &&
      (attendance.checkInTime || attendance.checkIn || attendance._clientCheckIn) &&
      !(attendance.checkOutTime || attendance.checkOut)
    );
    const intervalMs = isRunning ? 1000 : 60000;
    const t = setInterval(() => setNowTime(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [attendance?.checkInTime, attendance?.checkOutTime, attendance?.checkIn, attendance?.checkOut, attendance?._clientCheckIn]);


  // -------------------------
  // countdown or check-in window helper
  // -------------------------
  const checkWindow = (d = new Date()) => {
    const s = new Date(d);
    s.setHours(CHECKIN_START.h, CHECKIN_START.m, 0, 0);
    const e = new Date(d);
    e.setHours(CHECKIN_END.h, CHECKIN_END.m, 0, 0);
    return d >= s && d <= e;
  };

  // -------------------------
  // holidays loader
  // -------------------------
  const loadHolidays = async () => {
    const now = Date.now();
    if (holidaysLoadingRef.current) return;
    if (holidayList.length && now - holidaysLastRef.current < 5 * 60 * 1000) return;
    holidaysLoadingRef.current = true;
    try {
      setAdminHolidayLoading(true);
      const list = await fetchHolidays();
      setHolidayList(list || []);
      holidaysLastRef.current = Date.now();
    } catch (e) {
      console.warn("loadHolidays error", e);
    } finally {
      holidaysLoadingRef.current = false;
      setAdminHolidayLoading(false);
    }
  };

  // -------------------------
  // working-days loader
  // -------------------------
  const loadWorkingDays = async () => {
    const now = Date.now();
    if (workingDaysLoadingRef.current) return;
    if (workingDaysList.length && now - workingDaysLastRef.current < 5 * 60 * 1000) return;
    workingDaysLoadingRef.current = true;
    try {
      const list = await fetchWorkingDays();
      setWorkingDaysList(list || []);
      workingDaysLastRef.current = Date.now();
    } catch (e) {
      console.warn("loadWorkingDays error", e);
    } finally {
      workingDaysLoadingRef.current = false;
    }
  };

  // helper: check if date is holiday for this user or all users
  const isHolidayForUser = (dateStr, userId) => {
    if (!dateStr || !holidayList || !holidayList.length) return false;
    return holidayList.some((h) => {
      if (!h || !h.date) return false;
      if (h.date !== dateStr) return false;
      if (h.applyToAll) return true;
      if (Array.isArray(h.users) && h.users.includes(userId)) return true;
      return false;
    });
  };

  // helper: check if date is working-day for this user (allows check-in even on Sunday)
  const isWorkingDayForUser = (dateStr, userId) => {
    if (!dateStr || !workingDaysList || !workingDaysList.length) return false;
    return workingDaysList.some((w) => {
      if (!w || !w.date) return false;
      if (w.date !== dateStr) return false;
      if (w.applyToAll) return true;
      if (Array.isArray(w.users) && w.users.includes(userId)) return true;
      return false;
    });
  };

  const isApprovedLeaveStatus = (row) => {
    const s1 = String(row?.final_status || "").toLowerCase();
    const s2 = String(row?.status || "").toLowerCase();
    return s1 === "approved" || s2 === "approved";
  };

  const normalizeLeaveTypeLabel = (type) => {
    const t = String(type || "").toLowerCase();
    if (t === "leave") return "leave";
    if (t === "comp_off") return "comp-off";
    if (t === "early_checkin") return "early-checkin";
    if (t === "early_checkout") return "early-checkout";
    return "leave";
  };

  const parseIsoDay = (value) => {
    const v = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };

  const loadApprovedLeaves = async () => {
    const now = Date.now();
    if (approvedLeavesLoadingRef.current) return;
    if (approvedLeaveList.length && now - approvedLeavesLastRef.current < 5 * 60 * 1000) return;

    approvedLeavesLoadingRef.current = true;
    try {
      let rows = await fetchCollectionDocs("leaveRequests");

      if (!rows || rows.length === 0) {
        try {
          const stored = typeof window !== "undefined" ? localStorage.getItem("kp-user") : null;
          const parsed = stored ? JSON.parse(stored) : null;
          const token = parsed?.idToken;
          if (token) rows = await fetchCollectionREST("leaveRequests", token);
        } catch (restErr) {
          console.warn("loadApprovedLeaves REST fallback error", restErr);
        }
      }

      const normalized = (rows || [])
        .filter((r) => isApprovedLeaveStatus(r))
        .map((r) => ({
          id: r.id,
          userId: r.userId || "",
          userEmail: String(r.userEmail || "").toLowerCase(),
          from: parseIsoDay(r.from),
          to: parseIsoDay(r.to || r.from),
          type: normalizeLeaveTypeLabel(r.type),
          status: r.status,
          final_status: r.final_status,
        }))
        .filter((r) => r.from && r.to);

      setApprovedLeaveList(normalized);
      approvedLeavesLastRef.current = Date.now();
    } catch (e) {
      console.warn("loadApprovedLeaves error", e);
    } finally {
      approvedLeavesLoadingRef.current = false;
    }
  };

  // -------------------------
  // check-in
  // -------------------------
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runWithRetry = async (fn, attempts = 2, delayMs = 800) => {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await wait(delayMs * (i + 1));
    }
  }
  throw lastErr;
};

const confirmCheckIn = async (userId, dateStr) => {
  for (let i = 0; i < 3; i += 1) {
    try {
      const doc = await fetchAttendanceDocFresh(userId, dateStr);
      if (doc && (doc.checkInTime || doc._clientCheckIn)) return doc;
    } catch (err) {
      // swallow and retry
    }
    await wait(600 * (i + 1));
  }
  return null;
};

const confirmCheckOut = async (userId, dateStr) => {
  for (let i = 0; i < 4; i += 1) {
    try {
      const doc = await fetchAttendanceDocFresh(userId, dateStr);
      if (doc && (doc.checkOutTime || doc.checkOut)) return doc;
    } catch (_) {
      // swallow and retry
    }
    await wait(700 * (i + 1));
  }
  return null;
};

  const handleCheckIn = async () => {
  if (checkingIn) return; // prevent double click
    const localIso = getLocalCheckIn(uid, todayStr);
  const alreadyCheckedIn = !!(
    attendance &&
    (attendance.checkInTime || attendance.checkIn || attendance._clientCheckIn) &&
    !(attendance.checkOutTime || attendance.checkOut)
  );
    if (alreadyCheckedIn || localIso) {
    alert("Already checked in.");
    return;
  }
  setCheckingIn(true);    // ✅ instant UI response
  let checkInSucceeded = false;
  const optimisticIso = new Date().toISOString();
  const previousAttendance = attendance;

  try {
    // ------------------------------
    // YOUR EXISTING LOGIC (UNCHANGED)
    // ------------------------------

    const granted = await requestLocationPermission();
   if (!granted) {
  alert("Location is required for attendance. Please enable GPS.");
  setAttendance(null);
  setCheckingIn(false);
  return;
}
await requestNotificationPermission();

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      await requestBackgroundLocation();
    }

    const now = new Date();
    const today = todayStr;

    const holidayForUser = isHolidayForUser(today, uid);
    const workingDayForUser = isWorkingDayForUser(today, uid);

    if (holidayForUser) {
  alert("Today is marked as holiday. Check-in disabled.");
  setAttendance(null);
  setCheckingIn(false);
  return;
}

   if (now.getDay() === 0 && !workingDayForUser && !canCheckInOnSunday) {
  alert("Today is Sunday / holiday. Check-in disabled unless admin allowed.");
  setAttendance(null);
  setCheckingIn(false);
  return;
}

    const start = new Date();
    start.setHours(CHECKIN_START.h, CHECKIN_START.m, 0, 0);
    const end = new Date();
    end.setHours(CHECKIN_END.h, CHECKIN_END.m, 0, 0);

    if (now < start || now > end) {
  alert("Check-in is allowed only between 8:30 AM and 11:00 AM.");
  setAttendance(null);        // rollback UI
  setCheckingIn(false);
  return;
}
// ✅ OPTIMISTIC UI — START COUNTDOWN ONLY AFTER ALL VALIDATIONS
  setLocalCheckIn(uid, todayStr, optimisticIso);
  setAttendance((prev) => ({
  ...(prev || {}),
  _clientCheckIn: optimisticIso,
  checkInTime: { toDate: () => new Date(optimisticIso) }, // UI-only
}));
  mergeAttendanceCache(uid, todayStr, {
    _clientCheckIn: optimisticIso,
      checkInTime: optimisticIso,
    checkOutTime: null,
  });

    const pos = await Geolocation.getCurrentPosition({
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,        // ⭐ FORCE NEW LOCATION
});

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    let finalName = userName;
    if (!finalName) {
      finalName = await resolveUserName();
      setUserName(finalName);
    }

  await runWithRetry(
    () =>
      checkIn({
        uid,
        userName: finalName,
        dateStr: todayStr,
        coords: { lat, lng },
        clientIso: optimisticIso,
      }),
    Capacitor.getPlatform() === "ios" ? 1 : 2,
    800
  );
  checkInSucceeded = true;
  mergeAttendanceCache(uid, todayStr, {
    _clientCheckIn: optimisticIso,
    checkInTime: optimisticIso,
  });
// 🚀 START NATIVE BACKGROUND TRACKING (ANDROID ONLY)
if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
  try {
    await startBackgroundTracking();
  } catch (e) {
    console.warn("Native tracking start failed", e);
  }
}

    startTracking();
    alert("Checked in successfully!");

    // confirm in background (do not block UI)
    confirmCheckIn(uid, todayStr)
      .then((confirmed) => {
        if (confirmed) {
          setAttendance(confirmed);
          writeAttendanceCache(uid, todayStr, confirmed);
        }
      })
      .catch(() => {});

    // Refresh history so calendar updates
    loadHistory().catch(e => console.warn('Failed to reload history after check-in', e));

    if (Capacitor.getPlatform() === "android") {
      setTimeout(() => {
        alert(
          "For uninterrupted attendance tracking, please disable battery optimization for Kapil Power CRM."
        );
        window.open("app-settings:/", "_self");
      }, 300);
    }

  } catch (err) {
    console.error("CHECK-IN ERROR:", {
      message: err?.message,
      code: err?.code,
      name: err?.name,
      raw: err,
    });

    // ❌ rollback ONLY if write failed
    if (!checkInSucceeded) {
      clearLocalCheckIn(uid, todayStr);
      setAttendance(previousAttendance || null);
    }
  } finally {
    setCheckingIn(false);
  }
};

  // -------------------------
  // tracking (polling locations)
  // -------------------------
const addTrackingPoint = async () => {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
    });

    await pollAddLocation({
      uid,
      dateStr: todayStr,
      coords: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        timestamp: new Date().toISOString(),
      },
    });
    const updated = await fetchAttendanceDocFresh(uid, todayStr);
    if (updated) setAttendance(updated);
  } catch (e) {
    console.warn("Tracking location error", e);
  }
};

  const startTracking = () => {
  if (pollRef.current) return;

  // ✅ Foreground-only tracking
  addTrackingPoint();

  pollRef.current = setInterval(() => {
    const shouldPoll = Capacitor.isNativePlatform() ? true : !document.hidden;
    if (shouldPoll) {
      addTrackingPoint();
    }
  }, 300000); // 5 minutes

  setTracking(true);
};

  const stopTracking = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setTracking(false);
    nativeTrackingRef.current = false;
  };

  // Auto-resume background tracking ONLY between check-in and checkout
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const hasCheckIn = !!(
      attendance &&
      (attendance.checkInTime || attendance.checkIn || attendance._clientCheckIn)
    );
    const hasCheckOut = !!(
      attendance &&
      (attendance.checkOutTime || attendance.checkOut)
    );

    // Start background tracking only if checked in and not checked out
    if (hasCheckIn && !hasCheckOut) {
      if (!nativeTrackingRef.current) {
        nativeTrackingRef.current = true;
        (async () => {
          try {
            await startBackgroundTracking();
          } catch (e) {
            console.warn("Native tracking start failed", e);
          }
        })();
      }
    } else {
      // Stop background tracking if checked out or not checked in
      if (nativeTrackingRef.current) {
        nativeTrackingRef.current = false;
        (async () => {
          try {
            await stopBackgroundTracking();
          } catch (e) {
            console.warn("Native tracking stop failed", e);
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance?.checkInTime, attendance?._clientCheckIn, attendance?.checkIn, attendance?.checkOutTime, attendance?.checkOut]);


  // cleanup
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, []);

  // -------------------------
  // checkout
  // -------------------------
  const requestCheckOut = () => {
    if (checkingOut || checkoutLockRef.current) return;

    const alreadyCheckedOut = !!(
      attendance &&
      (attendance.checkOutTime || attendance.checkOut)
    );
    if (alreadyCheckedOut) {
      alert("Already checked out.");
      return;
    }

    setShowCheckoutConfirm(true);
  };

  const handleCheckOut = async () => {
    if (checkingOut || checkoutLockRef.current) return;

    const alreadyCheckedOut = !!(
      attendance &&
      (attendance.checkOutTime || attendance.checkOut)
    );
    if (alreadyCheckedOut) {
      alert("Already checked out.");
      return;
    }

    setShowCheckoutConfirm(false);

    checkoutLockRef.current = true;
    setCheckingOut(true);
    const optimisticCheckOutIso = new Date().toISOString();
    const currentCheckInIso = getCheckInIsoFromAttendance(attendance) || getLocalCheckIn(uid, todayStr);
    const previousAttendance = attendance;
    setAttendance((prev) => ({
      ...(prev || {}),
      _clientCheckOut: optimisticCheckOutIso,
      checkOutTime: { toDate: () => new Date(optimisticCheckOutIso) },
    }));
    mergeAttendanceCache(uid, todayStr, {
      _clientCheckOut: optimisticCheckOutIso,
      checkOutTime: optimisticCheckOutIso,
    });

    try {
      const res = await runWithRetry(
        () =>
          checkOut({
            uid,
            dateStr: todayStr,
            clientCheckOutDate: new Date(),
            clientCheckInIso: currentCheckInIso || null,
          }),
        Capacitor.getPlatform() === "ios" ? 1 : 2,
        900
      );

      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && nativeTrackingRef.current) {
        try {
          await stopBackgroundTracking();
        } catch (e) {
          console.warn("Native tracking stop failed during checkout", e);
        }
      }

      stopTracking();
      foregroundNotified = false;

      clearLocalCheckIn(uid, todayStr);

      const finalStatus = attendance?.status || res.status || "checked out";
      const finalMinutes = Number.isFinite(res.totalMinutes) ? res.totalMinutes : 0;
      alert(`Checked out: ${finalStatus} — ${finalMinutes} mins`);

      setAttendance((prev) => ({
        ...(prev || {}),
        status: finalStatus,
        totalMinutes: finalMinutes,
      }));
      mergeAttendanceCache(uid, todayStr, {
        _clientCheckOut: optimisticCheckOutIso,
        checkOutTime: optimisticCheckOutIso,
        status: finalStatus,
        totalMinutes: finalMinutes,
      });

      confirmCheckOut(uid, todayStr)
        .then((updated) => {
          if (updated) {
            setAttendance(updated);
            writeAttendanceCache(uid, todayStr, updated);
          }
        })
        .catch(() => {});
      
      // Refresh history so calendar updates
      loadHistory().catch(e => console.warn('Failed to reload history after checkout', e));
    } catch (err) {
      console.error("CHECKOUT ERR:", err);
      setAttendance(previousAttendance || null);
      alert("Checkout failed");
    } finally {
      setCheckingOut(false);
      checkoutLockRef.current = false;
    }
  };

  // -------------------------
  // history loader (use current range or current month)
  // -------------------------
  const loadHistory = async () => {
    if (!uid) return;

    const prev = historyRangeRef.current;
    if (prev.from && prev.to) {
      await loadHistoryForMonth(prev.from, prev.to);
      return;
    }

    const { from, to } = getAttendanceMonthRange(new Date());
    await loadHistoryForMonth(from, to);
  };

  // -------------------------
  // history loader (by month range)
  // -------------------------
  const loadHistoryForMonth = async (from, to) => {
    if (!uid) return;
    if (historyLoadingRef.current) return;

    const prev = historyRangeRef.current;
    const now = Date.now();
    if (prev.from === from && prev.to === to && now - prev.ts < 60 * 1000) return;

    historyLoadingRef.current = true;
    try {
      const all = await fetchAttendanceRange(from, to);

      const userRows = all.filter((r) => r.userId === uid);

      userRows.sort((a, b) => (a.date > b.date ? 1 : -1));

      setHistory(userRows);

      const summary = { present: 0, half: 0, absent: 0 };
      userRows.forEach((r) => {
        const s = (r.status || "").toLowerCase();
        if (s === "present") summary.present++;
        else if (s === "half-day" || s === "half day") summary.half++;
        else summary.absent++;
      });

      setHistorySummary(summary);
      historyRangeRef.current = { from, to, ts: Date.now() };
    } catch (err) {
      console.warn("loadHistoryForMonth err", err);
    } finally {
      historyLoadingRef.current = false;
    }
  };

  // -------------------------
  // Today attendance loader (for Active/Inactive)
  // -------------------------
  const loadTodayAttendance = async () => {
    if (todayAttendanceLoadingRef.current) return;
    todayAttendanceLoadingRef.current = true;
    try {
      const rows = await fetchAttendanceRange(todayStr, todayStr);
      setTodayAttendance(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.warn("loadTodayAttendance err", err);
      setTodayAttendance([]);
    } finally {
      todayAttendanceLoadingRef.current = false;
    }
  };

  // -------------------------
  // ADMIN loader (all attendance)
  // -------------------------
const loadAdmin = async () => {
  const now = Date.now();
  if (adminLoadingRef.current) return;
  if (adminData.length && now - adminLastRef.current < 5 * 60 * 1000) return;
  adminLoadingRef.current = true;
  try {
    const { from, to } = getAttendanceMonthRange(new Date());
    const all = await fetchAttendanceRange(from, to);

    // sort
    all.sort((a, b) => (a.date > b.date ? 1 : -1));

    setAdminData(all);
    adminLastRef.current = Date.now();

    // build user dropdown
    // load Users list for dropdown
    await loadUserList(true);

} catch (err) {
  console.warn("loadAdmin err", err);
} finally {
  adminLoadingRef.current = false;
}
};

  // -------------------------
  // Users list loader (for Active/Inactive + Admin dropdown)
  // -------------------------
  const loadUserList = async (force = false) => {
    const now = Date.now();
    if (userListLoadingRef.current) return;
    if (!force && userList.length && now - userListLastRef.current < USER_LIST_CACHE_MS) return;
    userListLoadingRef.current = true;
    try {
      let rows = await import("../helpers/firestoreFetch").then((m) => m.fetchCollectionDocs("Users"));

      if (!rows || rows.length === 0) {
        try {
          const stored = typeof window !== "undefined" ? localStorage.getItem("kp-user") : null;
          const parsed = stored ? JSON.parse(stored) : null;
          const token = parsed?.idToken;
          if (token) rows = await fetchCollectionREST("Users", token);
        } catch (_) {}
      }

      const list = (rows || []).map((r) => ({
        id: r.id,
        name: r.Name || r.name || r.displayName || r.email || r.id,
        email: r.email || r.Email || "",
        belongsTo: normalizeBelongsTo(r.belongsTo || r.belongs_to || r.team || ""),
        employeeType: r.employeeType || r.employmentType || "",
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setUserList(list);
      userListLastRef.current = Date.now();
    } catch (e) {
      console.warn("Attendance: failed to build user list", e);
      setUserList([]);
    } finally {
      userListLoadingRef.current = false;
    }
  };

  const belongsToFilteredUsers =
    belongsToFilter === "all"
      ? userList
      : userList.filter((u) => u.belongsTo === belongsToFilter);

  const belongsToUserIds = new Set(belongsToFilteredUsers.map((u) => u.id));

// Filter admin data by selected user
const adminFiltered =
  (filterUser === "" ? adminData : adminData.filter((r) => r.userId === filterUser))
    .filter((r) => (filterUser ? true : (belongsToFilter === "all" ? true : belongsToUserIds.has(r.userId))));

const exportUsersForSheet = filterUser
  ? userList.filter((u) => u.id === filterUser)
  : (belongsToFilter === "all" ? userList : belongsToFilteredUsers);
// ---------------------------------------------------------
// EXPORT HELPERS (FINAL VERSION)
// ---------------------------------------------------------

// Color fill for XLSX
const getFillColor = (status) => {
  status = (status || "").toLowerCase();
  if (status === "present") return { fgColor: { rgb: "C6EFCE" } }; // green
  if (status === "half-day") return { fgColor: { rgb: "FFEB9C" } }; // yellow
  if (status === "absent") return { fgColor: { rgb: "F8CBAD" } }; // red
  if (["leave", "comp-off", "early-checkin", "early-checkout"].includes(status)) {
    return { fgColor: { rgb: "D9E1F2" } }; // light blue
  }
  return null;
};

// Sunday check
const isSunday = (dateStr) => {
  const d = new Date(dateStr);
  return d.getDay() === 0;
};

const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const getAttendanceMonthRange = (baseDate = new Date()) => {
  const fromDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 26);
  const toDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 25);
  return {
    from: toYMD(fromDate),
    to: toYMD(toDate),
    fromDate,
    toDate,
  };
};

// Summary calculation
const calculateSummary = (rows) => {
  let present = 0,
    half = 0,
    absent = 0;

  rows.forEach((r) => {
    const s = (r.status || "").toLowerCase();

    // 🟢 Present
    if (s === "present") present++;

    // 🟡 Half Day
    else if (s.includes("half")) half++;

    // 🔴 Absent
    else if (s === "absent") absent++;

    // 🟣 Holidays / Festivals / Sunday
    // (Do NOT count them as absent)
    else if (s === "sunday" || s === "holiday") {
      // do nothing
    }
  });


  return { present, half, absent };
};

/** ----------------------------
 * Helper: Get User Name
 * ---------------------------- */
const getExportName = (row, userList) => {
  if (!row) return "";

  if (row.userName && row.userName.trim() !== "") {
    return row.userName.trim();
  }

  if (row.userId && Array.isArray(userList)) {
    const u = userList.find(u => u.id === row.userId);
    if (u && u.name) return u.name;
  }

  return row.userId || "Unknown";
};

// Build a monthly sheet
const buildMonthlySheet = (records, holidays, workingDays, approvedLeaves = [], usersForSheet = []) => {
  if (!records.length) return null;

  const month = records[0].date.slice(0, 7); // YYYY-MM
// ✅ Build unique users by NAME (not UID)
// ✅ Use ALL users from userList (not attendance-driven)
const sourceUsers = usersForSheet.length ? usersForSheet : userList;
const users = sourceUsers.map(u => ({
  id: u.id,
  name: u.name,
  email: String(u.email || "").toLowerCase(),
}));
  const today = new Date().toISOString().split("T")[0];

  // List month days
  const year = Number(month.split("-")[0]);
  const m = Number(month.split("-")[1]) - 1;
  const totalDays = new Date(year, m + 1, 0).getDate();

  const days = [];
  for (let d = 1; d <= totalDays; d++) {
    days.push(`${month}-${String(d).padStart(2, "0")}`);
  }

  // Sheet header
  const sheetData = [
    [
  "Name",
  ...days,
  "Total Working Days",
  "Present",
  "Half-days",
  "Absent",
  "Employee Working Days"
],
  ];

  users.forEach((user) => {
  const row = [user.name];      // show proper name in excel
  const userIds = [user.id].filter(Boolean);
  const userRows = records.filter(
  (r) =>
    (r.userId && userIds.includes(r.userId)) ||
    (r.userName && r.userName.trim() === user.name) ||
    (user.email && String(r.userEmail || "").toLowerCase() === user.email)
);

  const userLeaves = approvedLeaves.filter((l) => {
    const byId = l.userId && userIds.includes(l.userId);
    const byEmail = user.email && l.userEmail && l.userEmail === user.email;
    return byId || byEmail;
  });

    const summaryRows = [];

    days.forEach((d) => {
      const isFuture = d > today;

     let rec = userRows.find((r) => r.date === d);
let status = "";

// 1️⃣ Future → blank
if (isFuture) {
  status = "";
}

// 2️⃣ Attendance exists → TRUST DATABASE (NO OVERRIDE)
else if (rec && rec.checkInTime) {
  const mins = rec.totalMinutes ?? rec.minutes ?? 0;

  if (!rec.checkOutTime || mins < HALF_DAY_MIN) {
    status = "half-day";
  } else {
    status = "present";
  }
}

// 3️⃣ Holiday (only if NO attendance)
else if (
  userLeaves.some((l) => l.from <= d && d <= l.to)
) {
  const leave = userLeaves.find((l) => l.from <= d && d <= l.to);
  status = leave?.type || "leave";
}

// 4️⃣ Holiday (only if NO attendance)
else if (
  holidays.some(
    h =>
      h.date === d &&
      (h.applyToAll || userIds.some(id => h.users?.includes(id)))
  )
) {
  const h = holidays.find(
    h =>
      h.date === d &&
      (h.applyToAll || userIds.some(id => h.users?.includes(id)))
  );
  status = h.label || "holiday";
}

// 5️⃣ Sunday (only if NO attendance & NO admin override)
else if (
  isSunday(d) &&
  !workingDays.some(
    w =>
      w.date === d &&
      (w.applyToAll || userIds.some(id => w.users?.includes(id)))
  )
) {
  status = "";
}

// 6️⃣ Admin working day (user absent)
else if (
  workingDays.some(
    w =>
      w.date === d &&
      (w.applyToAll || userIds.some(id => w.users?.includes(id)))
  )
) {
  status = "absent";
}

// 7️⃣ Normal absent
else {
  status = "absent";
}


      summaryRows.push({ date: d, status });
      row.push(status);
    });

    const { present, half, absent } = calculateSummary(summaryRows);

// ✅ Employee Working Days logic
const employeeWorkingDays = present + Math.floor(half / 2);

    const workingDayCount =
      days.filter((d) => !isSunday(d)).length -
      holidays.filter((h) => h.date.startsWith(month)).length;

    row.push(
  workingDayCount,
  present,
  half,
  absent,
  employeeWorkingDays
);
    sheetData.push(row);
  });

  // Convert to XLSX
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Apply color coding
  users.forEach((user, r) => {
    const rowIndex = r + 1;
    days.forEach((d, c) => {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: c + 1 });
      const status = sheetData[rowIndex][c + 1];
      if (!status) return;

      const fill = getFillColor(status);
      if (fill && ws[cellRef]) {
        ws[cellRef].s = { fill };
      }
    });
  });

  return ws;
};

// Export all months (multi-sheet)
const exportAdminAllRecords = async () => {
  try {
    const wb = XLSX.utils.book_new();
    const monthGroups = {};
    const rowsToExport = adminFiltered;

    rowsToExport.forEach((r) => {
      const month = r.date.slice(0, 7);
      if (!monthGroups[month]) monthGroups[month] = [];
      monthGroups[month].push(r);
    });

    Object.keys(monthGroups).forEach((month) => {
      const ws = buildMonthlySheet(monthGroups[month], holidayList, workingDaysList, approvedLeaveList, exportUsersForSheet);
      if (ws) XLSX.utils.book_append_sheet(wb, ws, month);
    });

    XLSX.writeFile(wb, "Attendance_Monthly_Export.xlsx");
    setShowExportPopup(false);
  } catch (err) {
    console.error("Export error:", err);
  }
};

// Export current month only
const exportAdminCurrentMonth = async () => {
  try {
    const { from, to } = getAttendanceMonthRange(new Date());
    const rows = adminFiltered.filter((r) => r.date >= from && r.date <= to);

    const wb = XLSX.utils.book_new();
    const ws = buildMonthlySheet(rows, holidayList, workingDaysList, approvedLeaveList, exportUsersForSheet);

    if (ws) XLSX.utils.book_append_sheet(wb, ws, `${from} to ${to}`);

    XLSX.writeFile(wb, `Attendance_${from}_to_${to}.xlsx`);
    setShowExportPopup(false);
  } catch (err) {
    console.error("Export CM error:", err);
  }
};

  // -------------------------
  // MAP HELPERS (dual instances)
  // -------------------------
  const initTodayMap = () => {
    console.log("🟡 initAdminMap called", {
  hasL: !!L,
  hasRef: !!adminMapRef.current,
  alreadyInit: !!adminMapInstance.current,
});
    try {
      if (!L || !todayMapRef.current || todayMapInstance.current) return;
      const map = L.map(todayMapRef.current, {
  zoomControl: true,
  dragging: true,
  tap: true,          // 🔥 REQUIRED FOR iOS
  inertia: true,
  preferCanvas: true // 🔥 avoids iOS WebView freeze
}).setView([20.5937, 78.9629], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      updateWhenIdle: true,
      keepBuffer: 2,
    }).addTo(map);
      todayMapInstance.current = map;
      setTimeout(() => {
  map.invalidateSize();
  console.log("🗺️ Today map invalidateSize done");
}, 300);

    } catch (e) {
      console.warn("initTodayMap error:", e);
    }
  };

  const initAdminMap = () => {
    try {
      if (!L || !adminMapRef.current || adminMapInstance.current) return;
      const map = L.map(adminMapRef.current, {
  zoomControl: true,
  dragging: true,
  tap: true,
  inertia: true,
  preferCanvas: true,
}).setView([20.5937, 78.9629], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  updateWhenIdle: true,
  keepBuffer: 2,
}).addTo(map);
      adminMapInstance.current = map;
      setTimeout(() => {
  map.invalidateSize();
  console.log("🗺️ Admin map invalidateSize done");
}, 300);
    } catch (e) {
      console.warn("initAdminMap error:", e);
    }
  };

  const clearMapOnInstance = (mapInstanceRef, markersRefVar, polyRefVar) => {
    try {
      if (!mapInstanceRef.current) return;
      markersRefVar.current.forEach((m) => {
        try {
          mapInstanceRef.current.removeLayer(m);
        } catch (_) {}
      });
      markersRefVar.current = [];
      if (polyRefVar.current) {
        try {
          mapInstanceRef.current.removeLayer(polyRefVar.current);
        } catch (_) {}
        polyRefVar.current = null;
      }
    } catch (e) {
      console.warn("clearMapOnInstance error:", e);
    }
  };

  const destroyMapOnInstance = (mapInstanceRef, markersRefVar, polyRefVar) => {
    try {
      if (!mapInstanceRef.current) return;
      clearMapOnInstance(mapInstanceRef, markersRefVar, polyRefVar);
      mapInstanceRef.current.off();
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    } catch (e) {
      console.warn("destroyMapOnInstance error:", e);
    }
  };

  const drawPathOn = (doc, mapInstanceRef, markersRefVar, polyRefVar) => {
    try {
      if (!doc || !doc.locations || !L || !mapInstanceRef.current) return;
      // only for admin or sales_head

      const map = mapInstanceRef.current;

      // clear existing
      clearMapOnInstance(mapInstanceRef, markersRefVar, polyRefVar);

      const toPoint = (p) => {
        if (!p || typeof p !== "object") return null;
        const rawLat = p.lat ?? p.latitude ?? p?.coords?.lat ?? p?.coords?.latitude;
        const rawLng = p.lng ?? p.lon ?? p.longitude ?? p?.coords?.lng ?? p?.coords?.longitude;
        const lat = Number(rawLat);
        const lng = Number(rawLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
      };

      const pts = (doc.locations || [])
        .map((p) => toPoint(p))
        .filter(Boolean);

      if (!pts.length) return;

      pts.forEach((p, i) => {
        const marker = L.circleMarker(p, {
          radius: i === 0 ? 7 : i === pts.length - 1 ? 6 : 4,
          color: i === 0 ? "#16a34a" : i === pts.length - 1 ? "#b91c1c" : "#7f1d1d",
          fillColor: i === 0 ? "#22c55e" : i === pts.length - 1 ? "#ef4444" : "#7f1d1d",
          fillOpacity: 0.95,
          weight: 2,
        }).addTo(map);
        markersRefVar.current.push(marker);
        if (i === 0) marker.bindPopup("Check-in");
        if (i === pts.length - 1) marker.bindPopup("Last location");
      });

      polyRefVar.current = L.polyline(pts, { color: "#800000", weight: 4 }).addTo(map);
      try {
        if (pts.length === 1) {
          map.setView(pts[0], 16);
        } else {
          map.fitBounds(L.latLngBounds(pts).pad(0.2));
        }
      } catch (e) {
        // ignore fitBounds errors
      }
    } catch (e) {
      console.warn("drawPathOn error:", e);
    }
  };

  // redraw today map whenever attendance updates (for today tab)
  useEffect(() => {
    if (!attendance) return;
    if (!L) return;
    if (!todayMapInstance.current) initTodayMap();
    // draw on today's map (only if today map is visible and role allows)
    if (tab === "today") {
      drawPathOn(attendance, todayMapInstance, todayMarkersRef, todayPolyRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance, role, tab]);

  // redraw admin map whenever inspectRecord changes (admin -> Load User Day)
  useEffect(() => {
    if (!inspectRecord) return;
    if (!L) return;
    if (!adminMapInstance.current) initAdminMap();
    drawPathOn(inspectRecord, adminMapInstance, adminMarkersRef, adminPolyRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectRecord, role]);

  // -------------------------
  // Auto-checkout when no locations update for 30 mins
  // - For docs with checkInTime && !checkOutTime
  // - We examine last location timestamp (if available via updatedAt or locations array)
  // -------------------------
  const performGpsOffAutoCheckout = async () => {
    const currentAttendance = attendanceRef.current;
    if (!currentAttendance) return;

    const hasCheckIn = !!(
      currentAttendance.checkInTime ||
      currentAttendance.checkIn ||
      currentAttendance._clientCheckIn
    );
    const hasCheckOut = !!(currentAttendance.checkOutTime || currentAttendance.checkOut);
    if (!hasCheckIn || hasCheckOut) return;

    const targetUid = currentAttendance.userId || uid;
    const targetDate = currentAttendance.date || todayStr;

    await checkOut({
      uid: targetUid,
      dateStr: targetDate,
      clientCheckOutDate: new Date(),
    });

    const updated = await fetchAttendanceDocFresh(targetUid, targetDate);
    if (updated) {
      setAttendance(updated);
      writeAttendanceCache(targetUid, targetDate, updated);
    }

    clearLocalCheckIn(targetUid, targetDate);
    stopTracking();
    alert("Attendance auto-checked out because GPS remained turned off.");
  };

  const handleTurnOnGpsForAttendance = () => {
    setShowGpsPermissionDialog(false);
    gpsPromptRef.current = { open: false, lastPromptAt: Date.now() };

    try {
      if (Capacitor.isNativePlatform()) {
        window.open("app-settings:/", "_self");
      } else if (/windows/i.test(navigator.userAgent)) {
        window.open("ms-settings:privacy-location", "_self");
      } else {
        window.open("app-settings:/", "_self");
      }
    } catch (e) {
      console.warn("Failed to open location settings", e);
      alert("Please open system location settings and turn GPS on.");
    }
  };

  const handleGpsCancelAndAutoCheckout = async () => {
    if (gpsDialogBusy) return;
    setGpsDialogBusy(true);
    try {
      setShowGpsPermissionDialog(false);
      gpsPromptRef.current = { open: false, lastPromptAt: Date.now() };
      await performGpsOffAutoCheckout();
    } catch (e) {
      console.error("GPS cancel auto-checkout failed:", e);
      alert("Failed to auto-checkout. Please try manual checkout.");
    } finally {
      setGpsDialogBusy(false);
    }
  };

 // Auto-checkout when no locations update for 30 mins + permission check
useEffect(() => {
  const tryAutoCheckout = async () => {
    try {
      if (!attendance) return;
      const hasCheckIn = !!(
        attendance.checkInTime ||
        attendance.checkIn ||
        attendance._clientCheckIn
      );
      const hasCheckOut = !!(attendance.checkOutTime || attendance.checkOut);
      if (!hasCheckIn || hasCheckOut) {
        if (showGpsPermissionDialog) setShowGpsPermissionDialog(false);
        gpsPromptRef.current = { open: false, lastPromptAt: 0 };
        return;
      }

      // 1) Check GPS Permission
      const denied = await isLocationPermissionDenied();

      if (!denied) {
        if (showGpsPermissionDialog) setShowGpsPermissionDialog(false);
        gpsPromptRef.current = { open: false, lastPromptAt: 0 };
        return;
      }

      // 2) Permission denied + stale updates -> show decision dialog
      let lastUpdatedMs = 0;

      if (attendance.updatedAt?.toDate) {
        lastUpdatedMs = attendance.updatedAt.toDate().getTime();
      } else if (typeof attendance.updatedAt === "string") {
        const d = new Date(attendance.updatedAt);
        if (!isNaN(d.getTime())) lastUpdatedMs = d.getTime();
      }

      const now = Date.now();
      const isStale = lastUpdatedMs && now - lastUpdatedMs > AUTO_CHECKOUT_AFTER;
      if (!isStale) return;

      if (showGpsPermissionDialog || gpsPromptRef.current.open) return;
      if (now - gpsPromptRef.current.lastPromptAt < GPS_PROMPT_COOLDOWN_MS) return;

      gpsPromptRef.current = { open: true, lastPromptAt: now };
      setShowGpsPermissionDialog(true);
    } catch (e) {
      console.error("Auto-checkout check error:", e);
    }
  };

  tryAutoCheckout();
  const id = setInterval(tryAutoCheckout, 60 * 1000);
  return () => clearInterval(id);
}, [attendance, showGpsPermissionDialog, uid, AUTO_CHECKOUT_AFTER, GPS_PROMPT_COOLDOWN_MS]);

  // -------------------------
  // Inspect user/day for admin
  // -------------------------
  const handleInspectLoad = async () => {
    if (!inspectUserId || !inspectDate) return alert("Select user and date");

    await loadInspectRecordFor(inspectUserId, inspectDate);
  };

  const loadInspectRecordFor = async (targetUserId, targetDate) => {
    if (!targetUserId || !targetDate) return;

    setInspectLoading(true);

    try {
      // fetch the single record
      const doc = await fetchAttendanceDoc(targetUserId, targetDate);
      const normalizedDoc = doc
        ? {
            ...doc,
            locations: normalizeInspectLocations(doc),
          }
        : doc;
      setInspectRecord(normalizedDoc);

      // draw immediately on admin map if present
      if (normalizedDoc && L && adminMapRef.current) {
        if (!adminMapInstance.current) initAdminMap(); // create map once
        drawPathOn(normalizedDoc, adminMapInstance, adminMarkersRef, adminPolyRef);
      } else {
        // clear admin map
        clearMapOnInstance(adminMapInstance, adminMarkersRef, adminPolyRef);
      }
    } catch (e) {
      console.error("inspect load error", e);
      alert("Failed to load record");
    } finally {
      setInspectLoading(false);
    }
  };

  const handleActiveUserMapView = async (u) => {
    if (!u?.id) return;
    const targetDate = getTodayStr();
    setInspectUserId(u.id);
    setInspectDate(targetDate);
    setTab("admin");
    await loadInspectRecordFor(u.id, targetDate);
  };

  const handleDeleteAdminRecord = async (row) => {
    if (effectiveRole !== "admin") {
      alert("Only admin can delete attendance records.");
      return;
    }

    const userId = row?.userId || "";
    const date = row?.date || "";
    if (!userId || !date) {
      alert("Invalid record. Cannot delete.");
      return;
    }

    const recordKey = `${userId}_${date}`;
    const confirmed = window.confirm(
      `Delete attendance record for ${getUserNameById(userId, userList, row?.userName, row?.userEmail)} on ${date}?`
    );
    if (!confirmed) return;

    setDeletingRecordKey(recordKey);
    try {
      await deleteAttendanceRecord(userId, date);

      setAdminData((prev) =>
        (prev || []).filter((r) => !(r?.userId === userId && r?.date === date))
      );
      setTodayAttendance((prev) =>
        (prev || []).filter((r) => !(r?.userId === userId && r?.date === date))
      );

      if (inspectRecord?.userId === userId && inspectRecord?.date === date) {
        setInspectRecord(null);
        clearMapOnInstance(adminMapInstance, adminMarkersRef, adminPolyRef);
      }

      alert("Record deleted successfully.");
    } catch (e) {
      console.error("Delete attendance record failed", e);
      alert("Failed to delete record. Please check permissions and try again.");
    } finally {
      setDeletingRecordKey("");
    }
  };

  // -------------------------
  // re-init data when switching tabs
  // -------------------------
  useEffect(() => {
    if (tab === "history") {
      // load current month by default (calendar will request month changes)
      const { from, to } = getAttendanceMonthRange(new Date());
      loadHistoryForMonth(from, to);
      loadTodayAttendance();
      loadUserList(true);
      loadHolidays();
      loadWorkingDays();
      loadApprovedLeaves();
    } else if (tab === "admin") {
      if (!canViewAdminPanels) return;
      loadAdmin();
      loadHolidays();
      loadWorkingDays();
      loadApprovedLeaves();
      // ensure admin map is initialised when admin tab opens (if leaflet loaded)
      if (L && adminMapRef.current && !adminMapInstance.current && canViewAdminPanels) {
  initAdminMap();
}
    } else if (tab === "today") {
      const cachedDoc = readAttendanceCache(uid, todayStr);
      if (cachedDoc) {
        setAttendance(cachedDoc);
      }

      // refresh today's doc
      (async () => {
        if (!uid) return;
        const localIso = getLocalCheckIn(uid, todayStr);
        const shouldBypassCache = Capacitor.getPlatform() === "ios" || !!localIso;
        const doc = shouldBypassCache
          ? await fetchAttendanceDocFresh(uid, todayStr)
          : await fetchAttendanceDoc(uid, todayStr);
        if (doc) {
          const hasCheckOut = !!(doc.checkOutTime || doc.checkOut);
          if (!hasCheckOut && !doc.checkInTime && localIso) {
            setAttendance({
              ...doc,
              _clientCheckIn: localIso,
              checkInTime: { toDate: () => new Date(localIso) },
            });
          } else {
            setAttendance(doc);
          }
        } else if (localIso) {
          setAttendance((prev) => ({
            ...(prev || {}),
            _clientCheckIn: localIso,
            checkInTime: { toDate: () => new Date(localIso) },
          }));
        } else {
          setAttendance(doc);
        }
        // ensure today map exists
        if (L && todayMapRef.current && !todayMapInstance.current) initTodayMap();
        // also ensure we have latest holiday & working-day info
        loadHolidays();
        loadWorkingDays();
        loadTodayAttendance();
        loadUserList(true);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const refreshNames = () => {
      loadUserList(true);
    };

    window.addEventListener("focus", refreshNames);
    const timer = setInterval(() => {
      if (!document.hidden) refreshNames();
    }, 30 * 1000);

    return () => {
      window.removeEventListener("focus", refreshNames);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const reverseLookupViaNominatim = async (lat, lng) => {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=16&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`Reverse lookup failed: ${res.status}`);
      const data = await res.json();
      return shortPlaceFromReverse(data);
    };

    const reverseLookup = async (lat, lng) => {
      const RETRIES = 3;
      for (let attempt = 0; attempt < RETRIES; attempt += 1) {
        try {
          return await reverseLookupViaNominatim(lat, lng);
        } catch (err) {
          if (attempt === RETRIES - 1) throw err;
          await pause(350 * (attempt + 1));
        }
      }
      return "Location not found";
    };

    const hydratePlaces = async () => {
      const locs = Array.isArray(inspectRecord?.locations) ? inspectRecord.locations : [];
      if (!locs.length) {
        setInspectPlaceNames({});
        return;
      }

      const unique = [];
      const seen = new Set();

      locs.forEach((p) => {
        const key = getCoordKey(p?.lat, p?.lng);
        if (!key || seen.has(key)) return;
        seen.add(key);
        unique.push({ key, lat: Number(p?.lat), lng: Number(p?.lng) });
      });

      const cached = {};
      const pending = [];
      unique.forEach((u) => {
        const c = placeNameCacheRef.current.get(u.key);
        if (c) cached[u.key] = c;
        else pending.push(u);
      });

      if (Object.keys(cached).length) {
        setInspectPlaceNames((prev) => ({ ...prev, ...cached }));
      }

      if (!pending.length) return;

      setInspectPlaceNames((prev) => {
        const next = { ...prev };
        pending.forEach((u) => {
          if (!next[u.key]) next[u.key] = "Resolving location...";
        });
        return next;
      });

      // Keep requests batched to avoid geocoder throttling errors.
      const toResolve = pending;
      const BATCH_SIZE = 4;
      const resolvedEntries = [];

      for (let i = 0; i < toResolve.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = toResolve.slice(i, i + BATCH_SIZE);
        const batchEntries = await Promise.all(
          batch.map(async (u) => {
            try {
              const label = await reverseLookup(u.lat, u.lng);
              return [u.key, label || "Location not found"];
            } catch (_) {
              const fallbackCoords =
                Number.isFinite(u.lat) && Number.isFinite(u.lng)
                  ? `Lat ${u.lat.toFixed(5)}, Lng ${u.lng.toFixed(5)}`
                  : "Location unavailable";
              return [u.key, fallbackCoords];
            }
          })
        );
        resolvedEntries.push(...batchEntries);

        if (i + BATCH_SIZE < toResolve.length) {
          await pause(220);
        }
      }

      if (cancelled) return;

      const next = {};
      const pointByKey = new Map(unique.map((u) => [u.key, u]));
      const successful = [];

      resolvedEntries.forEach(([k, v]) => {
        if (v && v !== "Location unavailable") {
          const p = pointByKey.get(k);
          if (p) successful.push({ ...p, label: v });
        }
      });

      resolvedEntries.forEach(([k, v]) => {
        let finalLabel = v;

        if (!finalLabel || finalLabel === "Location unavailable") {
          const current = pointByKey.get(k);
          if (current && successful.length) {
            let nearest = null;
            for (const s of successful) {
              const d = distanceMeters(current.lat, current.lng, s.lat, s.lng);
              if (!nearest || d < nearest.distance) {
                nearest = { distance: d, label: s.label };
              }
            }
            if (nearest && nearest.distance <= 1500) {
              finalLabel = nearest.label;
            }
          }
        }

        if (!finalLabel || finalLabel === "Location unavailable") {
          const current = pointByKey.get(k);
          finalLabel =
            current && Number.isFinite(current.lat) && Number.isFinite(current.lng)
              ? `Lat ${current.lat.toFixed(5)}, Lng ${current.lng.toFixed(5)}`
              : "Location unavailable";
        }

        placeNameCacheRef.current.set(k, finalLabel);
        next[k] = finalLabel;
      });

      setInspectPlaceNames((prev) => ({ ...prev, ...next }));
    };

    hydratePlaces();

    return () => {
      cancelled = true;
    };
  }, [inspectRecord]);

  // Free map memory when tab is not visible
  useEffect(() => {
    if (tab !== "today") {
      destroyMapOnInstance(todayMapInstance, todayMarkersRef, todayPolyRef);
    }
    if (tab !== "admin") {
      destroyMapOnInstance(adminMapInstance, adminMarkersRef, adminPolyRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Global cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        clearBackgroundLocationHandler();
      } catch (_) {}

      try {
        if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
          stopBackgroundTracking().catch(() => {});
        }
      } catch (_) {}

      destroyMapOnInstance(todayMapInstance, todayMarkersRef, todayPolyRef);
      destroyMapOnInstance(adminMapInstance, adminMarkersRef, adminPolyRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // GLOBAL working time calculation (accessible everywhere)
let globalWorkingMs = 0;
let globalWorkingHMS = "00:00:00";

if (attendance) {
  let startDate = null;
  const hasCheckOut = !!(attendance.checkOutTime || attendance.checkOut);

  if (attendance._clientCheckIn) {
    startDate = new Date(attendance._clientCheckIn);
  } else if (attendance.checkInTime?.toDate) {
    startDate = attendance.checkInTime.toDate();
  } else if (attendance.checkIn) {
    startDate = typeof attendance.checkIn.toDate === "function"
      ? attendance.checkIn.toDate()
      : new Date(attendance.checkIn);
  }

  if (startDate && !hasCheckOut) {
    globalWorkingMs = nowTime - startDate;
  } else if (hasCheckOut) {
    globalWorkingMs = (attendance.totalMinutes || 0) * 60000;
  }

  globalWorkingHMS = msToHMS(globalWorkingMs);
}

  // -------------------------
  // Left sidebar component
  // -------------------------
  const LeftSidebar = () => {
    const doc = attendance || {};
    const hasCheckIn = !!(
      doc.checkInTime ||
      doc.checkIn ||
      doc._clientCheckIn
    );
    const hasCheckOut = !!(doc.checkOutTime || doc.checkOut);
    const live = hasCheckIn && !hasCheckOut ? { c: "green", t: "Live" } : { c: "red", t: "Idle" };

    // compute working time
    let workingMs = 0;
    // prefer client start if available
    const clientStartIso = doc?._clientCheckIn || null;
    let startDate = null;
    if (clientStartIso) startDate = new Date(clientStartIso);
    else if (doc && doc.checkInTime) startDate = typeof doc.checkInTime.toDate === "function" ? doc.checkInTime.toDate() : new Date(doc.checkInTime);
    else if (doc && doc.checkIn) startDate = typeof doc.checkIn.toDate === "function" ? doc.checkIn.toDate() : new Date(doc.checkIn);

    if (startDate && !hasCheckOut) workingMs = nowTime - startDate;
    else if (doc && hasCheckOut) workingMs = (doc.totalMinutes || 0) * 60000;

    const workingHMS = msToHMS(workingMs);

    const handleBackToApps = (e) => {
      if (e?.preventDefault) e.preventDefault();
      if (e?.stopPropagation) e.stopPropagation();
      if (backNavRef.current) return;
      backNavRef.current = true;
      try {
        window.location.hash = "#/apps";
      } catch (_) {}
      navigate("/apps", { replace: true });
      setTimeout(() => {
        backNavRef.current = false;
      }, 500);
    };

    return (
      <div style={{ padding: 16 }}>
        <button
          type="button"
          onPointerDown={handleBackToApps}
          onTouchStart={handleBackToApps}
          onClick={handleBackToApps}
          style={{
            ...btnStyle,
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 8px)",
            left: 12,
            zIndex: 99999,
            padding: "10px 12px",
            fontSize: 16,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            touchAction: "manipulation",
          }}
        >
          ←
        </button>
        <h3>Check-in Panel</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 12, background: live.c }} />
          <b>{live.t}</b>
        </div>

        <p><b>Date:</b> {todayStr}</p>
        <p><b>User:</b> {userName}</p>

        {!hasCheckIn ? (
          <button
  style={{
    ...btnStyle,
    opacity: checkingIn ? 0.6 : 1,
    cursor: checkingIn ? "not-allowed" : "pointer",
  }}
  onClick={handleCheckIn}
  disabled={checkingIn}
>
  {checkingIn ? "📍 Checking in..." : "➕ Check In"}
</button>
        ) : !hasCheckOut ? (
          <>
            <p>Checked in: {doc.checkInTime?.toDate ? doc.checkInTime.toDate().toLocaleTimeString() : (doc._clientCheckIn ? new Date(doc._clientCheckIn).toLocaleTimeString() : "-")}</p>
            <p><b>Working Time:</b> {workingHMS}</p>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
  <button
    style={{
      ...btnStyle,
      opacity: checkingOut ? 0.6 : 1,
      cursor: checkingOut ? "not-allowed" : "pointer",
    }}
    onClick={requestCheckOut}
    disabled={checkingOut}
  >
    {checkingOut ? "⏳ Checking out..." : "⏹ Check Out"}
  </button>
</div>
          </>
        ) : (
          <>
            <p>Checked out: {doc.checkOutTime?.toDate ? doc.checkOutTime.toDate().toLocaleTimeString() : String(doc.checkOutTime)}</p>
            <p>Status: {doc.status}</p>
            <p><b>Total Time:</b> {msToHMS((doc.totalMinutes || 0) * 60000)}</p>
          </>
        )}

        <h4 style={{ marginTop: 24 }}>Menu</h4>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button
    style={tab === "today" ? btnActive : btnInActive}
    onClick={() => setTab("today")}
  >
    Today
  </button>
  <button
    style={tab === "history" ? btnActive : btnInActive}
    onClick={() => setTab("history")}
  >
    History
  </button>

{canViewAdminPanels && (
  <button
    style={tab === "admin" ? btnActive : btnInActive}
    onClick={() => setTab("admin")}
  >
    Admin
  </button>
)}

{canViewLeaveApprovals && (
  <button
    style={tab === "leaveApprovals" ? btnActive : btnInActive}
    onClick={() => setTab("leaveApprovals")}
  >
    Leave Approvals
  </button>
)}
</div>
      </div>
    );
  };

  // -------------------------
  // Right side content (tabs)
  // -------------------------
  const RightSide = () => {
if (tab === "today") {
  return (
    <div 
  style={{ 
    width: "100%", 
    display: "flex",
    flexDirection: "column",
    alignItems: isMobile ? "center" : "flex-start"
  }}
>

{/* LEAVE + APPROVED PANEL */}
<div
  style={{
    display: "flex",
    gap: "16px",
    width: "100%",
    flexDirection: isMobile ? "column" : "row",
  }}
>
  {/* Leave Request */}
  <div
    style={{
      flex: 1,
      padding: "20px",
      background: "#f7f7f7",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    }}
  >
    <h2 style={{ color: "#800000", marginBottom: "15px" }}>
      Leave / Comp-off Request
    </h2>
    <LeaveRequest user={USER} />
  </div>

  {/* Approved Leaves */}
{canViewAdminPanels && (
  <div
    style={{
      flex: 1,
      padding: "20px",
      background: "#f7f7f7",      // match Leave box
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      display: "flex",
      flexDirection: "column",   // ✅ important
    }}
  >
    <h2 style={{ color: "#800000", marginBottom: "15px" }}>
      Approved Leaves / Comp-off
    </h2>

    {/* scroll ONLY inside panel */}
    <div style={{ flex: 1, overflowY: "auto" }}>
      <ApprovedLeavePanel />
    </div>
  </div>
)}
</div>

      {/* MAP */}
      <div
        style={{
          marginTop: 20,
          marginBottom: isMobile ? 140 : 96,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          boxShadow: "0 8px 16px rgba(0,0,0,0.08)",
          padding: 10,
        }}
      >
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>Today Map View</h4>
        <div
          ref={todayMapRef}
          style={{
            height: isMobile ? 300 : 390,
            width: "100%",
            borderRadius: "10px",
            border: "1px solid #ddd",
            overflow: "hidden",
            background: "#fff",
          }}
        />
      </div>
    </div>
  );
}

if (tab === "history") {
  return (
    <>
      <AttendanceMonthCalendar
        records={history}
        holidays={holidayList}
        workingDays={workingDaysList}
        approvedLeaves={approvedLeaveList}
        currentUserId={uid}
        currentUserEmail={user?.email || ""}
        onMonthChange={(from, to) => loadHistoryForMonth(from, to)}
      />

      {canViewAdminPanels && (
        <div style={{ marginTop: 30 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Belongs To (Active/Inactive)</label><br />
            <select
              value={belongsToFilter}
              onChange={(e) => setBelongsToFilter(e.target.value)}
              style={{ ...btnStyle, padding: "8px 10px", minWidth: 250 }}
            >
              {BELONGS_TO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <ActiveInactiveToday
  attendance={todayAttendance}
  users={belongsToFilteredUsers}
  belongsToFilter={belongsToFilter}
  selectedDate={getTodayStr()}
  onUserClick={handleActiveUserMapView}
/>
        </div>
      )}
    </>
  );
}


if (tab === "admin") {
  return (
    <>
      <h2>Admin Panel</h2>

      {/* Filter + Export */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Belongs To</label><br />
          <select
            value={belongsToFilter}
            onChange={(e) => {
              setBelongsToFilter(e.target.value);
              setFilterUser("");
              setInspectUserId("");
            }}
            style={{ ...btnStyle, padding: "8px 10px" }}
          >
            {BELONGS_TO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {/* User Filter */}
        <div style={{ minWidth: 320, maxWidth: 440, width: "100%" }}>
          <SearchableSelect
            options={userList}
            value={filterUser}
            onChange={(val) => setFilterUser(val || "")}
            placeholder="Search user by name or email (All Teams)"
            allowClear
            dropdownMaxHeight={380}
            showResultCount
            getOptionValue={(u) => u.id}
            getOptionLabel={(u) => `${u.name}`}
            getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""} ${u.id || ""}`}
          />
        </div>

        {/* Export Button (Admin / Sales Head Only) */}
        {canViewAdminPanels && (
  <button style={btnStyle} onClick={() => setShowExportPopup(true)}>
    Export XLSX
  </button>
)}
      </div>

          {/* Export popup */}
          {showExportPopup && (
            <div style={{ position: "relative", marginBottom: 14 }}>
              <div
                style={{
                  position: "relative",
                  zIndex: 20,
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  padding: 16,
                  borderRadius: 12,
                  boxShadow: "0 8px 18px rgba(0,0,0,0.08)",
                  maxWidth: 480,
                }}
              >
                <div style={{ marginBottom: 10, fontSize: 20, fontWeight: 800, color: "#24364b" }}><b>Export Options</b></div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={btnStyle} onClick={exportAdminCurrentMonth}>Current Month</button>
                  <button style={btnStyle} onClick={exportAdminAllRecords}>All Records</button>
                  <button style={btnGhost} onClick={() => setShowExportPopup(false)}>Close</button>
                </div>
              </div>
            </div>
          )}

<div style={{ marginBottom: 12 }}>
  {/* Admin holiday management (ADMIN ONLY stays same) */}
  {effectiveRole === "admin" && <AdminHolidayPanel />}
</div>


{/* 🔐 Inspect + Records for Admin-like roles */}
{canViewAdminPanels && (
  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(320px, 420px) minmax(0, 1fr)", gap: 14, marginBottom: 16 }}>
    <div>
      <h4>Inspect user/day</h4>
      <div style={{ minWidth: 320, maxWidth: 440, width: "100%" }}>
        <SearchableSelect
          options={belongsToFilteredUsers}
          value={inspectUserId}
          onChange={(val) => setInspectUserId(val || "")}
          placeholder="Type user name/email for inspect"
          dropdownMaxHeight={380}
          showResultCount
          getOptionValue={(u) => u.id}
          getOptionLabel={(u) => `${u.name}`}
          getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""} ${u.id || ""}`}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <label>Date</label><br />
        <input
          type="date"
          value={inspectDate}
          onChange={(e) => setInspectDate(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          style={{ ...btnStyle, marginRight: 8 }}
          onClick={handleInspectLoad}
          disabled={inspectLoading}
        >
          {inspectLoading ? "Loading..." : "Load User Day"}
        </button>
        <button
          style={btnGhost}
          onClick={() => {
            setInspectRecord(null);
            clearMapOnInstance(
              adminMapInstance,
              adminMarkersRef,
              adminPolyRef
            );
          }}
        >
          Clear
        </button>
      </div>
    </div>

    <div style={{ flex: 1 }}>
      <h4>Admin Records</h4>
      <div
        style={{
          maxHeight: 360,
          overflow: "auto",
          border: "1px solid #e5e7eb",
          padding: 8,
          borderRadius: 10,
          background: "#fff",
          boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
        }}
      >
        {adminFiltered.map((row) => (
          <div
            key={`${row.userId}_${row.date}`}
            style={{
              padding: 10,
              borderBottom: "1px solid #f3f4f6",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <b>{getUserNameById(row.userId, userList, row.userName, row.userEmail)}</b> — {row.date}
              <div>
                Status: {row.status} | Minutes:{" "}
                {row.totalMinutes ?? row.minutes ?? 0} | Locs:{" "}
                {row.locations?.length || 0}
              </div>
            </div>
            {effectiveRole === "admin" && (
              <div style={{ flexShrink: 0 }}>
                <button
                  style={btnOutline}
                  onClick={() => handleDeleteAdminRecord(row)}
                  disabled={deletingRecordKey === `${row.userId}_${row.date}`}
                >
                  {deletingRecordKey === `${row.userId}_${row.date}` ? "Deleting..." : "Delete"}
                </button>
              </div>
            )}
          </div>
        ))}

        {!adminFiltered.length && (
          <div style={{ padding: 10 }}>No records</div>
        )}
      </div>
    </div>
  </div>
)}
          {/* Map + details area (for admin inspect result or today's map) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 2fr) minmax(280px, 360px)",
              gap: 14,
              alignItems: "start",
              marginTop: 4,
              marginBottom: isMobile ? 140 : 96,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h4 style={{ marginTop: 0, marginBottom: 8 }}>Map View</h4>
              <div
                style={{
                  height: isMobile ? 320 : "min(52vh, 460px)",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#fff",
                  boxShadow: "0 8px 16px rgba(0,0,0,0.08)",
                }}
                ref={adminMapRef}
              />
            </div>

            <div style={{ width: "100%" }}>
              <h4 style={{ marginTop: 0 }}>Record Details</h4>
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  padding: 12,
                  borderRadius: 10,
                  background: "#fafafa",
                  minHeight: 180,
                  maxHeight: isMobile ? "min(45vh, 380px)" : "min(52vh, 460px)",
                  overflowY: "auto",
                  paddingBottom: 16,
                }}
              >
                {/* show either inspectRecord (admin selected) or the logged-in attendance */}
                {inspectRecord ? (
                  <>
                    <b>{getUserNameById(inspectRecord.userId, userList, inspectRecord.userName, inspectRecord.userEmail)}</b><br />
                    Date: {inspectRecord.date}<br />
                    Status: {inspectRecord.status}<br />
                    Minutes: {inspectRecord.totalMinutes ?? inspectRecord.minutes ?? 0}<br />
                    Locs: {(inspectRecord.locations || []).length}
                    <div
  style={{
    marginTop: 8,
                        maxHeight: "260px",     // ⭐ control visible height
    overflowY: "auto",      // ⭐ enable scrollbar
    paddingRight: "6px",
  }}
>
  {Array.isArray(inspectRecord.locations) &&
    inspectRecord.locations.map((l, i) => (
      (() => {
        const placeKey = getCoordKey(l.lat, l.lng);
        const placeName = placeKey ? inspectPlaceNames[placeKey] : "";
        const visiblePlaceName = placeName || getPointLocationFallbackLabel(l);
        return (
      <div
        key={i}
        style={{
          fontSize: 13,
          padding: "2px 0",
          borderBottom: "1px dashed #ddd",
        }}
      >
        <div>
          {i + 1}. {typeof l.lat === "number" ? l.lat.toFixed(6) : l.lat},{" "}
          {typeof l.lng === "number" ? l.lng.toFixed(6) : l.lng}
          {" "}| {getLocationTime12h(l)}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.2, marginTop: 2 }}>
          {visiblePlaceName}
        </div>
      </div>
        );
      })()
    ))}
</div>

                  </>
                ) : (
                  <div>No inspect record loaded.</div>
                )}
              </div>
            </div>
          </div>
        </>
      );
    }

if (tab === "leaveApprovals") {
  return (
    <>
      <h2>Leave Approval Queue</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Belongs To (Leave Approvals)</label><br />
        <select
          value={belongsToFilter}
          onChange={(e) => setBelongsToFilter(e.target.value)}
          style={{ ...btnStyle, padding: "8px 10px", minWidth: 250 }}
        >
          {BELONGS_TO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <LeaveApprovalsPanel
        externalBelongsToFilter={belongsToFilter}
        onExternalBelongsToFilterChange={setBelongsToFilter}
      />
    </>
  );
}

    return null;
  };
// -------------------------
// PROMINENT LOCATION DISCLOSURE (Google Play)
// -------------------------
if (showLocationDisclosure) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: BRAND_MAROON_PURPLE_GRADIENT,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Poppins, sans-serif",
      }}
    >
      <div style={{ maxWidth: "520px", textAlign: "center", padding: "20px" }}>

        {/* LOGO */}
        <img
          src={kapilLogo}
          alt="Kapil Power CRM"
          style={{
            width: "96px",     // ✅ display size ONLY
            height: "auto",
            marginBottom: "12px",
          }}
        />

        {/* APP NAME */}
        <div
          style={{
            fontSize: "14px",
            letterSpacing: "2px",
            opacity: 0.9,
            marginBottom: "24px",
          }}
        >
          KAPIL POWER CRM
        </div>

        {/* TITLE */}
        <h2 style={{ marginBottom: "16px" }}>
          Location Permission Required
        </h2>

        {/* CONTENT */}
        <p>Kapil Power CRM collects your location data to enable:</p>

        <ul
          style={{
            textAlign: "left",
            margin: "12px auto",
            maxWidth: "360px",
          }}
        >
          <li>Employee attendance tracking</li>
          <li>Field visit verification</li>
          <li>Work location monitoring</li>
        </ul>

        <p style={{ marginTop: "12px", fontSize: "14px" }}>
          This includes collecting location data even when the app is closed or
          not in use, to ensure accurate attendance and operational compliance.
        </p>

        <p style={{ marginTop: "12px", fontSize: "14px" }}>
          The app also uses motion/activity data (such as movement status) to
          improve location tracking accuracy and avoid duplicate entries.
        </p>

        <p style={{ marginTop: "12px", fontSize: "13px", opacity: 0.9 }}>
          Location data is used only for internal business purposes and is not
          shared with third parties.
        </p>

        {/* BUTTONS */}
        <div
          style={{
            marginTop: "28px",
            display: "flex",
            justifyContent: "center",
            gap: "14px",
          }}
        >
          <button
            style={{
              padding: "10px 18px",
              background: "#fff",
              color: "#800000",
              border: "none",
              borderRadius: "6px",
              fontWeight: "600",
              cursor: "pointer",
            }}
            onClick={() => {
  localStorage.setItem("locationDisclosureAccepted", "true");
  setShowLocationDisclosure(false);
}}
          >
            Allow & Continue
          </button>

          <button
            style={{
              padding: "10px 18px",
              background: "transparent",
              color: "#fff",
              border: "1px solid #fff",
              borderRadius: "6px",
              cursor: "pointer",
            }}
            onClick={() => {
  navigate("/apps");
}}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
  // MAIN
  return (
<div 
  style={{ 
    display: isMobile ? "block" : "flex",
    height: isMobile ? "auto" : "100dvh",
    minHeight: "100dvh",
    maxHeight: isMobile ? "none" : "100dvh",
    alignItems: "stretch",
    overflow: isMobile ? "auto" : "hidden",   // ⭐ allow scroll on mobile
    background: "#f4f4f4",
    fontFamily: "Poppins, sans-serif"
  }}
>
      <div 
  style={{
    width: isMobile ? "100%" : "320px",
    background: BRAND_MAROON_PURPLE_GRADIENT,
    color: "#fff",
    height: isMobile ? "auto" : "100%",
    minHeight: isMobile ? "auto" : "100dvh",
    overflowY: "auto",
    paddingBottom: `calc(${bottomNavGap} + 20px)`
  }}
>
        <LeftSidebar />
      </div>

 <div
  style={{
    flex: 1,
    padding: isMobile ? "12px" : "20px 40px",
     paddingBottom: contentBottomGap,
    overflowY: "auto",
    height: "100%",          // ⭐ important
    maxHeight: "100vh"       // ⭐ enables scroll properly
  }}
>
        {RightSide()}
      </div>

      {showCheckoutConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999999,
            padding: 16,
          }}
          onClick={() => setShowCheckoutConfirm(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 360,
              background: "#fff",
              borderRadius: 12,
              padding: "16px 16px 14px",
              boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: "0 0 8px", color: "#800000" }}>Confirm checkout</h4>
            <p style={{ margin: "0 0 14px", color: "#333" }}>
              Are you sure you want to do checkout?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                style={{ ...btnOutline, background: "#fff" }}
                onClick={() => setShowCheckoutConfirm(false)}
              >
                No
              </button>
              <button
                style={btnStyle}
                onClick={handleCheckOut}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {showGpsPermissionDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#fff",
              borderRadius: 12,
              padding: "16px 16px 14px",
              boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
            }}
          >
            <h4 style={{ margin: "0 0 8px", color: "#800000" }}>GPS is turned off</h4>
            <p style={{ margin: "0 0 14px", color: "#333" }}>
              Your GPS is turned off. Please turn it on to continue attendance tracking.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                style={{ ...btnOutline, background: "#fff" }}
                onClick={handleTurnOnGpsForAttendance}
                disabled={gpsDialogBusy}
              >
                Turn it on
              </button>
              <button
                style={btnStyle}
                onClick={handleGpsCancelAndAutoCheckout}
                disabled={gpsDialogBusy}
              >
                {gpsDialogBusy ? "Checking out..." : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// BUTTON STYLES (kept from your design)
const btnStyle = { background: "#fff", color: "#800000", border: "1px solid #800000", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, boxShadow: "0 2px 8px rgba(0,0,0,0.12)" };
const btnGhost = { background: "transparent", color: "#fff", border: "1px dashed #fff", padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontWeight: 600 };
const btnOutline = { background: "#ffeaea", color: "#800000", border: "1px solid #ffc1c1", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700 };
const btnActive = {
  background: "linear-gradient(180deg, #ffffff 0%, #fff2f2 100%)",
  color: "#7a0010",
  border: "1px solid #ffffff",
  padding: "10px 16px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
  letterSpacing: "0.2px",
  minWidth: 128,
  minHeight: 40,
  touchAction: "manipulation",
};
const btnInActive = {
  background: "rgba(255,255,255,0.16)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.42)",
  padding: "10px 16px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 700,
  minWidth: 128,
  minHeight: 40,
  touchAction: "manipulation",
};
