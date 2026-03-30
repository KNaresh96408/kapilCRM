# Load testing (k6)

## Prereqs
- Install k6: https://k6.io/docs/get-started/installation/

## Environment variables
- `API_BASE`: Cloud Functions base URL (same as `VITE_API_BASE`)
- `ID_TOKEN`: Firebase Auth ID token for a real user

## Run
```
API_BASE="https://<region>-<project>.cloudfunctions.net" \
ID_TOKEN="<token>" \
USER_UID="<uid>" \
k6 run loadtest/k6-attendance.js
```

## Run (Attendance writes)
```
API_BASE="https://<region>-<project>.cloudfunctions.net" \
ID_TOKEN="<token>" \
USER_UID="<uid>" \
MAX_VUS=500 \
k6 run loadtest/k6-attendance-write.js
```

## Run (CRM Firestore REST)
```
API_BASE="https://<region>-<project>.cloudfunctions.net" \
ID_TOKEN="<token>" \
MAX_VUS=150 \
k6 run loadtest/k6-crm.js
```

## Run (CRM writes)
```
API_BASE="https://<region>-<project>.cloudfunctions.net" \
ID_TOKEN="<token>" \
MAX_VUS=500 \
k6 run loadtest/k6-crm-write.js
```

## Interpretation
- Look at the p95 latency and failure rate from the summary.
- Capacity is the highest stable VU target where p95 and errors stay within thresholds.
