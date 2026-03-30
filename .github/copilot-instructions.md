# Kapil Power CRM (React + Vite + Capacitor)

## Big picture
- UI is a React SPA with HashRouter and protected routes. Routing lives in [src/App.jsx](src/App.jsx) (CRM sub-routes under `/crm/*`, analytics, attendance, site survey pages).
- Mobile builds are via Capacitor (iOS/Android folders present). Android back button behavior is customized in [src/App.jsx](src/App.jsx).
- Primary data store is Firebase (Auth + Firestore + Storage). Singleton instances live in [src/firebaseConfig.js](src/firebaseConfig.js); do not call `getAuth()`/`getFirestore()` elsewhere.
- Backend automation + HTTPS endpoints live in Cloud Functions in [functions/index.js](functions/index.js).

## Auth + session flow
- `AuthProvider` in [src/context/AuthContext.jsx](src/context/AuthContext.jsx) is the source of truth. It:
  - Listens to `onAuthStateChanged` and fetches the user profile from `Users/{uid}`.
  - Falls back to Firestore REST when WebView/SDK fetches time out (iOS-safe).
  - Persists session in localStorage under the `kp-user` key (including `idToken`).
- `ProtectedRoute` in [src/components/ProtectedRoute.jsx](src/components/ProtectedRoute.jsx) checks both web auth and Capacitor native auth (via `@capacitor-firebase/authentication`) and also requires the `kp-user` localStorage session.

## Firestore access patterns (iOS-safe)
- Use the helpers in [src/helpers/firestoreFetch.js](src/helpers/firestoreFetch.js) and [src/helpers/firestoreRest.js](src/helpers/firestoreRest.js) for SDK → REST fallback, especially for collections/queries in iOS WebView.
- Prefer SDK for normal web, but expect timeouts and fallback to REST; see `fetchCollectionDocs()` and `getDocsWithFallback()` for the standard pattern.

## API layer vs direct Firestore
- Attendance has two layers:
  - Direct Firestore writes in [src/attendanceFunctions.js](src/attendanceFunctions.js) (check-in/out, holidays).
  - Read-only HTTP API in [src/api/attendanceApi.js](src/api/attendanceApi.js) calling Cloud Functions using `VITE_API_BASE` and `Authorization: Bearer <idToken>`.

## Dynamic modules
- Dynamic CRM modules are resolved by `module` route params and configuration docs:
  - Load module metadata from `crm_modules` and layout from `crm_fields` using the helper fallback in [src/components/Dynamic/Wrappers/DynamicListWrapper.jsx](src/components/Dynamic/Wrappers/DynamicListWrapper.jsx).

## Conventions & integration points
- Permissions are enforced with `PermissionGate` on CRM routes (see [src/App.jsx](src/App.jsx)).
- Quotation → Sales Order flow pulls canonical deal data with SDK and REST fallback (see [src/components/QuotationPreview.jsx](src/components/QuotationPreview.jsx)).
- Use the `kp-user` session to access `idToken` for REST calls; do not invent new storage keys.

## Dev workflows
- Run Vite dev server: `npm run dev`.
- Build: `npm run build`.
- Lint: `npm run lint`.
- Preview build: `npm run preview`.

## Environment
- `VITE_API_BASE` must point to the Cloud Functions base URL (see [src/api/attendanceApi.js](src/api/attendanceApi.js)).