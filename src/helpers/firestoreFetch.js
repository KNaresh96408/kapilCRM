import { collection, getDocs, query, limit, startAfter } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { Capacitor } from "@capacitor/core";

// ================================
// 🔍 PLATFORM DETECTOR
// ================================
const isIOS =
  typeof window !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isNative =
  typeof window !== "undefined" &&
  typeof Capacitor !== "undefined" &&
  typeof Capacitor.isNativePlatform === "function" &&
  Capacitor.isNativePlatform();

// ================================
// 🧠 IN-MEMORY CACHE (SHORT TTL)
// ================================
const collectionCache = new Map();

const getCachedCollection = (collectionId, maxAgeMs) => {
  if (!maxAgeMs) return null;
  const hit = collectionCache.get(collectionId);
  if (!hit) return null;
  if (Date.now() - hit.ts > maxAgeMs) {
    collectionCache.delete(collectionId);
    return null;
  }
  return hit.data || null;
};

const setCachedCollection = (collectionId, data) => {
  collectionCache.set(collectionId, { ts: Date.now(), data });
};

// ================================
// 🔁 REST COLLECTION FETCH
// ================================
const fetchCollectionDocsREST = async (collectionId, cacheMs = 30000, pageSize = null) => {
  try {
    const cached = getCachedCollection(collectionId, cacheMs);
    if (cached) return cached;
    const { fetchCollectionREST } = await import("./firestoreRest");
    const rows = await fetchCollectionREST(collectionId, null, cacheMs);
    const limitedRows = pageSize ? rows.slice(0, Number(pageSize) || rows.length) : rows;
    console.log("🟢 REST collection success:", collectionId);
    setCachedCollection(collectionId, limitedRows);
    return limitedRows;
  } catch (e) {
    console.warn("❌ REST collection failed:", collectionId, e?.message);
    return [];
  }
};

// ================================
// 📦 COLLECTION FETCH (SDK → REST)
// ================================
export const fetchCollectionDocs = async (
  collectionId,
  timeoutMs = 2500,
  cacheMs = 30000,
  pageSize = null
) => {
  const cached = getCachedCollection(collectionId, cacheMs);
  if (cached) return cached;
  // 🚨 iOS → SKIP FIRESTORE SDK COMPLETELY
  if (isIOS || isNative) {
    return fetchCollectionDocsREST(collectionId, cacheMs, pageSize);
  }

  try {
    const baseRef = collection(db, collectionId);
    const q = pageSize ? query(baseRef, limit(pageSize)) : baseRef;
    const snap = await Promise.race([
      getDocs(q),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("collection fetch timeout")),
          timeoutMs
        )
      ),
    ]);

    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setCachedCollection(collectionId, rows);
    return rows;
  } catch (err) {
    console.warn(
      "🟡 SDK failed, fallback to REST:",
      collectionId,
      err?.message
    );
    return fetchCollectionDocsREST(collectionId, cacheMs, pageSize);
  }
};

// ================================
// 🔎 QUERY FETCH (SDK → REST)
// ================================
export const getDocsWithFallback = async (
  queryObj,
  collectionId,
  filterFn = null,
  timeoutMs = 2500,
  cacheMs = 30000,
  limitCount = null
) => {
  const cached = getCachedCollection(collectionId, cacheMs);
  if (cached) {
    const mapped = cached.map((r) => ({ id: r.id, data: r }));
    return filterFn ? mapped.filter((r) => filterFn(r.data)) : mapped;
  }
  // 🚨 iOS → REST ONLY
  if (isIOS || isNative) {
    const rows = await fetchCollectionDocsREST(collectionId, cacheMs, limitCount);
    const mapped = rows.map((r) => ({ id: r.id, data: r }));
    return filterFn ? mapped.filter((r) => filterFn(r.data)) : mapped;
  }

  try {
    const q = limitCount ? query(queryObj, limit(limitCount)) : queryObj;
    const snap = await Promise.race([
      getDocs(q),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("query fetch timeout")), timeoutMs)
      ),
    ]);

    const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    setCachedCollection(
      collectionId,
      rows.map((r) => ({ id: r.id, ...r.data }))
    );
    return filterFn ? rows.filter((r) => filterFn(r.data)) : rows;
  } catch {
    console.warn("🟡 SDK query failed, REST fallback");
    const rows = await fetchCollectionDocsREST(collectionId, cacheMs, limitCount);
    const mapped = rows.map((r) => ({ id: r.id, data: r }));
    return filterFn ? mapped.filter((r) => filterFn(r.data)) : mapped;
  }
};

// ================================
// 📄 PAGED QUERY FETCH (SDK → REST)
// ================================
export const fetchPagedDocs = async (
  baseQuery,
  collectionId,
  {
    limitCount = 200,
    startAfterDoc = null,
    timeoutMs = 2500,
    cacheMs = 0,
  } = {}
) => {
  // iOS/native → REST list only (no cursor)
  if (isIOS || isNative) {
    const rows = await fetchCollectionDocsREST(collectionId, cacheMs, limitCount);
    return { docs: rows, lastDoc: null };
  }

  try {
    const q = startAfterDoc
      ? query(baseQuery, startAfter(startAfterDoc), limit(limitCount))
      : query(baseQuery, limit(limitCount));

    const snap = await Promise.race([
      getDocs(q),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("paged query timeout")), timeoutMs)
      ),
    ]);

    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const lastDoc = snap.docs[snap.docs.length - 1] || null;
    return { docs: rows, lastDoc };
  } catch (err) {
    console.warn(
      "🟡 SDK paged query failed, REST fallback:",
      collectionId,
      err?.message
    );
    const rows = await fetchCollectionDocsREST(collectionId, cacheMs, limitCount);
    return { docs: rows, lastDoc: null };
  }
};