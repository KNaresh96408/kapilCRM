import app, { auth } from '../firebaseConfig';

// ------------------------------------------------------------
// 🧠 In-memory cache for REST collections (short TTL)
// ------------------------------------------------------------
const restCollectionCache = new Map();

const getRestCachedCollection = (key, maxAgeMs) => {
  if (!maxAgeMs) return null;
  const hit = restCollectionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > maxAgeMs) {
    restCollectionCache.delete(key);
    return null;
  }
  return hit.data || null;
};

const setRestCachedCollection = (key, data) => {
  restCollectionCache.set(key, { ts: Date.now(), data });
};

const resolveToken = async (initialToken) => {
  if (initialToken) return initialToken;
  try {
    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    if (stored?.idToken) return stored.idToken;
  } catch (_) {}
  try {
    const user = auth?.currentUser;
    if (user?.getIdToken) return await user.getIdToken();
  } catch (_) {}
  return null;
};

const persistToken = (token) => {
  if (!token) return;
  try {
    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    stored.idToken = token;
    localStorage.setItem("kp-user", JSON.stringify(stored));
  } catch (_) {}
};

// Convert Firestore REST 'fields' map to plain JS object
export const fieldsToObject = (fields = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) out[k] = Number(v.doubleValue);
    else if (v.booleanValue !== undefined) out[k] = !!v.booleanValue;
    else if (v.timestampValue !== undefined) {
      const d = new Date(v.timestampValue);
      const seconds = Math.floor(d.getTime() / 1000);
      const nanoseconds = 0;
      out[k] = {
        seconds,
        nanoseconds,
        toDate: () => d,
      };
    }
    else if (v.mapValue !== undefined) out[k] = fieldsToObject(v.mapValue.fields || {});
    else if (v.arrayValue !== undefined) out[k] = (v.arrayValue.values || []).map((it) => {
      if (it.stringValue !== undefined) return it.stringValue;
      if (it.integerValue !== undefined) return Number(it.integerValue);
      if (it.booleanValue !== undefined) return !!it.booleanValue;
      if (it.mapValue !== undefined) return fieldsToObject(it.mapValue.fields || {});
      if (it.timestampValue !== undefined) {
        const d = new Date(it.timestampValue);
        const seconds = Math.floor(d.getTime() / 1000);
        const nanoseconds = 0;
        return { seconds, nanoseconds, toDate: () => d };
      }
      return null;
    });
    else out[k] = null;
  }
  return out;
};

export const fetchDocumentREST = async (docPath, idToken) => {
  try {
    const projectId = (app && app.options && app.options.projectId) || 'kapil-power-crm';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
    const token = await resolveToken(idToken);
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let resp = await fetch(url, { headers });
    if (resp.status === 401) {
      try {
        const fresh = await auth?.currentUser?.getIdToken?.(true);
        if (fresh) {
          persistToken(fresh);
          const retryHeaders = { Authorization: `Bearer ${fresh}` };
          resp = await fetch(url, { headers: retryHeaders });
        }
      } catch (_) {}
    }
    if (resp.status === 404) {
      return null;
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`REST fetch failed ${resp.status} ${text}`);
    }
    const body = await resp.json();
    return fieldsToObject(body.fields || {});
  } catch (e) {
    console.warn('⚠️ firestoreRest: fetchDocumentREST error', e && (e.message || e));
    throw e;
  }
};
// ------------------------------------------------------------
// Fetch entire collection via Firestore REST (iOS-safe)
// ------------------------------------------------------------
export const fetchCollectionREST = async (collectionName, idToken, cacheMs = 30000) => {
  try {
    const cached = getRestCachedCollection(collectionName, cacheMs);
    if (cached) return cached;
    const projectId =
      (app && app.options && app.options.projectId) || "kapil-power-crm";

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}`;

    const token = await resolveToken(idToken);
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let resp = await fetch(url, { headers });
    if (resp.status === 401) {
      try {
        const fresh = await auth?.currentUser?.getIdToken?.(true);
        if (fresh) {
          persistToken(fresh);
          const retryHeaders = { Authorization: `Bearer ${fresh}` };
          resp = await fetch(url, { headers: retryHeaders });
        }
      } catch (_) {}
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`REST collection fetch failed ${resp.status} ${text}`);
    }

    const body = await resp.json();

    const rows = (body.documents || []).map((doc) => ({
      id: doc.name.split("/").pop(),
      ...fieldsToObject(doc.fields || {}),
    }));
    setRestCachedCollection(collectionName, rows);
    return rows;
  } catch (e) {
    console.warn(
      "⚠️ firestoreRest: fetchCollectionREST error",
      e && (e.message || e)
    );
    throw e;
  }
};

// ------------------------------------------------------------
// Convert plain JS object to Firestore REST 'fields' format
// ------------------------------------------------------------
const objectToFields = (obj = {}) => {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else if (typeof v === 'string') {
      fields[k] = { stringValue: v };
    } else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        fields[k] = { integerValue: String(v) };
      } else {
        fields[k] = { doubleValue: v };
      }
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (v instanceof Date) {
      fields[k] = { timestampValue: v.toISOString() };
    } else if (Array.isArray(v)) {
      fields[k] = {
        arrayValue: {
          values: v.map((item) => {
            if (typeof item === 'string') return { stringValue: item };
            if (typeof item === 'number') return Number.isInteger(item) ? { integerValue: String(item) } : { doubleValue: item };
            if (typeof item === 'boolean') return { booleanValue: item };
            if (typeof item === 'object' && item !== null) return { mapValue: { fields: objectToFields(item) } };
            return { nullValue: null };
          })
        }
      };
    } else if (typeof v === 'object') {
      fields[k] = { mapValue: { fields: objectToFields(v) } };
    } else {
      fields[k] = { nullValue: null };
    }
  }
  return fields;
};

// ------------------------------------------------------------
// Update document via Firestore REST (iOS-safe)
// ------------------------------------------------------------
export const updateDocumentREST = async (collectionName, docId, data, idToken) => {
  try {
    const projectId = (app && app.options && app.options.projectId) || 'kapil-power-crm';
    
    // Build updateMask with all field paths from data object
    const fieldPaths = Object.keys(data);
    const updateMaskParam = fieldPaths.map(path => `updateMask.fieldPaths=${encodeURIComponent(path)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}/${docId}?${updateMaskParam}`;
    
    const token = await resolveToken(idToken);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const body = JSON.stringify({
      fields: objectToFields(data)
    });

    let resp = await fetch(url, { 
      method: 'PATCH',
      headers,
      body 
    });

    if (resp.status === 401) {
      try {
        const fresh = await auth?.currentUser?.getIdToken?.(true);
        if (fresh) {
          persistToken(fresh);
          const retryHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh}` };
          resp = await fetch(url, { method: 'PATCH', headers: retryHeaders, body });
        }
      } catch (_) {}
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`REST update failed ${resp.status} ${text}`);
    }

    const result = await resp.json();
    return {
      id: docId,
      ...fieldsToObject(result.fields || {})
    };
  } catch (e) {
    console.warn('⚠️ firestoreRest: updateDocumentREST error', e && (e.message || e));
    throw e;
  }
};

// ------------------------------------------------------------
// Create document via Firestore REST (iOS-safe)
// ------------------------------------------------------------
export const createDocumentREST = async (collectionName, data, idToken, docId = null) => {
  try {
    const projectId = (app && app.options && app.options.projectId) || 'kapil-power-crm';
    let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}`;
    
    // If docId is provided, use it
    if (docId) {
      url += `?documentId=${docId}`;
    }
    
    const token = await resolveToken(idToken);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const body = JSON.stringify({
      fields: objectToFields(data)
    });

    let resp = await fetch(url, { 
      method: 'POST',
      headers,
      body 
    });

    if (resp.status === 401) {
      try {
        const fresh = await auth?.currentUser?.getIdToken?.(true);
        if (fresh) {
          persistToken(fresh);
          const retryHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh}` };
          resp = await fetch(url, { method: 'POST', headers: retryHeaders, body });
        }
      } catch (_) {}
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`REST create failed ${resp.status} ${text}`);
    }

    const result = await resp.json();
    const createdId = result.name.split('/').pop();
    return {
      id: createdId,
      ...fieldsToObject(result.fields || {})
    };
  } catch (e) {
    console.warn('⚠️ firestoreRest: createDocumentREST error', e && (e.message || e));
    throw e;
  }
};

// ------------------------------------------------------------
// Delete document via Firestore REST (iOS-safe)
// ------------------------------------------------------------
export const deleteDocumentREST = async (collectionName, docId, idToken) => {
  try {
    const projectId = (app && app.options && app.options.projectId) || 'kapil-power-crm';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}/${docId}`;
    
    const token = await resolveToken(idToken);
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let resp = await fetch(url, { 
      method: 'DELETE',
      headers
    });

    if (resp.status === 401) {
      try {
        const fresh = await auth?.currentUser?.getIdToken?.(true);
        if (fresh) {
          persistToken(fresh);
          const retryHeaders = { Authorization: `Bearer ${fresh}` };
          resp = await fetch(url, { method: 'DELETE', headers: retryHeaders });
        }
      } catch (_) {}
    }

    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text();
      throw new Error(`REST delete failed ${resp.status} ${text}`);
    }

    return { success: true, id: docId };
  } catch (e) {
    console.warn('⚠️ firestoreRest: deleteDocumentREST error', e && (e.message || e));
    throw e;
  }
};
