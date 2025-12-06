// src/components/AttendancePage.jsx  (FINAL — dual-map + export popup + admin inspect map drawing)
// Note: This file expects the helper functions you already have in ../firebase/attendanceFunctions
// and components LeaveRequest, AdminHolidayPanel, AttendanceMonthCalendar, plus getUserRoleFromDB.
// It also expects Leaflet available as a dynamic import when used.

import React, { useEffect, useState, useRef } from "react";
import {
  fetchAttendanceDoc,
  createOrEnsureDoc,
  checkIn,
  pollAddLocation,
  checkOut,
  getTodayStr,
  fetchAttendanceRange,
  fetchHolidays,
  fetchWorkingDays, // <-- keep this
} from "../firebase/attendanceFunctions";

import LeaveRequest from "./LeaveRequest";
import * as XLSX from "xlsx";
import AttendanceMonthCalendar from "./AttendanceMonthCalendar";
import AdminHolidayPanel from "./AdminHolidayPanel";
import { getUserRoleFromDB } from "../helpers/getUserRole";
import { useAuth } from "../context/AuthContext";


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

// load logged-in user from localStorage (your app already uses this)
const USER = JSON.parse(localStorage.getItem("kp-user") || "{}");

// helper: detect admin-like users
const isAdminUser = (role, user) => {
  if (role === "admin") return true;
  const adminEmails = ["loan@kapilpower.com", "kapiladmin@gmail.com"];
  const adminUIDs = ["0r8Xa7QPYHeosf65fBVdhI3kj5V2"];
  if (user?.email && adminEmails.includes(user.email)) return true;
  if (user?.uid && adminUIDs.includes(user.uid)) return true;
  return false;
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

const isMobile = window.innerWidth < 768; 

export default function AttendancePage() {
    const { user, roleData, loading: authLoading } = useAuth();

  // basic
  const [todayStr] = useState(getTodayStr());
  const [attendance, setAttendance] = useState(null); // today's attendance doc
  const [loading, setLoading] = useState(true);
  const [nowTime, setNowTime] = useState(new Date());
  const [tracking, setTracking] = useState(false);

  // holidays
  const [holidayList, setHolidayList] = useState([]);
  const [adminHolidayLoading, setAdminHolidayLoading] = useState(false);

  // working days (attendance_workingDays collection)
  const [workingDaysList, setWorkingDaysList] = useState([]);

  // tabs
  const [tab, setTab] = useState("today");

  // history (last 7 days)
  const [history, setHistory] = useState([]);
  const [historySummary, setHistorySummary] = useState({ present: 0, half: 0, absent: 0 });

  // admin
  const [adminData, setAdminData] = useState([]);
  const [userList, setUserList] = useState([]);
  const [filterUser, setFilterUser] = useState("");

  // role
  const [role, setRole] = useState("");

  // admin inspect user/day
  const [inspectUserId, setInspectUserId] = useState("");
  const [inspectDate, setInspectDate] = useState(getTodayStr());
  const [inspectRecord, setInspectRecord] = useState(null); // single day doc for inspect
  const [inspectLoading, setInspectLoading] = useState(false);

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

  // user info
  const uid = user?.uid;
  const userName = USER?.displayName || USER?.name || USER?.email || "User";

  // Check-in window (your rule)
  const CHECKIN_START = { h: 8, m: 0 };
  const CHECKIN_END = { h: 12, m: 0 };

  // Auto-checkout threshold when no location updates (in ms)
  const AUTO_CHECKOUT_AFTER = 30 * 60 * 1000; // 30 minutes

  // Export popup state
  const [showExportPopup, setShowExportPopup] = useState(false);

  // -------------------------
  // dynamic leaflet load
  // -------------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import("leaflet");
        L = mod.default || mod;
        await import("leaflet/dist/leaflet.css");
        // initialize maps if containers present
        if (mounted) {
          // init today map if that DOM exists and role allows
          if (todayMapRef.current && (isAdminUser(role, USER) || role === "sales_head")) {
            initTodayMap();
          }
          // init admin map if admin DOM exists
          if (adminMapRef.current && (isAdminUser(role, USER) || role === "sales_head")) {
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

  // -------------------------
  // load the logged-in user's role
  // -------------------------
useEffect(() => {
  if (roleData?.role) {
    setRole(roleData.role.toLowerCase());
  }
}, [roleData]);
  // -------------------------
  // load today's attendance + ensure doc exists
  // -------------------------
  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await createOrEnsureDoc(uid, userName, todayStr);
        const doc = await fetchAttendanceDoc(uid, todayStr);
        if (cancelled) return;
        setAttendance(doc);
        setLoading(false);
        // if checked in and not checked out, start tracking
        if (doc && doc.checkInTime && !doc.checkOutTime) startTracking();
      } catch (err) {
        console.error("Error loading today attendance", err);
        if (!cancelled) setLoading(false);
      }
    })();

    const t = setInterval(() => setNowTime(new Date()), 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, userName, todayStr]);

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
    try {
      setAdminHolidayLoading(true);
      const list = await fetchHolidays();
      setHolidayList(list || []);
    } catch (e) {
      console.warn("loadHolidays error", e);
    } finally {
      setAdminHolidayLoading(false);
    }
  };

  // -------------------------
  // working-days loader
  // -------------------------
  const loadWorkingDays = async () => {
    try {
      const list = await fetchWorkingDays();
      setWorkingDaysList(list || []);
    } catch (e) {
      console.warn("loadWorkingDays error", e);
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

  // -------------------------
  // check-in
  // -------------------------
  const handleCheckIn = async () => {
    const now = new Date();

    // check holiday / working-day rules first
    const today = todayStr;
    const holidayForUser = isHolidayForUser(today, uid);
    const workingDayForUser = isWorkingDayForUser(today, uid);

    // Holiday overrides: if this day is marked as holiday for user/all -> disable check-in
    if (holidayForUser) {
      alert("Today is marked as holiday (for you or all users). Check-in disabled.");
      return;
    }

    // If it's Sunday and NOT explicitly a working day for this user -> disable
    if (now.getDay() === 0 && !workingDayForUser) {
      alert("Today is Sunday / holiday. Check-in disabled unless admin allowed.");
      return;
    }

    // If outside defined check-in window (but we still allow if workingDayForUser? user asked only Sunday exception — keep window rule for all)
    const start = new Date();
    start.setHours(CHECKIN_START.h, CHECKIN_START.m, 0, 0);
    const end = new Date();
    end.setHours(CHECKIN_END.h, CHECKIN_END.m, 0, 0);
    if (now < start || now > end) {
      alert("Check-in is allowed only during allowed hours.");
      return;
    }

    if (!navigator.geolocation) {
      alert("Location not supported.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const clientIso = new Date().toISOString();
          await checkIn({
            uid,
            userName,
            dateStr: todayStr,
            coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            clientIso,
          });
          const updated = await fetchAttendanceDoc(uid, todayStr);
          setAttendance(updated);
          startTracking();
          alert("Checked in successfully!");
        } catch (err) {
          console.error("CHECKIN ERR:", err);
          alert("Check-in failed");
        }
      },
      () => alert("Location permission denied"),
      { enableHighAccuracy: true }
    );
  };

  // -------------------------
  // tracking (polling locations)
  // -------------------------
  const addTrackingPoint = async () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await pollAddLocation({
            uid,
            dateStr: todayStr,
            coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          const updated = await fetchAttendanceDoc(uid, todayStr);
          setAttendance(updated);
        } catch (err) {
          console.warn("pollAddLocation error", err);
        }
      },
      (err) => {
        console.warn("geolocation error while polling", err);
      },
      { enableHighAccuracy: true }
    );
  };

  const startTracking = () => {
    if (pollRef.current) return;
    addTrackingPoint();
    pollRef.current = setInterval(() => addTrackingPoint(), 5 * 60 * 1000); // 5 minutes
    setTracking(true);
  };

  const stopTracking = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setTracking(false);
  };

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
  const handleCheckOut = async () => {
    try {
      const res = await checkOut({
        uid,
        dateStr: todayStr,
        clientCheckOutDate: new Date(),
      });
      stopTracking();
      const updated = await fetchAttendanceDoc(uid, todayStr);
      setAttendance(updated);
      alert(`Checked out: ${res.status} — ${res.totalMinutes} mins`);
    } catch (err) {
      console.error("CHECKOUT ERR:", err);
      alert("Checkout failed");
    }
  };

  // -------------------------
  // history loader (last 7 days)
  // -------------------------
const loadHistory = async () => {
  try {
    // fetch everything from Firestore
    const all = await fetchAttendanceRange("1900-01-01", "9999-12-31");

    // filter only current logged-in user
    const userRows = all.filter(r => r.userId === uid);

    // sort ascending
    userRows.sort((a, b) => (a.date > b.date ? 1 : -1));

    setHistory(userRows);

    // summary
    const summary = { present: 0, half: 0, absent: 0 };
    userRows.forEach((r) => {
      const s = (r.status || "").toLowerCase();
      if (s === "present") summary.present++;
      else if (s === "half-day" || s === "half day") summary.half++;
      else summary.absent++;
    });

    setHistorySummary(summary);
  } catch (err) {
    console.warn("loadHistory err", err);
  }
};

  // -------------------------
  // ADMIN loader (all attendance)
  // -------------------------
const loadAdmin = async () => {
  try {
    const all = await fetchAttendanceRange("1900-01-01", "9999-12-31");

    // sort
    all.sort((a, b) => (a.date > b.date ? 1 : -1));

    setAdminData(all);

    // build user dropdown
// build user dropdown (remove duplicates cleanly)
const seen = new Map();

all.forEach((r) => {
  if (!r.userId) return;

  // Normalize username
  let cleanName = r.userName?.trim() || r.userId;

  // Key used to detect duplicates
  const key = cleanName.toLowerCase();

  // Store only first occurrence
  if (!seen.has(key)) {
    seen.set(key, { id: r.userId, name: cleanName });
  }
});

// Convert map → array
const list = Array.from(seen.values());

setUserList(list);
} catch (err) {
  console.warn("loadAdmin err", err);
}
};

// Filter admin data by selected user
const adminFiltered =
  filterUser === "" ? adminData : adminData.filter((r) => r.userId === filterUser);
  // -------------------------
  // export helpers (Current Month or All) with popup
  // -------------------------
  const buildExportWorkbook = (rowsMap) => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rowsMap);
    XLSX.utils.book_append_sheet(wb, sheet, "Export");
    return wb;
  };

  const exportAdminCurrentMonth = async () => {
    if (!isAdminUser(role, USER)) return alert("Admin only");
    try {
      const monthStr = getTodayStr().slice(0, 7); // YYYY-MM
      const currentMonthRows = adminData.filter((r) => (r.date || "").startsWith(monthStr));
      const cmData = currentMonthRows.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        date: r.date,
        status: r.status,
        totalMinutes: r.totalMinutes ?? r.minutes ?? 0,
        locationCount: (r.locations || []).length,
      }));
      const wb = buildExportWorkbook(cmData);
      const today = new Date().toISOString().split("T")[0];
      XLSX.writeFile(wb, `Attendance_CurrentMonth_${today}.xlsx`);
      setShowExportPopup(false);
    } catch (e) {
      console.error("export current month error", e);
      alert("Export failed");
    }
  };

  const exportAdminAllRecords = async () => {
    if (!isAdminUser(role, USER)) return alert("Admin only");
    try {
      const allData = adminData.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        date: r.date,
        status: r.status,
        totalMinutes: r.totalMinutes ?? r.minutes ?? 0,
        locationCount: (r.locations || []).length,
      }));
      const wb = buildExportWorkbook(allData);
      const today = new Date().toISOString().split("T")[0];
      XLSX.writeFile(wb, `Attendance_AllRecords_${today}.xlsx`);
      setShowExportPopup(false);
    } catch (e) {
      console.error("export all error", e);
      alert("Export failed");
    }
  };

  // -------------------------
  // MAP HELPERS (dual instances)
  // -------------------------
  const initTodayMap = () => {
    try {
      if (!L || !todayMapRef.current || todayMapInstance.current) return;
      const map = L.map(todayMapRef.current).setView([20.5937, 78.9629], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
      todayMapInstance.current = map;
    } catch (e) {
      console.warn("initTodayMap error:", e);
    }
  };

  const initAdminMap = () => {
    try {
      if (!L || !adminMapRef.current || adminMapInstance.current) return;
      const map = L.map(adminMapRef.current).setView([20.5937, 78.9629], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
      adminMapInstance.current = map;
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

  const drawPathOn = (doc, mapInstanceRef, markersRefVar, polyRefVar) => {
    try {
      if (!doc || !doc.locations || !L || !mapInstanceRef.current) return;
      // only for admin or sales_head
      if (!(isAdminUser(role, USER) || role === "sales_head")) return;

      const map = mapInstanceRef.current;

      // clear existing
      clearMapOnInstance(mapInstanceRef, markersRefVar, polyRefVar);

      const pts = (doc.locations || [])
        .map((p) => [Number(p.lat), Number(p.lng)])
        .filter((p) => p[0] && p[1]);

      if (!pts.length) return;

      pts.forEach((p, i) => {
        const marker = L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: i === 0 ? "green" : "#800000" }).addTo(map);
        markersRefVar.current.push(marker);
        if (i === 0) marker.bindPopup("Check-in");
        if (i === pts.length - 1) marker.bindPopup("Last location");
      });

      polyRefVar.current = L.polyline(pts, { color: "#800000", weight: 4 }).addTo(map);
      try {
        map.fitBounds(L.latLngBounds(pts).pad(0.2));
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
 // Auto-checkout when no locations update for 30 mins + permission check
useEffect(() => {
  const tryAutoCheckout = async () => {
    try {
      if (!attendance) return;
      if (!attendance.checkInTime) return;
      if (attendance.checkOutTime) return;

      // 1) Check GPS Permission
      const denied = await isLocationPermissionDenied();

      if (!denied) {
        // Permission is NOT denied → browser tab inactive / laptop sleep
        // DO NOT auto-checkout
        // console.log("GPS allowed but no updates → NOT auto-checkout");
        return;
      }

      // 2) Permission is denied → user manually turned off GPS
      // Now check last update time
      let lastUpdatedMs = 0;

      if (attendance.updatedAt?.toDate) {
        lastUpdatedMs = attendance.updatedAt.toDate().getTime();
      } else if (typeof attendance.updatedAt === "string") {
        const d = new Date(attendance.updatedAt);
        if (!isNaN(d.getTime())) lastUpdatedMs = d.getTime();
      }

      const now = Date.now();

      if (lastUpdatedMs && now - lastUpdatedMs > AUTO_CHECKOUT_AFTER) {
        console.warn("AUTO CHECKOUT: GPS TURNED OFF by user");

        await checkOut({
          uid: attendance.userId || uid,
          dateStr: attendance.date,
          clientCheckOutDate: new Date(),
        });

        const updated = await fetchAttendanceDoc(attendance.userId || uid, attendance.date);
        setAttendance(updated);

        if (isAdminUser(role, USER)) {
          alert(`Auto-checked out ${attendance.userName || attendance.userId} (GPS turned off)`);
        }
      }
    } catch (e) {
      console.error("Auto-checkout error:", e);
    }
  };

  tryAutoCheckout();
  const id = setInterval(tryAutoCheckout, 60 * 1000);
  return () => clearInterval(id);
}, [attendance, role, uid]);

  // -------------------------
  // Inspect user/day for admin
  // -------------------------
  const handleInspectLoad = async () => {
    if (!inspectUserId || !inspectDate) return alert("Select user and date");

    setInspectLoading(true);

    try {
      // fetch the single record
      const doc = await fetchAttendanceDoc(inspectUserId, inspectDate);
      setInspectRecord(doc);

      // draw immediately on admin map if present
      if (doc && L && adminMapRef.current) {
        if (!adminMapInstance.current) initAdminMap(); // create map once
        drawPathOn(doc, adminMapInstance, adminMarkersRef, adminPolyRef);
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

  // -------------------------
  // re-init data when switching tabs
  // -------------------------
  useEffect(() => {
    if (tab === "history") {
      loadHistory();
      loadHolidays();
      loadWorkingDays();
    } else if (tab === "admin") {
      loadAdmin();
      loadHolidays();
      loadWorkingDays();
      // ensure admin map is initialised when admin tab opens (if leaflet loaded)
      if (L && adminMapRef.current && !adminMapInstance.current) initAdminMap();
    } else if (tab === "today") {
      // refresh today's doc
      (async () => {
        if (!uid) return;
        const doc = await fetchAttendanceDoc(uid, todayStr);
        setAttendance(doc);
        // ensure today map exists
        if (L && todayMapRef.current && !todayMapInstance.current) initTodayMap();
        // also ensure we have latest holiday & working-day info
        loadHolidays();
        loadWorkingDays();
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // GLOBAL working time calculation (accessible everywhere)
let globalWorkingMs = 0;
let globalWorkingHMS = "00:00:00";

if (attendance) {
  let startDate = null;

  if (attendance._clientCheckIn) {
    startDate = new Date(attendance._clientCheckIn);
  } else if (attendance.checkInTime?.toDate) {
    startDate = attendance.checkInTime.toDate();
  }

  if (startDate && !attendance.checkOutTime) {
    globalWorkingMs = nowTime - startDate;
  } else if (attendance.checkOutTime) {
    globalWorkingMs = (attendance.totalMinutes || 0) * 60000;
  }

  globalWorkingHMS = msToHMS(globalWorkingMs);
}

  // -------------------------
  // Left sidebar component
  // -------------------------
  const LeftSidebar = () => {
    const doc = attendance || {};
    const live = doc.checkInTime && !doc.checkOutTime ? (tracking ? { c: "green", t: "Live" } : { c: "orange", t: "Paused" }) : { c: "red", t: "Idle" };

    // compute working time
    let workingMs = 0;
    // prefer client start if available
    const clientStartIso = doc?._clientCheckIn || null;
    let startDate = null;
    if (clientStartIso) startDate = new Date(clientStartIso);
    else if (doc && doc.checkInTime) startDate = typeof doc.checkInTime.toDate === "function" ? doc.checkInTime.toDate() : new Date(doc.checkInTime);

    if (startDate && !doc.checkOutTime) workingMs = nowTime - startDate;
    else if (doc && doc.checkOutTime) workingMs = (doc.totalMinutes || 0) * 60000;

    const workingHMS = msToHMS(workingMs);

    return (
      <div style={{ padding: 16 }}>
        <h3>Check-in Panel</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 12, background: live.c }} />
          <b>{live.t}</b>
        </div>

        <p><b>Date:</b> {todayStr}</p>
        <p><b>User:</b> {userName}</p>

        {!doc?.checkInTime ? (
          <button style={btnStyle} onClick={handleCheckIn}>➕ Check In</button>
        ) : !doc?.checkOutTime ? (
          <>
            <p>Checked in: {doc.checkInTime?.toDate ? doc.checkInTime.toDate().toLocaleTimeString() : (doc._clientCheckIn ? new Date(doc._clientCheckIn).toLocaleTimeString() : "-")}</p>
            <p><b>Working Time:</b> {workingHMS}</p>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
  <button style={btnStyle} onClick={handleCheckOut}>⏹ Check Out</button>
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

  {(isAdminUser(role, USER) || role === "sales_head") && (
    <button
      style={tab === "admin" ? btnActive : btnInActive}
      onClick={() => setTab("admin")}
    >
      Admin
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

      {/* LEAVE REQUEST CARD */}
      <div
        style={{
          width: "100%",
          maxWidth: isMobile ? "100%" : "600px",
width: "100%",
margin: isMobile ? "0" : "0 0 20px 0",
          padding: "20px",
          background: "#f7f7f7",
          borderRadius: "12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}
      >
        <h2 style={{ color: "#800000", marginBottom: "15px" }}>Leave / Comp-off Request</h2>

        <LeaveRequest user={USER} />
      </div>

      {/* MAP */}
      {(isAdminUser(role, USER) || role === "sales_head") && (
        <div
          ref={todayMapRef}
          style={{
            height: "350px",
            width: "100%",
            maxWidth: isMobile ? "100%" : "100%",
width: "100%",
margin: isMobile ? "20px 0" : "20px 0 0 0",
            borderRadius: "12px",
            border: "1px solid #ddd",
            overflow: "hidden",
          }}
        />
      )}
    </div>
  );
}

    if (tab === "history") {
  // history is an array of all days (sorted asc)
  return (
    <AttendanceMonthCalendar
      records={history}
      holidays={holidayList}
      workingDays={workingDaysList}   // ⭐ pass working-day overrides
      currentUserId={uid}
    />
  );
}

if (tab === "admin") {
  return (
    <>
      <h2>Admin Panel</h2>

      {/* Filter + Export */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        {/* User Filter */}
        <select
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All Users</option>
          {userList.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        {/* Export Button (Admin / Sales Head Only) */}
        {(isAdminUser(role, USER) || role === "sales_head") && (
          <button style={btnStyle} onClick={() => setShowExportPopup(true)}>
            Export XLSX
          </button>
        )}
      </div>

          {/* Export popup */}
          {showExportPopup && (
            <div style={{ position: "relative", marginBottom: 12 }}>
              <div style={{ position: "absolute", zIndex: 40, background: "#fff", border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
                <div style={{ marginBottom: 8 }}><b>Export Options</b></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={btnStyle} onClick={exportAdminCurrentMonth}>Current Month</button>
                  <button style={btnStyle} onClick={exportAdminAllRecords}>All Records</button>
                  <button style={btnGhost} onClick={() => setShowExportPopup(false)}>Close</button>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            {/* Admin holiday management */}
            {isAdminUser(role, USER) && <AdminHolidayPanel />}
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div>
              <h4>Inspect user/day</h4>
              <select value={inspectUserId} onChange={(e) => setInspectUserId(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
                <option value="">Select user</option>
                {userList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <div style={{ marginTop: 8 }}>
                <label>Date</label><br />
                <input type="date" value={inspectDate} onChange={(e) => setInspectDate(e.target.value)} />
              </div>
              <div style={{ marginTop: 8 }}>
                <button style={{ ...btnStyle, marginRight: 8 }} onClick={handleInspectLoad} disabled={inspectLoading}>
                  {inspectLoading ? "Loading..." : "Load User Day"}
                </button>
                <button style={btnGhost} onClick={() => { setInspectRecord(null); clearMapOnInstance(adminMapInstance, adminMarkersRef, adminPolyRef); }}>Clear</button>
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <h4>Admin Records</h4>
              <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #eee", padding: 8 }}>
                {adminFiltered.map((row) => (
                  <div key={`${row.userId}_${row.date}`} style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                    <b>{row.userName}</b> — {row.date}
                    <div> Status: {row.status} | Minutes: {row.totalMinutes ?? row.minutes ?? 0} | Locs: {row.locations?.length || 0} </div>
                  </div>
                ))}
                {!adminFiltered.length && <div style={{ padding: 10 }}>No records</div>}
              </div>
            </div>
          </div>

          {/* Map + details area (for admin inspect result or today's map) */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ height: 420, border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }} ref={adminMapRef} />
            </div>

            <div style={{ width: 360 }}>
              <h4>Record Details</h4>
              <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 6, background: "#fafafa", minHeight: 180 }}>
                {/* show either inspectRecord (admin selected) or the logged-in attendance */}
                {inspectRecord ? (
                  <>
                    <b>{inspectRecord.userName || inspectUserId}</b><br />
                    Date: {inspectRecord.date}<br />
                    Status: {inspectRecord.status}<br />
                    Minutes: {inspectRecord.totalMinutes ?? inspectRecord.minutes ?? 0}<br />
                    Locs: {(inspectRecord.locations || []).length}
                    <div style={{ marginTop: 8 }}>
                      {Array.isArray(inspectRecord.locations) && inspectRecord.locations.slice(0, 6).map((l, i) => (
                        <div key={i} style={{ fontSize: 13 }}>
                          {i + 1}. {typeof l.lat === "number" ? l.lat.toFixed(6) : l.lat}, {typeof l.lng === "number" ? l.lng.toFixed(6) : l.lng}
                        </div>
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

    return null;
  };

  // MAIN
  return (
<div 
  style={{ 
    display: isMobile ? "block" : "flex",
    height: "100vh",
    maxHeight: "100vh",
    overflow: isMobile ? "auto" : "hidden",   // ⭐ allow scroll on mobile
    background: "#f4f4f4",
    fontFamily: "Poppins, sans-serif"
  }}
>
      <div 
  style={{
    width: isMobile ? "100%" : "320px",
    background: "#800000",
    color: "#fff",
    overflowY: "auto",
    paddingBottom: "20px"
  }}
>
        <LeftSidebar />
      </div>

 <div
  style={{
    flex: 1,
    padding: isMobile ? "12px" : "20px 40px",
    overflowY: "auto",
    height: "100%",          // ⭐ important
    maxHeight: "100vh"       // ⭐ enables scroll properly
  }}
>
        {RightSide()}
      </div>
    </div>
  );
}

// BUTTON STYLES (kept from your design)
const btnStyle = { background: "#fff", color: "#800000", border: "1px solid #800000", padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
const btnGhost = { background: "transparent", color: "#fff", border: "1px dashed #fff", padding: "6px 8px", borderRadius: 6, cursor: "pointer" };
const btnOutline = { background: "#ffeaea", color: "#800000", border: "1px solid #ffc1c1", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
const btnActive = { background: "#fff", color: "#800000", border: "2px solid #fff", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontWeight: 700 };
const btnInActive = { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
