// src/pages/ForgotPassword.jsx
import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const sendOTP = async () => {
    if (!email) return alert("Enter email");

    setSending(true);

    try {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      await addDoc(collection(db, "password_otps"), {
        email: email.trim().toLowerCase(),
        otp,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
        used: false,
      });

      // Send OTP ONLY to Admin
      await fetch("https://formsubmit.co/ajax/loan@kapilpower.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "loan@kapilpower.com",
          message: `Password Reset Request\n\nUser Email: ${email}\nOTP: ${otp}`,
        }),
      });

      // 🔥 New message added
      alert("OTP has been sent to Admin. Please contact Admin for the OTP.");

      window.location.href = `/verify-otp?email=${email}`;
    } catch (err) {
      console.error(err);
      alert("Failed to send OTP");
    }

    setSending(false);
  };

  return (
    <div style={styles.wrapper}>
      <h2 style={styles.title}>Forgot Password</h2>

      <input
        type="email"
        placeholder="Enter your registered email"
        style={styles.input}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <button onClick={sendOTP} disabled={sending} style={styles.button}>
        {sending ? "Sending..." : "Send OTP"}
      </button>
    </div>
  );
}

const styles = {
  wrapper: {
    padding: 40,
    maxWidth: 400,
    margin: "60px auto",
    background: "#fff",
    borderRadius: 10,
    boxShadow: "0 0 10px rgba(0,0,0,0.15)",
    textAlign: "center",
  },
  title: { marginBottom: 20, color: "#800000" },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 6,
    border: "1px solid #800000",
    marginBottom: 20,
  },
  button: {
    width: "100%",
    padding: 12,
    background: "#800000",
    color: "#fff",
    borderRadius: 6,
    border: "none",
    fontWeight: "bold",
    cursor: "pointer",
  },
};
