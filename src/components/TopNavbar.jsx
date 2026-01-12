// src/components/TopNavbar.jsx
import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

import UniversalSearch from "./Universal/UniversalSearch";
import { FiSettings } from "react-icons/fi";

const TopNavbar = () => {
  const [userData, setUserData] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  
  const isMobile = window.innerWidth < 768;

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
  const analyticsRef = React.useRef(null);

useEffect(() => {
  function handleClickOutside(e) {
    if (analyticsRef.current && !analyticsRef.current.contains(e.target)) {
      setShowAnalytics(false);
    }
  }

  document.addEventListener("mousedown", handleClickOutside);
  document.addEventListener("touchstart", handleClickOutside);

  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("touchstart", handleClickOutside);
  };
}, []);

useEffect(() => {
  setShowAnalytics(false);
}, [location.pathname]);



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
    fontFamily: "Inter, Segoe UI, Roboto, Arial",
   padding: isMobile ? "8px 12px" : "8px 28px",   // ⬆ more horizontal breathing
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

    // ⭐ IMPORTANT FIX
    display: "flex",
    alignItems: "center",
    whiteSpace: "nowrap",
    flexShrink: 0,
  }}
>
  ⚡ KP CRM
</h1>

{/* RIGHT SIDE */}
<div
  style={{
    display: "flex",
    gap: "26px",
    alignItems: "center",
    overflowX: isMobile ? "auto" : "visible",
    whiteSpace: isMobile ? "nowrap" : "normal",
    WebkitOverflowScrolling: "touch",
    flexWrap: "nowrap",
    paddingBottom: isMobile ? "4px" : "0",
    position: "relative",
    zIndex: 5000,
    touchAction: "manipulation",   // ⭐ add this
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
{/* ANALYTICS DROPDOWN */}
<div
  ref={analyticsRef}
  style={{ position: "relative" }}
>
  <span
  style={{ ...linkStyle, cursor: "pointer" }}
  onPointerDown={() => setShowAnalytics(prev => !prev)}
>
  Analytics ▾
</span>

  {showAnalytics && (
  <div
    style={{
      position: "absolute",
      top: "36px",
      left: 0,
      width: "240px",
      background: "white",
      borderRadius: "12px",
      padding: "10px 8px",
      boxShadow: "0 12px 25px rgba(0,0,0,0.25)",
      zIndex: 3000,
    }}
  >
    <NavLink
      to="/crm/analytics/sales"
      onClick={() => setShowAnalytics(false)}
      style={{ display: "block", padding: "10px", borderRadius: "8px", textDecoration: "none", color: "#333" }}
    >
      Sales Dashboard
    </NavLink>

    <NavLink
      to="/crm/analytics/performance"
      onClick={() => setShowAnalytics(false)}
      style={{ display: "block", padding: "10px", borderRadius: "8px", textDecoration: "none", color: "#333" }}
    >
      Performance Dashboard
    </NavLink>

    <NavLink
      to="/crm/analytics/payment-tracker"
      onClick={() => setShowAnalytics(false)}
      style={{ display: "block", padding: "10px", borderRadius: "8px", textDecoration: "none", color: "#333" }}
    >
      Payment Tracker
    </NavLink>

    <NavLink
      to="/crm/analytics/operations"
      onClick={() => setShowAnalytics(false)}
      style={{ display: "block", padding: "10px", borderRadius: "8px", textDecoration: "none", color: "#333" }}
    >
      Operations Dashboard
    </NavLink>
  </div>
)}
</div>

        {/* SEARCH BOX */}
        {/* SEARCH BOX — HIDE ON HOME */}
{location.pathname !== "/crm/home" && (
  <div 
    style={{
      width: "230px",
      maxWidth: "45vw",
      position: "relative",
      zIndex: 999,
      display: "flex",
      alignItems: "center",
    }}
  >
    <UniversalSearch
      onNavigate={(moduleApi, id) => {
        navigate(`/crm/${moduleApi}?open=${id}`);
      }}
    />
  </div>
)}

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
