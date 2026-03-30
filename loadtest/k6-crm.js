import http from "k6/http";
import { check, sleep } from "k6";

const API_BASE = __ENV.API_BASE || "";
const ID_TOKEN = __ENV.ID_TOKEN || "";
const MAX_VUS = Number(__ENV.MAX_VUS || 150);
const MAX_ERROR_SAMPLES = Number(__ENV.ERROR_SAMPLES || 5);
let errorSamples = 0;

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

const runQuery = (collectionId) => {
  const res = http.get(
    `${API_BASE}/getCrmList?module=${encodeURIComponent(collectionId)}&limit=25`,
    { headers }
  );
  check(res, {
    [`${collectionId} ok`]: (r) => r.status === 200,
  });
  if (res.status !== 200 && errorSamples < MAX_ERROR_SAMPLES) {
    errorSamples += 1;
    const snippet = typeof res.body === "string" ? res.body.slice(0, 300) : "";
    console.warn(
      `k6-crm ${collectionId} failed: status=${res.status} body=${snippet}`
    );
  }
};

export default function () {
  runQuery("leads");
  runQuery("deals");
  runQuery("salesOrders");
  runQuery("projects");
  sleep(1);
}
