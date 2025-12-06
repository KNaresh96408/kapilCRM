// src/components/TopNavbar.jsx
import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

import UniversalSearch from "./Universal/UniversalSearch";
import { FiSettings } from "react-icons/fi";

const TopNavbar = () => {
  const [userData, setUserData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return setUserData(null);

      try {
        const ref = doc(db, "Users", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) setUserData(snap.data());
        else setUserData({ email: user.email, role: "User", name: "" });
      } catch {
        setUserData({ email: user.email, role: "User", name: "" });
      }
    });

    return () => unsub();
  }, []);

  const linkStyle = {
    color: "white",
    textDecoration: "none",
    fontWeight: "600",
    fontSize: "16px",
    padding: "6px 10px",
  };

  const activeStyle = { fontWeight: "700", color: "white" };

  return (
    <nav
  style={{
    backgroundColor: "#800000",
    padding: "8px 28px",     // ⬆ more horizontal breathing
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 1000,
    height: "72px",           // ⬆ Increased navbar height
    boxShadow: "0 3px 8px rgba(0,0,0,0.25)",
  }}
>
      {/* LEFT — LOGO */}
      <h1
        style={{
          color: "white",
          fontWeight: "bold",
          fontSize: "20px",
          margin: 0,
        }}
      >
        ⚡ KP CRM
      </h1>

      {/* RIGHT SIDE */}
      <div
  style={{
    display: "flex",
    gap: "26px",              // ⬆ Increased gap between modules
    alignItems: "center",
  }}
>
        <NavLink to="/crm/home" style={({ isActive }) => (isActive ? activeStyle : linkStyle)}>
          Home
        </NavLink>

        <NavLink to="/crm/leads" style={({ isActive }) => (isActive ? activeStyle : linkStyle)}>
          Leads
        </NavLink>

        <NavLink to="/crm/deals" style={({ isActive }) => (isActive ? activeStyle : linkStyle)}>
          Deals
        </NavLink>

        <NavLink to="/crm/salesOrders" style={({ isActive }) => (isActive ? activeStyle : linkStyle)}>
          Orders
        </NavLink>

        <NavLink to="/crm/projects" style={({ isActive }) => (isActive ? activeStyle : linkStyle)}>
          Projects
        </NavLink>

        {/* SEARCH BOX */}
        <div 
  style={{
    width: "230px",          // ⬆ slightly wider
    maxWidth: "45vw",
    position: "relative",
    zIndex: 999,
    display: "flex",
    alignItems: "center",    // ⭐ keeps icon aligned
  }}
>
          <UniversalSearch
            onNavigate={(moduleApi, id) => {
              navigate(`/crm/${moduleApi}?open=${id}`);
            }}
          />
        </div>

        {/* SETTINGS ICON */}
        {userData?.role === "admin" && (
          <div
            onClick={() => navigate("/settings")}
            style={{ cursor: "pointer", color: "white" }}
            title="Settings"
          >
            <FiSettings size={20} />
          </div>
        )}

        {/* USER NAME */}
        <div style={{ color: "white", fontSize: "13px", marginLeft: "4px" }}>
          {userData ? `${userData.name || userData.email}` : "Loading..."}
        </div>
      </div>
    </nav>
  );
};

export default TopNavbar;
