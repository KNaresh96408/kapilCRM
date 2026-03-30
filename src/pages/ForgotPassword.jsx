import React, { useMemo, useState } from "react";

const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

const postJson = async (path, payload) => {
  if (!API_BASE) {
    throw new Error("VITE_API_BASE is missing");
  }

  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const validEmail = (value) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizeEmail(value));

export default function ForgotPassword() {
  const initialEmail = useMemo(() => {
    try {
      const u = new URL(window.location.href);
      return normalizeEmail(u.searchParams.get("email") || "");
    } catch {
      return "";
    }
  }, []);

  const [step, setStep] = useState("request");
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const requestOtp = async () => {
    const cleanEmail = normalizeEmail(email);
    if (!validEmail(cleanEmail)) {
      setError("Enter a valid registered email address.");
      return;
    }

    setSendingOtp(true);
    setError("");
    setInfo("");

    try {
      await postJson("passwordForgotRequest", { email: cleanEmail });
      setEmail(cleanEmail);
      setStep("reset");
      setInfo("OTP request sent to Admin. Please contact K Naresh (Admin) to get OTP.");
    } catch (e) {
      setError(e?.message || "Failed to send OTP. Please try again.");
    } finally {
      setSendingOtp(false);
    }
  };

  const resetPassword = async () => {
    const cleanEmail = normalizeEmail(email);
    const cleanOtp = String(otp || "").trim();
    const cleanPassword = String(password || "");

    if (!validEmail(cleanEmail)) {
      setError("Enter a valid registered email address.");
      return;
    }
    if (!/^\d{6}$/.test(cleanOtp)) {
      setError("OTP must be 6 digits.");
      return;
    }
    if (cleanPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (cleanPassword !== confirmPassword) {
      setError("Password and confirm password do not match.");
      return;
    }

    setResetting(true);
    setError("");
    setInfo("");

    try {
      await postJson("passwordForgotReset", {
        email: cleanEmail,
        otp: cleanOtp,
        newPassword: cleanPassword,
      });
      setInfo("Password reset successful. Redirecting to login...");
      setTimeout(() => {
        window.location.href = "/";
      }, 900);
    } catch (e) {
      setError(e?.message || "Failed to reset password.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.badge}>Security</div>
        <h2 style={styles.title}>Forgot Password</h2>
        <p style={styles.subtitle}>
          {step === "request"
            ? "Enter your registered email. OTP will be sent to Admin for manual verification."
            : "Contact K Naresh (Admin) for OTP, then set your new password."}
        </p>

        <div style={styles.stepsRow}>
          <span style={{ ...styles.stepPill, ...(step === "request" ? styles.stepActive : {}) }}>1. Email</span>
          <span style={{ ...styles.stepPill, ...(step === "reset" ? styles.stepActive : {}) }}>2. OTP + Password</span>
        </div>

        <div style={styles.formGrid}>
          <label style={styles.label}>Registered Email</label>
          <input
            type="email"
            placeholder="Enter your registered email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            autoComplete="email"
          />

          {step === "reset" && (
            <>
              <div style={styles.adminNote}>
                Contact <b>K Naresh (Admin)</b> to receive OTP for this email.
              </div>

              <label style={styles.label}>OTP</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Enter 6-digit OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={styles.input}
              />

              <label style={styles.label}>New Password</label>
              <div style={styles.passwordWrap}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={styles.passwordInput}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>

              <label style={styles.label}>Confirm Password</label>
              <div style={styles.passwordWrap}>
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={styles.passwordInput}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} style={styles.eyeBtn}>
                  {showConfirmPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </>
          )}
        </div>

        {error ? <p style={styles.error}>{error}</p> : null}
        {info ? <p style={styles.info}>{info}</p> : null}

        {step === "request" ? (
          <button type="button" onClick={requestOtp} disabled={sendingOtp} style={styles.primaryBtn}>
            {sendingOtp ? "Sending OTP..." : "Send OTP"}
          </button>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <button type="button" onClick={resetPassword} disabled={resetting} style={styles.primaryBtn}>
              {resetting ? "Updating Password..." : "Reset Password"}
            </button>

            <button
              type="button"
              onClick={requestOtp}
              disabled={sendingOtp || resetting}
              style={styles.secondaryBtn}
            >
              {sendingOtp ? "Sending..." : "Resend OTP"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("request");
                setOtp("");
                setPassword("");
                setConfirmPassword("");
                setError("");
                setInfo("");
              }}
              style={styles.linkBtn}
            >
              ← Back to email step
            </button>
          </div>
        )}

        <button type="button" onClick={() => (window.location.href = "/")} style={styles.backToLogin}>
          Back to Login
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    background: "radial-gradient(circle at top, #f8eef1 0%, #f2f4f8 42%, #eef1f7 100%)",
  },
  card: {
    width: "min(480px, 100%)",
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 14px 34px rgba(67, 18, 44, 0.16)",
    border: "1px solid #edd7e2",
    padding: "20px 18px 16px",
  },
  badge: {
    display: "inline-block",
    borderRadius: 999,
    background: "#fcecef",
    color: "#851528",
    border: "1px solid #f3cdd6",
    fontSize: 12,
    fontWeight: 800,
    padding: "4px 10px",
    marginBottom: 8,
  },
  title: {
    margin: "0 0 6px",
    color: "#6f0f29",
    fontSize: 30,
    fontWeight: 900,
    letterSpacing: 0.2,
  },
  subtitle: {
    margin: "0 0 12px",
    color: "#6f6875",
    fontSize: 14,
  },
  stepsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  stepPill: {
    borderRadius: 999,
    border: "1px solid #e2d5df",
    color: "#75687a",
    fontWeight: 700,
    fontSize: 12,
    padding: "6px 10px",
    background: "#fff",
  },
  stepActive: {
    border: "1px solid #8b1027",
    color: "#8b1027",
    background: "#fdf1f4",
  },
  formGrid: {
    display: "grid",
    gap: 8,
  },
  label: {
    fontSize: 12,
    color: "#5a5261",
    fontWeight: 700,
    marginTop: 2,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #d8c3ce",
    background: "#fff",
    borderRadius: 10,
    fontSize: 14,
    padding: "11px 12px",
    outline: "none",
  },
  passwordWrap: {
    display: "flex",
    alignItems: "center",
    border: "1px solid #d8c3ce",
    borderRadius: 10,
    overflow: "hidden",
    background: "#fff",
  },
  passwordInput: {
    flex: 1,
    border: 0,
    padding: "11px 12px",
    outline: "none",
    fontSize: 14,
  },
  eyeBtn: {
    border: 0,
    background: "transparent",
    cursor: "pointer",
    padding: "0 10px",
    fontSize: 16,
    height: 40,
  },
  primaryBtn: {
    marginTop: 12,
    width: "100%",
    border: 0,
    borderRadius: 10,
    padding: "11px 12px",
    color: "#fff",
    fontWeight: 800,
    fontSize: 15,
    background: "linear-gradient(135deg,#8f1123,#5e167a)",
    cursor: "pointer",
  },
  secondaryBtn: {
    width: "100%",
    border: "1px solid #d8c3ce",
    borderRadius: 10,
    padding: "10px 12px",
    color: "#4a3f50",
    fontWeight: 700,
    background: "#fff",
    cursor: "pointer",
  },
  linkBtn: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "#6f0f29",
    cursor: "pointer",
    fontWeight: 700,
  },
  error: {
    marginTop: 10,
    color: "#b11b35",
    fontSize: 13,
    fontWeight: 600,
  },
  info: {
    marginTop: 10,
    color: "#236041",
    fontSize: 13,
    fontWeight: 600,
  },
  adminNote: {
    border: "1px solid #f0d4bc",
    background: "#fff8f2",
    color: "#8a4b20",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 13,
    fontWeight: 600,
    marginTop: 4,
    marginBottom: 2,
  },
  backToLogin: {
    marginTop: 10,
    width: "100%",
    border: "1px solid #e3d6df",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#faf8fb",
    color: "#59495d",
    fontWeight: 700,
    cursor: "pointer",
  },
};
