import http from "k6/http";
import { check, sleep } from "k6";

const API_BASE = __ENV.API_BASE || "";
const ID_TOKEN = __ENV.ID_TOKEN || "";
const MAX_VUS = Number(__ENV.MAX_VUS || 150);

if (!API_BASE) throw new Error("Missing API_BASE env var");
if (!ID_TOKEN) throw new Error("Missing ID_TOKEN env var");

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

export default function () {
  const docId = `loadtest_${__VU}`;
  const payload = {
    vu: __VU,
    iter: __ITER,
    ts: Date.now(),
  };

  const res = http.post(
    `${API_BASE}/loadtestCrmUpdate`,
    JSON.stringify({
      collection: "crm_loadtest",
      docId,
      payload,
    }),
    { headers }
  );

  check(res, {
    "crm update ok": (r) => r.status === 200,
  });

  sleep(1);
}
