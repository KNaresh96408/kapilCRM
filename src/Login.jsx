// src/Login.jsx
import React, { useState, useEffect } from "react";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import app, { db } from "./firebaseConfig"; // ensure db export

const Login = () => {
  const auth = getAuth(app);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // if already logged in (Firebase auth), redirect
useEffect(() => {
  const unsubscribe = auth.onAuthStateChanged((user) => {
    if (user) {
      navigate("/apps");
    }
  });

  return () => unsubscribe();
}, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!email.endsWith("@kapilpower.com")) {
        setError("Only @kapilpower.com emails are allowed.");
        setLoading(false);
        return;
      }

      // sign in with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const firebaseUser = userCredential.user;

      // fetch full user profile from Firestore Users collection
      const userRef = doc(db, "Users", firebaseUser.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        setError("User profile not found in Firestore. Contact admin.");
        setLoading(false);
        return;
      }

      const fullUser = snap.data();

      // store fully in localStorage
      const kpUser = {
        uid: firebaseUser.uid,
        email: fullUser.email || firebaseUser.email,
        name: fullUser.Name || fullUser.name || "",
        role: fullUser.role || "User",
        permissions: fullUser.permissions || [],
      };

      localStorage.setItem("kp-user", JSON.stringify(kpUser));

      // redirect to apps selector
      navigate("/apps");
    } catch (err) {
      console.error("Login error:", err);
      setError("Invalid credentials or server error. Contact admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        fontFamily: "Poppins, sans-serif",
        backgroundColor: "#800000",
      }}
    >
      {/* LEFT PANEL */}
      <div
        style={{
          flex: "0 0 30%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            background: "white",
            padding: "40px 35px",
            borderRadius: "16px",
            width: "330px",
            boxShadow: "0 8px 25px rgba(0,0,0,0.25)",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              color: "#800000",
              fontSize: "24px",
              fontWeight: "bold",
              marginBottom: "30px",
            }}
          >
            Kapil Power CRM
          </h2>

          <form onSubmit={handleLogin}>

            {/* HIDDEN LABEL + ID/NAME FIX */}
            <label htmlFor="email" style={{ display: "none" }}>Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "18px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                fontSize: "15px",
                background: "#eef3ff",
                outline: "none",
                boxSizing: "border-box",
              }}
              required
            />

            <div style={{ position: "relative", marginBottom: "18px", width: "100%" }}>

              {/* HIDDEN LABEL + ID/NAME FIX */}
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
                  border: "1px solid #ccc",
                  fontSize: "15px",
                  background: "#eef3ff",
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

            <p
              onClick={() => navigate("/forgot-password")}
              style={{
                color: "#800000",
                textAlign: "right",
                fontWeight: "bold",
                marginTop: "-10px",
                marginBottom: "15px",
                cursor: "pointer",
              }}
            >
              Forgot Password?
            </p>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                backgroundColor: loading ? "#a05252" : "#800000",
                color: "white",
                border: "none",
                padding: "12px",
                fontSize: "16px",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>

          {error && <p style={{ color: "red", marginTop: "15px" }}>{error}</p>}
        </div>
      </div>

      {/* RIGHT SIDE IMAGE */}
      <div
        style={{
          flex: "0 0 70%",
          backgroundColor: "#800000",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <img
          src="/crm-illustration.png"
          alt="CRM"
          style={{
            width: "97%",
            borderRadius: "20px 0 0 20px",
            boxShadow: "-8px 0 20px rgba(0,0,0,0.3)",
          }}
        />
      </div>
    </div>
  );
};

export default Login;
