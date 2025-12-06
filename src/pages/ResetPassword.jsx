import React, { useState } from "react";

export default function ResetPassword() {
  const url = new URL(window.location.href);
  const email = url.searchParams.get("email") || "";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // --------------------------------------------
  // 🔥 RESET PASSWORD (HTTP CALL)
  // --------------------------------------------
  const reset = async () => {
    if (password.length < 6)
      return alert("Password must be at least 6 characters");

    try {
      const response = await fetch(
        "https://asia-south1-kapil-power-crm.cloudfunctions.net/resetUserPassword",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            newPassword: password.trim(),
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error(result);
        return alert("Failed to reset password: " + result.error);
      }

      alert("Password updated successfully!");
      window.location.href = "/";
    } catch (err) {
      console.error(err);
      alert("Failed to reset password (Network error)");
    }
  };

  return (
    <div style={styles.wrapper}>
      <h2 style={styles.title}>Reset Password</h2>

      <div style={styles.inputWrapper}>
        <input
          type={showPassword ? "text" : "password"}
          placeholder="Enter new password"
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <span style={styles.eye} onClick={() => setShowPassword(!showPassword)}>
          {showPassword ? "👁️" : "👁️‍🗨️"}
        </span>
      </div>

      <button onClick={reset} style={styles.button}>
        Reset Password
      </button>
    </div>
  );
}

const styles = {
  wrapper: {
    padding: 40,
    maxWidth: 420,
    margin: "60px auto",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 0 15px rgba(0,0,0,0.15)",
    textAlign: "center",
  },
  title: {
    marginBottom: 25,
    color: "#800000",
    fontSize: 28,
    fontWeight: "bold",
  },
  inputWrapper: {
    position: "relative",
    width: "100%",
    marginBottom: 20,
  },
  input: {
    width: "100%",
    height: "50px",
    padding: "0 45px 0 15px",
    borderRadius: 8,
    border: "1px solid #800000",
    fontSize: 16,
    boxSizing: "border-box",
  },
  eye: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    cursor: "pointer",
    fontSize: 20,
  },
  button: {
    width: "100%",
    height: "50px",
    background: "#800000",
    color: "#fff",
    fontSize: 16,
    borderRadius: 8,
    border: "none",
    fontWeight: "bold",
    cursor: "pointer",
  },
};
