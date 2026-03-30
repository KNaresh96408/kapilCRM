// Fast cache helper (memory + localStorage) with stale-while-revalidate

const mem = new Map();
const inFlight = new Map();

const readLocal = (key) => {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch (_) {
    return null;
  }
};

const writeLocal = (key, payload) => {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {}
};

const setCache = (key, data) => {
  const payload = { ts: Date.now(), data };
  mem.set(key, payload);
  writeLocal(key, payload);
  return data;
};

export const fastCache = async ({
  key,
  maxAgeMs = 30 * 1000,
  allowStaleMs = 24 * 60 * 60 * 1000,
  fetcher,
  background = true,
}) => {
  const now = Date.now();
  const memCached = mem.get(key);
  const localCached = readLocal(key);
  const cached =
    memCached && localCached
      ? (memCached.ts >= localCached.ts ? memCached : localCached)
      : memCached || localCached;

  if (cached && cached.data !== undefined) {
    mem.set(key, cached);
    const age = now - cached.ts;
    if (age <= maxAgeMs) return cached.data;
    if (age <= allowStaleMs) {
      if (background && typeof fetcher === "function") {
        setTimeout(() => {
          Promise.resolve()
            .then(() => fetcher())
            .then((data) => setCache(key, data))
            .catch(() => {});
        }, 0);
      }
      return cached.data;
    }
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    const data = await fetcher();
    return setCache(key, data);
  })()
    .finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
};
