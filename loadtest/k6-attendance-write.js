import http from "k6/http";
import { check, sleep } from "k6";

const API_BASE = __ENV.API_BASE || "";
const ID_TOKEN = __ENV.ID_TOKEN || "";
const USER_UID = __ENV.USER_UID || __ENV.KP_UID || "";
const MAX_VUS = Number(__ENV.MAX_VUS || 150);

if (!API_BASE) throw new Error("Missing API_BASE env var");
if (!ID_TOKEN) throw new Error("Missing ID_TOKEN env var");
if (!USER_UID) throw new Error("Missing USER_UID env var");

const headers = {
  Authorization: `Bearer ${ID_TOKEN}`,
  "Content-Type": "application/json",
};

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
  const date = todayStr();
  const docId = `${USER_UID}_${date}_${__VU}_${__ITER}`;

  const resIn = http.post(
    `${API_BASE}/loadtestAttendanceCheckIn`,
    JSON.stringify({
      uid: USER_UID,
      date,
      docId,
      collection: "attendance_loadtest",
    }),
    { headers }
  );

  check(resIn, {
    "check-in ok": (r) => r.status === 200,
  });

  const resOut = http.post(
    `${API_BASE}/loadtestAttendanceCheckOut`,
    JSON.stringify({
      uid: USER_UID,
      date,
      docId,
      collection: "attendance_loadtest",
    }),
    { headers }
  );

  check(resOut, {
    "check-out ok": (r) => r.status === 200,
  });

  sleep(1);
}
