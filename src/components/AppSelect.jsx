// ✅ src/components/AppSelect.jsx (UPDATED for mobile layout)
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { signOut } from "firebase/auth";

import AppsHeader from "./AppsHeader";
import AppsProfile from "./AppsProfile";

const AppSelect = () => {
  const navigate = useNavigate();

  const [userData, setUserData] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  // 📱 detect mobile width
  const isMobile = window.innerWidth < 768;

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.log("No Firebase user logged in");
        return;
      }

      console.log("Firebase user logged in:", user.uid);

      const userRef = doc(db, "Users", user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        setUserData(snap.data());
      }
    });

    return () => unsubscribe();
  }, []);


const logout = async () => {
  try {
    const auth = getAuth();
    await signOut(auth); // Firebase session logout

    localStorage.removeItem("kp-user"); // clear local storage
    navigate("/"); // redirect to login page
  } catch (error) {
    console.error("Logout error:", error);
  }
};

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        padding: "0",
        margin: "0",
        background: "linear-gradient(135deg, #991013 0%, #4b0f63 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* 🌊 WAVES BACKGROUND */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundImage: "url('/waves.svg')",
          backgroundSize: "cover",
          opacity: 0.25,
          zIndex: 0,
        }}
      ></div>

      {/* HEADER */}
      <div style={{ zIndex: 2 }}>
        <AppsHeader onProfileClick={() => setShowProfile(true)} />
      </div>

      {/* PROFILE DRAWER */}
      {showProfile && userData && (
        <div style={{ zIndex: 10 }}>
          <AppsProfile
            user={userData}
            onClose={() => setShowProfile(false)}
            onLogout={logout}
          />
        </div>
      )}

      {/* TITLE */}
      <h1
        style={{
          marginTop: isMobile ? "70px" : "120px", // moved down in mobile
          fontSize: isMobile ? "28px" : "40px",
          color: "white",
          fontWeight: "bold",
          zIndex: 2,
          textAlign: "center",
        }}
      >
        Select Application
      </h1>

      {/* CARDS WRAPPER */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: isMobile ? "40px" : "120px", // smaller gap on mobile
          marginTop: isMobile ? "40px" : "80px",
          width: "100%",
          zIndex: 2,
          flexWrap: "wrap",
        }}
      >
        {/* CRM CARD */}
        <div
          onClick={() => navigate("/crm/home")}
          style={{
            width: isMobile ? "170px" : "230px",
            height: isMobile ? "170px" : "230px",
            border: "2px solid #800000",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            cursor: "pointer",
            transition: "0.2s",
            background: "white",
            marginBottom: "40px",
          }}
        >
          <img
            src="/icons/crm.png"
            alt="CRM"
            width={isMobile ? 80 : 110} // icon smaller on mobile
          />
          <p
            style={{
              marginTop: "15px",
              fontSize: isMobile ? "18px" : "22px",
              color: "#800000",
              fontWeight: "600",
            }}
          >
            CRM
          </p>
        </div>

        {/* ATTENDANCE CARD */}
        <div
          onClick={() => navigate("/attendance")}
          style={{
            width: isMobile ? "170px" : "230px",
            height: isMobile ? "170px" : "230px",
            border: "2px solid #800000",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            cursor: "pointer",
            transition: "0.2s",
            background: "white",
            marginBottom: "40px",
          }}
        >
          <img
            src="/icons/attendance.png"
            alt="Attendance"
            width={isMobile ? 80 : 110}
          />
          <p
            style={{
              marginTop: "15px",
              fontSize: isMobile ? "18px" : "22px",
              color: "#800000",
              fontWeight: "600",
            }}
          >
            Attendance
          </p>
        </div>
      </div>

      {/* 📱 EXTRA MOBILE CSS */}
      <style>{`
        @media (max-width: 768px) {
          h1 {
            margin-top: 70px !important;
            font-size: 28px !important;
          }
        }

        @media (max-width: 480px) {
          h1 {
            margin-top: 60px !important;
            font-size: 24px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AppSelect;
