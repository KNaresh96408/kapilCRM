import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import kapilLogo from "./kapil-logo.png";


const Login = () => {
  const navigate = useNavigate();

  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  useEffect(() => {
    console.log("🟢 Login page mounted (once)");
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState("signin");

  const sectionCopy = {
    home: "Welcome to Kapil Power highly customized CRM — built to streamline leads, deals, attendance, surveys, and internal operations in one fast, practical workspace.",
    about: "Kapil Power is a solar-focused energy company delivering end-to-end clean energy solutions for homes and businesses, with a strong focus on quality execution and customer value.",
    services: "Services include solar consultation, system design, rooftop/ground installation, commissioning, maintenance, and energy optimization support for residential and commercial projects.",
    signin: "Sign in to access your personalized dashboard, tasks, notifications, and module permissions.",
  };

  const INACTIVE_MSG = "Sorry, you have been removed by organization.";

  const parseRestIsActive = (fields = {}) => {
    const val = fields?.isActive;
    if (!val) return null;
    if (val.booleanValue !== undefined) return !!val.booleanValue;
    if (val.stringValue !== undefined) return val.stringValue === "true";
    return null;
  };

  const assertActiveUser = async (uid, idToken) => {
    const clean = String(uid || "").trim();
    if (!clean) return;

    const TIMEOUT_MS = 2500;

    try {
      const snap = await Promise.race([
        getDoc(doc(db, "Users", clean)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("profile fetch timeout")), TIMEOUT_MS)),
      ]);

      if (snap.exists && snap.exists() && snap.data()?.isActive === false) {
        throw new Error(INACTIVE_MSG);
      }
      return;
    } catch (e) {
      console.warn("🟡 assertActiveUser: SDK fetch failed or timed out; trying REST", e?.message || e);
    }

    if (!idToken) return;

    try {
      const projectId = "kapil-power-crm";
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/Users/${clean}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      if (!resp.ok) return;
      const body = await resp.json();
      const isActive = parseRestIsActive(body?.fields || {});
      if (isActive === false) throw new Error(INACTIVE_MSG);
    } catch (e) {
      console.warn("🟡 assertActiveUser: REST fetch failed", e?.message || e);
    }
  };

const handleLogin = async (e) => {
  e.preventDefault();
  console.log("🟢 STEP 1: Login start", { emailProvided: !!email, emailPreview: email ? `${email.slice(0,3)}...` : null });

  setLoading(true);
  setError("");

  try {
    // ✅ Prefer native plugin on device to avoid WebView CORS issues
    const isNative = Capacitor.isNativePlatform();
    const isAndroidNative = isNative && Capacitor.getPlatform() === "android";
    if (isAndroidNative) {
      try {
        console.log("🟢 Attempting native sign-in via FirebaseAuthentication plugin");
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const nativeResult = await FirebaseAuthentication.signInWithEmailAndPassword({ email: email.trim(), password });
        console.log("🟢 Native sign-in result", nativeResult);

        // Save session locally (used by app) — include idToken for REST reads (crm_fields, perms)
        try {
          const uid = nativeResult?.user?.uid ?? nativeResult?.user?.userId ?? null;
          let idToken = null;
          try {
            const tokenRes = await Promise.race([
              FirebaseAuthentication.getIdToken({ forceRefresh: false }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("native token timeout")), 1200)
              ),
            ]);
            idToken = tokenRes?.token || tokenRes?.idToken || null;
          } catch (tokenErr) {
            console.warn('⚠️ Native getIdToken delayed/failed, continuing login', tokenErr);
          }

          assertActiveUser(uid, idToken).catch(() => {});

          const userObj = {
            uid,
            email: nativeResult?.user?.email || email.trim(),
            idToken,
            ...nativeResult?.user,
          };
          localStorage.setItem('kp-user', JSON.stringify(userObj));
          window.dispatchEvent(new CustomEvent('kp-login', { detail: userObj }));
        } catch (e) {
          console.warn('⚠️ Could not store native user to localStorage', e);
        }

        // Navigate to apps — ProtectedRoute will allow native user
        navigate('/apps');
        return;
      } catch (err) {
        console.warn("⚠️ Native sign-in failed, falling back to web", err);
        // continue to web sign-in flow
      }
    }

    // Fallback: Firebase Web SDK sign-in
    console.log("🟢 STEP 1.1: calling signInWithEmailAndPassword", { online: navigator.onLine });

    // Quick network reachability check (non-blocking)
    (async () => {
      try {
        const netStart = Date.now();
        const resp = await Promise.race([
          fetch("https://clients3.google.com/generate_204", { method: "GET", cache: "no-store", mode: "no-cors" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Network check timeout 5s")), 5000)),
        ]);

        const status = resp && typeof resp.status === "number" ? resp.status : (resp && resp.type === "opaque" ? 0 : null);
        console.log("🟢 Network check result", { status, tookMs: Date.now() - netStart });
        if (status === null) throw new Error("Network unreachable (no response status)");
      } catch (netErr) {
        console.warn("⚠️ Network check failed (WebView may be blocked)", netErr);
      }
    })();

    // Start both SDK and REST sign-ins in parallel and take whichever succeeds first
    const sdkWrapped = signInWithEmailAndPassword(auth, email.trim(), password)
      .then((cred) => ({ type: 'sdk', cred }))
      .catch((err) => { throw { path: 'sdk', err }; });

    const restPromise = (async () => {
      try {
        const apiKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) || "AIzaSyDU5NoZEXltxUNyzUMgEVBpCMQ2iwgSPs4";
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
        });
        const body = await resp.json();
        if (resp.ok) return { type: 'rest', body };
        throw { path: 'rest', err: new Error(body?.error?.message || 'REST auth failed') };
      } catch (e) { throw { path: 'rest', err: e }; }
    })();

    // take whichever resolves first; also keep an overall timeout
    const winner = await Promise.race([
      sdkWrapped,
      restPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout after 15s')), 15000)),
    ]);

    if (winner.type === 'sdk') {
      const uid = winner.cred.user.uid;
      assertActiveUser(uid).catch(() => {});

      console.log('🟢 STEP 2: SDK login success', uid);
      try {
        const userObj = { uid, email: winner.cred.user?.email || email.trim() };
        localStorage.setItem('kp-user', JSON.stringify(userObj));
        window.dispatchEvent(new CustomEvent('kp-login', { detail: userObj }));
        console.log('🟢 STEP 4: Navigate → /apps (profile fetch deferred to AuthContext)');
        navigate('/apps');
        return;
      } catch (e) {
        console.warn('⚠️ Failed to persist minimal session (sdk)', e);
      }
    } else if (winner.type === 'rest') {
      const body = winner.body;
      const uid = body.localId || body.userId;
      assertActiveUser(uid, body?.idToken || body?.id_token || null).catch(() => {});

      console.log('🟢 STEP 2: REST login success', body.localId || body.userId);
      try {
        const userObj = { uid, email: body.email, idToken: body.idToken };
        localStorage.setItem('kp-user', JSON.stringify(userObj));
        window.dispatchEvent(new CustomEvent('kp-login', { detail: userObj }));
        // Navigate immediately — AuthContext will fetch profile and modulePermissions in background
        console.log('🟢 STEP 4: Navigate → /apps (REST auth)');
        navigate('/apps');
        return;
      } catch (e) {
        console.warn('⚠️ Failed to persist minimal session (rest)', e);
      }
    } else {
      throw new Error('No auth winner');
    }

  } catch (err) {
    // Enhanced error logging for opaque errors inside WKWebView
    try {
      console.error("❌ LOGIN FAILED (detailed)", {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        stack: err?.stack,
        json: (() => {
          try { return JSON.stringify(err); } catch { return null; }
        })(),
      });
    } catch (logErr) {
      console.error("❌ LOGIN FAILED (could not stringify error)", err, logErr);
    }

    // If the web SDK hung (timeout), attempt REST fallback to identitytoolkit
    const authTimeout = err?.message && err.message.includes("Auth timeout");

    if (authTimeout) {
      try {
        console.log("🟡 Attempting REST fallback to identitytoolkit.signInWithPassword");
        const apiKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) || "AIzaSyDU5NoZEXltxUNyzUMgEVBpCMQ2iwgSPs4";
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
        });

        const body = await resp.json();
        console.log('🟡 REST fallback response', resp.status, body);

        if (resp.ok) {
          const uid = body.localId || body.userId;
          await assertActiveUser(uid, body?.idToken || body?.id_token || null);

          const userObj = { uid, email: body.email, idToken: body.idToken };

          // store minimal session for app usage; AuthContext will fetch profile asynchronously
          localStorage.setItem('kp-user', JSON.stringify(userObj));
          window.dispatchEvent(new CustomEvent('kp-login', { detail: userObj }));

          // Navigate immediately
          navigate('/apps');
          return;
        } else {
          setError(body?.error?.message || 'REST auth failed');
        }
      } catch (restErr) {
        console.error('❌ REST fallback failed', restErr);
        setError(restErr?.message || 'REST auth failed');
      } finally {
        setLoading(false);
      }
    }

    if ((err?.message || "").toLowerCase().includes("removed by organization")) {
      try {
        await signOut(auth);
      } catch (signOutErr) {
        console.warn('⚠️ signOut failed after inactive block', signOutErr?.message || signOutErr);
      }
      localStorage.removeItem('kp-user');
      setError(INACTIVE_MSG);
      return;
    }

    // show both code & message when available
    setError(err?.code ? `${err.code}: ${err.message}` : err?.message || "Login failed");
  } finally {
    setLoading(false);
  }
};

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        fontFamily: "Poppins, sans-serif",
        background: "#dfe2eb",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? "10px" : "22px",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "-118px",
          bottom: "-118px",
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #7b0f22, #9f1f4e)",
          opacity: 0.96,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: "-108px",
          top: "-108px",
          width: "280px",
          height: "280px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #4a1f7f, #2f1f6e)",
          opacity: 0.96,
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: isMobile ? "520px" : "1220px",
          minHeight: isMobile ? "auto" : "820px",
          background: "#fff",
          borderRadius: "2px",
          boxShadow: "0 22px 40px rgba(20, 26, 52, 0.18)",
          padding: isMobile ? "14px" : "26px 34px",
          zIndex: 2,
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isMobile ? 10 : 20 }}>
          <img src={kapilLogo} alt="Kapil Power" style={{ height: isMobile ? 32 : 42, objectFit: "contain" }} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {[
              ["home", "Home"],
              ["about", "About Us"],
              ["services", "Services"],
              ["signin", "Sign in"],
            ].map(([key, label]) => {
              const active = activeSection === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveSection(key)}
                  style={{
                    border: active ? "1px solid #2a3ca9" : "1px solid #d8ddea",
                    background: active ? "#2a3ca9" : "#fff",
                    color: active ? "#fff" : "#475569",
                    borderRadius: 8,
                    padding: "7px 12px",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 34, alignItems: "center", minHeight: isMobile ? "auto" : "680px" }}>
          {!isMobile && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
              <img
                src="/login-illustration-custom.svg"
                alt="Login Illustration"
                style={{ width: "100%", maxWidth: 560, objectFit: "contain" }}
              />
            </div>
          )}

          <div
            style={{
              border: activeSection === "signin" ? "2px solid #ff3f8e" : "2px solid transparent",
              borderRadius: 16,
              padding: isMobile ? "14px" : "22px",
              boxShadow: activeSection === "signin" ? "0 0 0 4px rgba(255, 63, 142, 0.12)" : "none",
              transition: "all 160ms ease",
              background: isMobile ? "#ffffff" : "transparent",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: isMobile ? 34 : 48, fontWeight: 800, color: "#101828", letterSpacing: 0.2 }}>USER LOGIN</h2>

            <form onSubmit={handleLogin}>
              <label htmlFor="email" style={{ display: "none" }}>Email</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="Username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  marginBottom: "12px",
                  borderRadius: "8px",
                  border: "1px solid #bac5d8",
                  fontSize: "15px",
                  background: "#f8fbff",
                  outline: "none",
                  boxSizing: "border-box",
                }}
                required
              />

              <div style={{ position: "relative", marginBottom: "12px", width: "100%" }}>
                <label htmlFor="password" style={{ display: "none" }}>Password</label>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 40px 12px 12px",
                    borderRadius: "8px",
                    border: "1px solid #bac5d8",
                    fontSize: "15px",
                    background: "#f8fbff",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  required
                />

                <span
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    cursor: "pointer",
                    fontSize: "18px",
                  }}
                >
                  {showPassword ? "👁️" : "👁️‍🗨️"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ color: "#64748b", fontSize: 13 }}>Remember</span>
                <span
                  onClick={() => navigate("/forgot-password")}
                  style={{ color: "#2a3ca9", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Forgot password?
                </span>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  backgroundColor: loading ? "#ff7eb2" : "#ff3f8e",
                  color: "white",
                  border: "none",
                  padding: "12px",
                  fontSize: "16px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                }}
              >
                {loading ? "Logging in..." : "LOGIN"}
              </button>
            </form>

            {error && <p style={{ color: "#e11d48", marginTop: "12px" }}>{error}</p>}

            <div
              style={{
                marginTop: 14,
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                background: "#f8fafc",
                padding: "12px",
              }}
            >
              <p style={{ margin: 0, fontSize: 13.5, color: "#334155", lineHeight: 1.55 }}>
                {sectionCopy[activeSection]}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
