// src/pages/VerifyOTP.jsx
import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";

export default function VerifyOTP() {
  const url = new URL(window.location.href);
  const email = url.searchParams.get("email") || "";

  const [otp, setOtp] = useState("");

  const verify = async () => {
    if (!otp) return alert("Enter OTP");

    try {
      const q = query(
        collection(db, "password_otps"),
        where("email", "==", email),
        where("otp", "==", otp),
        where("used", "==", false)
      );

      const snap = await getDocs(q);

      if (snap.empty) return alert("Invalid OTP");

      const docRef = doc(db, "password_otps", snap.docs[0].id);
      const data = snap.docs[0].data();

      if (data.expiresAt.toDate() < new Date())
        return alert("OTP expired");

      await updateDoc(docRef, { used: true });

      window.location.href = `/reset-password-final?email=${email}`;
    } catch (err) {
      console.error(err);
      alert("Error verifying OTP");
    }
  };

  return (
    <div style={styles.wrapper}>
      <h2 style={styles.title}>Verify OTP</h2>

      <input
        type="text"
        placeholder="Enter OTP"
        style={styles.input}
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
      />

      <button onClick={verify} style={styles.button}>
        Verify OTP
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
