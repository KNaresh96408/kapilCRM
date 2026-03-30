import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { initMobilePushNotifications, syncPushTokenForCurrentUser } from "../native/pushNotifications";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const INACTIVE_MSG = 'Sorry, you have been removed by organization.';

  // Retry tracker for profile fetches
  const profileRetries = new Map();

  // Decode a JWT idToken safely to extract claims (name, role, etc.).
  // Handles base64url ("-","_") and missing padding.
  const decodeIdToken = (token) => {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      // base64url → base64
      let b = payload.replace(/-/g, '+').replace(/_/g, '/');
      // add padding
      while (b.length % 4) b += '=';
      const decoded = atob(b);
      // decode percent-encoded bytes into proper unicode string
      const json = decodeURIComponent(
        decoded
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const obj = JSON.parse(json);
      console.log('🟢 AuthContext: idToken decoded', { sub: obj.sub, role: obj.role });
      return obj;
    } catch (e) {
      console.warn('⚠️ AuthContext: idToken decode failed', e && (e.message || e));
      return null;
    }
  };

  // Helper: convert Firestore REST `fields` to plain object
  const fieldsToObject = (fields = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v.stringValue !== undefined) out[k] = v.stringValue;
      else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
      else if (v.doubleValue !== undefined) out[k] = Number(v.doubleValue);
      else if (v.booleanValue !== undefined) out[k] = !!v.booleanValue;
      else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
      else if (v.mapValue !== undefined) out[k] = fieldsToObject(v.mapValue.fields || {});
      else if (v.arrayValue !== undefined) out[k] = (v.arrayValue.values || []).map((it) => {
        if (it.stringValue !== undefined) return it.stringValue;
        if (it.integerValue !== undefined) return Number(it.integerValue);
        if (it.booleanValue !== undefined) return !!it.booleanValue;
        if (it.mapValue !== undefined) return fieldsToObject(it.mapValue.fields || {});
        return null;
      });
      else out[k] = null;
    }
    return out;
  };

  // Firestore REST profile fetch using idToken
  const fetchProfileREST = async (uid, idToken) => {
    try {
      const projectId = 'kapil-power-crm';
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/Users/${uid}`;
      console.log('🟡 AuthContext: REST profile fetch start', uid);
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`REST profile fetch failed ${resp.status} ${text}`);
      }
      const body = await resp.json();
      const data = fieldsToObject(body.fields || {});
      console.log('🟢 AuthContext: REST profile fetched', uid, data);
      return data;
    } catch (e) {
      console.warn('⚠️ AuthContext: REST profile fetch error', e && (e.message || e));
      throw e;
    }
  };

  useEffect(() => {
    let mounted = true;

    const fetchAndSetProfile = async (uid, base = {}, attempt = 1) => {
      const MAX_ATTEMPTS = 3;
      const TIMEOUT_MS = 2500;

      try {
        console.log("🟢 AuthContext: fetching profile for", uid, "attempt", attempt);

        const getPromise = getDoc(doc(db, "Users", uid));
        const snap = await Promise.race([
          getPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('profile fetch timeout')), TIMEOUT_MS)),
        ]);

        if (!mounted) return;

        if (snap && snap.exists && snap.exists()) {
          console.log("🟢 AuthContext: profile fetched for", uid);
          const data = snap.data();
          const normalized = {
            name: data.Name || data.name || "",
            role: (data.role || data.Role || "").toLowerCase(),
            ...data,
          };

          if (normalized.isActive === false) {
            console.warn('⛔ AuthContext: inactive profile blocked', uid);
            localStorage.removeItem('kp-user');
            try {
              await signOut(auth);
            } catch (signOutErr) {
              console.warn('⚠️ AuthContext: signOut failed (inactive sdk profile)', signOutErr?.message || signOutErr);
            }
            setUser(null);
            if (mounted) setLoading(false);
            alert(INACTIVE_MSG);
            return;
          }

          setUser({ uid, ...normalized, ...base });
          profileRetries.delete(uid);
        } else {
          console.log("🟡 AuthContext: no profile doc for", uid);
          setUser({ uid, ...base });
        }
      } catch (e) {
        // Log as much detail as possible (Firestore errors can be opaque in WebViews)
        // iOS WebView + Firestore SDK timeout is EXPECTED — REST fallback will handle it
console.warn(
  '🟡 Firestore SDK timeout on iOS — switching to REST profile fetch',
  e?.message || e
);

        // Attempt REST profile fetch (use idToken from base or localStorage) before retrying
        try {
          const stored = localStorage.getItem('kp-user');
          const parsed = stored ? JSON.parse(stored) : null;
          const token = base.idToken || (parsed && parsed.idToken) || null;
          if (token) {
            if (profileRetries.get(uid + ':rest')) {
              console.log('🟡 AuthContext: skipping REST profile fetch (recently attempted) for', uid);
            } else {
              profileRetries.set(uid + ':rest', 1);
              try {
                console.log('🟡 AuthContext: attempting REST profile fetch for', uid);
                const restData = await fetchProfileREST(uid, token);
                if (!mounted) return;
                const normalized = {
                  name: restData.Name || restData.name || restData.displayName || '',
                  role: (restData.role || restData.Role || '').toLowerCase(),
                  ...restData,
                };

                if (normalized.isActive === false) {
                  console.warn('⛔ AuthContext: inactive profile blocked (REST)', uid);
                  localStorage.removeItem('kp-user');
                  try {
                    await signOut(auth);
                  } catch (signOutErr) {
                    console.warn('⚠️ AuthContext: signOut failed (inactive rest profile)', signOutErr?.message || signOutErr);
                  }
                  setUser(null);
                  if (mounted) setLoading(false);
                  alert(INACTIVE_MSG);
                  return;
                }

                // sanitize sensitive fields before persisting
                const safeData = { ...normalized };
                delete safeData.password;
                delete safeData.Password;

                try {
                  const persisted = { uid, idToken: token, email: base.email || (parsed && parsed.email) || safeData.email, ...safeData };
                  localStorage.setItem('kp-user', JSON.stringify(persisted));
                  console.log('🟢 AuthContext: persisted profile to localStorage.kp-user', { uid });
                } catch (storageErr) {
                  console.warn('⚠️ AuthContext: failed to persist profile to localStorage', storageErr && (storageErr.message || storageErr));
                }

                setUser({ uid, ...normalized, ...base });
                profileRetries.delete(uid);
                profileRetries.delete(uid + ':rest');
                profileRetries.set(uid, MAX_ATTEMPTS); // ✅ stop SDK retries forever

                // kick off modulePermissions load (do not block UI)
                (async () => {
                  try {
                    await loadModulePermissions(uid, token);
                  } catch (e) {
                    console.warn('🟡 AuthContext: loadModulePermissions error', e && (e.message || e));
                  }
                })();

                if (mounted) setLoading(false);
                return;
              } catch (restErr) {
                console.warn('⚠️ AuthContext: REST profile fetch failed', restErr && (restErr.message || restErr));
                // allow REST to be retried later by clearing sentinel
                profileRetries.delete(uid + ':rest');
              }
            }
          }
        } catch (inner) {
          console.warn('⚠️ AuthContext: REST attempt prep failed', inner);
        }

        // If permission denied (security rules), don't retry — fall back to claims/local session
        const code = e && (e.code || e.code === 0 ? e.code : null);
        const message = e && e.message ? e.message : '';
        if (message.toLowerCase().includes('permission') || (code && String(code).toLowerCase().includes('permission'))) {
          console.log('🟡 AuthContext: permission denied for Users doc; using base session');
          if (!mounted) return;
          setUser({ uid, ...base });
          profileRetries.delete(uid);
          if (mounted) setLoading(false);
          return;
        }

        // Otherwise, If timed out or network hiccup, retry a few times with backoff
        const prev = profileRetries.get(uid) || 0;
        if (prev < MAX_ATTEMPTS && mounted) {
          profileRetries.set(uid, prev + 1);
          const backoff = 1000 * Math.pow(2, prev); // 1s, 2s, 4s
          console.log(`🟡 AuthContext: scheduling retry ${prev + 1} for ${uid} in ${backoff}ms`);
          setTimeout(() => {
            if (mounted) fetchAndSetProfile(uid, base, prev + 1);
          }, backoff);
        } else {
          if (!mounted) return;
          setUser({ uid, ...base });
          profileRetries.delete(uid);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Non-blocking: set loading while we fetch profile in background
      setLoading(true);
      const uid = firebaseUser.uid;
      const base = { email: firebaseUser.email };
      fetchAndSetProfile(uid, base);
    });

    // If web auth not available (e.g., web SDK blocked), allow localStorage or native fallbacks
    const onLocalLogin = (e) => {
      try {
        const obj = e?.detail ?? JSON.parse(localStorage.getItem('kp-user'));
        if (obj) {
          console.log("🟢 AuthContext: kp-login received", obj.uid || obj.email);

          if (obj.isActive === false) {
            localStorage.removeItem('kp-user');
            setUser(null);
            setLoading(false);
            alert(INACTIVE_MSG);
            return;
          }

          // If we have an idToken with claims, decode immediately and merge role/name for fast permission checks
          if (obj.idToken) {
            const claims = decodeIdToken(obj.idToken);
            if (claims) {
              const fast = {
                name: claims.name || claims.Name || obj.name || obj.Name || '',
                role: (claims.role || claims.Role || '').toLowerCase() || obj.role,
              };
              setUser({ ...obj, ...fast, _kp_local: true });
              setLoading(false);

              // kick off modulePermissions load if we have idToken
              if (obj.idToken) (async () => {
                try { await loadModulePermissions(obj.uid, obj.idToken); } catch (e) { console.warn('🟡 AuthContext: loadModulePermissions (kp-login) failed', e); }
              })();

              // If profile missing additional fields, fetch in background
              if (!fast.name || !fast.role) {
                fetchAndSetProfile(obj.uid, { email: obj.email, _kp_local: true });
              }

              return;
            }
          }

          // provide immediate minimal user so UI becomes responsive
          setUser({ ...obj, _kp_local: true });
          setLoading(false);

          // if profile fields missing, fetch in background
          if (!obj.Name || !obj.role) {
            fetchAndSetProfile(obj.uid, { email: obj.email, _kp_local: true });
          }
        }
      } catch (err) { console.warn('kp-login parse error', err); }
    };

    window.addEventListener('kp-login', onLocalLogin);

    // If there's already a local session (REST/native fallback), use it
    const stored = localStorage.getItem('kp-user');
    if (stored) {
      try {
        const obj = JSON.parse(stored);
        console.log("🟢 AuthContext: found stored kp-user", obj.uid || obj.email);

        if (obj.isActive === false) {
          localStorage.removeItem('kp-user');
          setUser(null);
          setLoading(false);
          alert(INACTIVE_MSG);
          return;
        }

        // Try to extract role/name from idToken quickly
        if (obj.idToken) {
          const claims = decodeIdToken(obj.idToken);
          if (claims) {
            const fast = {
              name: claims.name || claims.Name || obj.name || obj.Name || '',
              role: (claims.role || claims.Role || '').toLowerCase() || obj.role,
            };
            setUser({ ...obj, ...fast, _kp_local: true });
            setLoading(false);

            if (!fast.name || !fast.role) {
              fetchAndSetProfile(obj.uid, { email: obj.email, _kp_local: true });
            }
          } else {
            setUser({ ...obj, _kp_local: true });
            setLoading(false);
            if (!obj.Name || !obj.role) {
              fetchAndSetProfile(obj.uid, { email: obj.email, _kp_local: true });
            }
          }
        } else {
          setUser({ ...obj, _kp_local: true });
          setLoading(false);

          // load cached perms if present, otherwise fetch them via idToken
          if (obj.perms) {
            try {
              // try to expand old id-keyed perms into apiName and alias keys early
              (async () => {
                try {
                  const expanded = await expandStoredPerms(obj.perms);
                  setModulePerms(expanded);
                } catch (e) {
                  setModulePerms(obj.perms);
                }
              })();
            } catch (e) {
              try { setModulePerms(obj.perms); } catch (err) {}
            }
          } else if (obj.idToken) {
            (async () => {
              try { await loadModulePermissions(obj.uid, obj.idToken); } catch (e) { console.warn('🟡 AuthContext: loadModulePermissions startup failed', e); }
            })();
          }

          if (!obj.Name || !obj.role) {
            fetchAndSetProfile(obj.uid, { email: obj.email, _kp_local: true });
          }
        }
      } catch (e) { console.warn('kp-user parse error', e); }
    }

    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('kp-login', onLocalLogin);
    };
  }, []);

  // Module permissions cache (module -> perms object)
  const [modulePerms, setModulePerms] = useState({});

  // Helper: expand an existing stored perms map (often keyed by doc.id) to include
  // apiName and normalized aliases so PermissionGate can short-circuit reliably.
  const expandStoredPerms = async (storedPerms = {}) => {
    try {
      if (!storedPerms || Object.keys(storedPerms).length === 0) return storedPerms;
      const rows = await import('../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('crm_modules'));
      const modules = rows || [];
      const out = { ...storedPerms };

      modules.forEach((mod) => {
        const candidates = new Set();
        if (mod.apiName) candidates.add(String(mod.apiName));
        if (mod.moduleApiName) candidates.add(String(mod.moduleApiName));
        if (mod.name) candidates.add(String(mod.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        if (mod.api) candidates.add(String(mod.api));
        if (mod.apiName && mod.apiName.includes('_')) candidates.add(mod.apiName.replace(/_/g, '-'));
        candidates.add(mod.id);

        // If we have a perm under the module.id, map it to all candidates
        const source = storedPerms[mod.id] || storedPerms[mod.apiName] || storedPerms[mod.moduleApiName];
        if (source) {
          candidates.forEach((k) => {
            if (!k) return;
            if (!out[k]) out[k] = source;
          });
        }
      });

      console.log('🟡 AuthContext: expanded stored perms keys', Object.keys(out));
      return out;
    } catch (e) {
      console.warn('⚠️ AuthContext: expandStoredPerms failed', e && (e.message || e));
      return storedPerms;
    }
  };

  // Dev/debug flag: ?auth_debug=1 in URL or Vite env `VITE_AUTH_DEBUG=1`
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const showDebug = urlParams.get('auth_debug') === '1' || (import.meta.env && import.meta.env.VITE_AUTH_DEBUG === '1');

  // Load modulePermissions via REST for the given uid and token and cache them
  const loadModulePermissions = async (uidToUse, token) => {
    if (!uidToUse || !token) return;
    try {
      console.log('🟡 AuthContext: loading modulePermissions via REST', uidToUse);
      // 1) list modules
      let modules = await import('../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('crm_modules'));
      // defensive: only modules with an id
      modules = (modules || []).filter((m) => m && m.id);
      console.log('🟡 AuthContext: found modules count for perms', modules.length);

      // 2) fetch permissions for each module in parallel
      const promises = modules.map(async (mod) => {
        try {
          const { fetchDocumentREST } = await import('../helpers/firestoreRest');

          // Try a few likely keys for the modulePermissions doc (apiName, underscored -> dashed, fallback to id)
          const candidates = [];
          if (mod.apiName) candidates.push(mod.apiName);
          if (mod.moduleApiName) candidates.push(mod.moduleApiName);
          if (mod.name) candidates.push(String(mod.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
          if (mod.api) candidates.push(mod.api);
          // underscore -> dash variant
          if (mod.apiName && mod.apiName.includes('_')) candidates.push(mod.apiName.replace(/_/g, '-'));
          // id fallback
          candidates.push(mod.id);

          let doc = null;
          for (const key of candidates) {
            if (!key) continue;
            try {
              const maybe = await fetchDocumentREST(`modulePermissions/${key}/users/${uidToUse}`, token);
              if (maybe && Object.keys(maybe).length) { doc = maybe; break; }
            } catch (_) {
              // ignore and try next candidate
            }
          }

          return [mod, doc];
        } catch (e) {
          console.warn('⚠️ AuthContext: modulePermissions REST fetch error for', mod && (mod.apiName || mod.id), e && (e.message || e));
          return [mod, null];
        }
      });

      const settled = await Promise.all(promises);
      const map = {};

      settled.forEach(([mod, doc]) => {
        if (!mod) return;

        // Build multiple lookup keys so PermissionGate (which may use apiName or route names)
        // can short-circuit quickly without an extra network call.
        const keys = new Set();
        if (mod.apiName) keys.add(String(mod.apiName));
        if (mod.apiName) keys.add(String(mod.apiName).replace(/_/g, '-'));
        if (mod.moduleApiName) keys.add(String(mod.moduleApiName));
        if (mod.name) keys.add(String(mod.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        keys.add(mod.id);

        keys.forEach((k) => {
          if (!k) return;
          if (doc && Object.keys(doc).length) map[k] = doc;
        });
      });

      setModulePerms(map);
      console.log('🟢 AuthContext: modulePerms keys', Object.keys(map));

      // persist into localStorage.kp-user.perms for quicker startup
      try {
        const stored = localStorage.getItem('kp-user');
        const parsed = stored ? JSON.parse(stored) : {};
        parsed.perms = map;
        localStorage.setItem('kp-user', JSON.stringify(parsed));
        console.log('🟢 AuthContext: persisted modulePerms to localStorage.kp-user.perms');
      } catch (err) {
        console.warn('⚠️ AuthContext: failed to persist modulePerms', err && (err.message || err));
      }
    } catch (e) {
      console.warn('⚠️ AuthContext: loadModulePermissions failed', e && (e.message || e));
    }
  };

  const refetchProfileREST = async (uidParam) => {
    const uidToUse = uidParam || (user && user.uid);
    if (!uidToUse) return console.warn('No UID to refetch');
    const stored = localStorage.getItem('kp-user');
    const parsed = stored ? JSON.parse(stored) : null;
    const token = (parsed && parsed.idToken) || null;
    if (!token) return console.warn('No idToken available in localStorage');

    try {
      const data = await fetchProfileREST(uidToUse, token);
      const normalized = {
        name: data.Name || data.name || data.displayName || '',
        role: (data.role || data.Role || '').toLowerCase(),
        ...data,
      };

      // sanitize and persist
      const safeData = { ...normalized };
      delete safeData.password;
      delete safeData.Password;
      try {
        const persisted = { uid: uidToUse, idToken: token, email: (parsed && parsed.email) || safeData.email, ...safeData };
        localStorage.setItem('kp-user', JSON.stringify(persisted));
        console.log('🟢 AuthContext: persisted profile to localStorage.kp-user', { uid: uidToUse });
      } catch (storageErr) {
        console.warn('⚠️ AuthContext: failed to persist profile to localStorage', storageErr && (storageErr.message || storageErr));
      }

      // clear sentinel if any
      profileRetries.delete(uidToUse + ':rest');

      // kick off module perms load
      (async () => {
        try {
          await loadModulePermissions(uidToUse, token);
        } catch (err) {
          console.warn('🟡 AuthContext: loadModulePermissions failed (manual refetch)', err && (err.message || err));
        }
      })();

      setUser({ uid: uidToUse, ...normalized, _kp_local: true });
      console.log('🟢 AuthContext: refetchProfileREST success', uidToUse);
    } catch (e) {
      // allow manual refetch to be retried later
      profileRetries.delete(uidToUse + ':rest');
      console.warn('❌ AuthContext: refetchProfileREST failed', e);
    }
  };

  const clearSession = () => {
    localStorage.removeItem('kp-user');
    setUser(null);
    setModulePerms({});
    setLoading(false);
    console.log('🧹 AuthContext: cleared local session');
  };

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;

    (async () => {
      try {
        await initMobilePushNotifications();
        await syncPushTokenForCurrentUser(uid, user?.email || '');
      } catch (e) {
        console.warn('⚠️ AuthContext: push setup failed', e?.message || e);
      }
    })();
  }, [user?.uid, user?.email]);

  return (
    <AuthContext.Provider value={{ user, loading, modulePerms, refetchProfileREST, loadModulePermissions, clearSession }}>
      {children}

      {showDebug && (
        <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9999, width: 320, maxHeight: '60vh', overflow: 'auto', background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Auth Debug</strong>
            <div>
              <button onClick={() => refetchProfileREST()} style={{ marginRight: 8 }}>Refetch profile (REST)</button>
              <button onClick={() => clearSession()}>Clear session</button>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 6 }}><strong>localStorage.kp-user</strong></div>
            <pre style={{ background: '#f6f6f6', padding: 8, borderRadius: 6, overflowX: 'auto' }}>{localStorage.getItem('kp-user') || 'null'}</pre>
            <div style={{ marginTop: 8, marginBottom: 6 }}><strong>AuthContext.user</strong></div>
            <pre style={{ background: '#f6f6f6', padding: 8, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(user || {}, null, 2)}</pre>
            <div style={{ marginTop: 8, marginBottom: 6 }}><strong>modulePerms (cached)</strong></div>
            <pre style={{ background: '#f6f6f6', padding: 8, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(modulePerms || {}, null, 2)}</pre>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);