import http from "k6/http";
import { check, sleep } from "k6";
import encoding from "k6/encoding";

const API_BASE = __ENV.API_BASE || ""; // e.g. https://asia-south1-<project>.cloudfunctions.net
const ID_TOKEN = __ENV.ID_TOKEN || "";

if (!API_BASE) {
  throw new Error("Missing API_BASE env var");
}
if (!ID_TOKEN) {
  throw new Error("Missing ID_TOKEN env var");
}

const decodeJwtPayload = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    const decoded = encoding.b64decode(padded, "rawstd");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const jwtPayload = decodeJwtPayload(ID_TOKEN) || {};
const UID = __ENV.USER_UID || __ENV.KP_UID || jwtPayload.user_id || jwtPayload.sub || "";

if (!UID) {
  throw new Error("Missing UID (set USER_UID/KP_UID env var or use a valid ID_TOKEN)");
}

const headers = {
  Authorization: `Bearer ${ID_TOKEN}`,
  "Content-Type": "application/json",
};

const MAX_VUS = Number(__ENV.MAX_VUS || 150);

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: Math.min(25, MAX_VUS) },
        { duration: "2m", target: Math.min(50, MAX_VUS) },
        { duration: "2m", target: Math.min(100, MAX_VUS) },
        { duration: "2m", target: MAX_VUS },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function () {
  const today = todayStr();

  const resToday = http.get(`${API_BASE}/getAttendanceToday`, {
    headers: {
      ...headers,
      uid: UID,
    },
  });
  check(resToday, {
    "today ok": (r) => r.status === 200,
  });

  const resRange = http.get(
    `${API_BASE}/getAttendanceRange?from=${today}&to=${today}&uid=${encodeURIComponent(UID)}`,
    { headers }
  );
  check(resRange, {
    "range ok": (r) => r.status === 200,
  });

  const resHolidays = http.get(`${API_BASE}/getHolidays`, { headers });
  check(resHolidays, {
    "holidays ok": (r) => r.status === 200,
  });

  const resWorking = http.get(`${API_BASE}/getWorkingDays`, { headers });
  check(resWorking, {
    "working days ok": (r) => r.status === 200,
  });

  sleep(1);
}
