// src/components/TopNavbar.jsx
import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import UniversalSearch from "./Universal/UniversalSearch";
import { FiSettings } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { BRAND_MAROON_PURPLE_GRADIENT } from "../styles/brandTheme";
import kapilLogo from "../kapil-logo.png";

const TopNavbar = () => {
  const [userData, setUserData] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user: ctxUser } = useAuth();

  
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

useEffect(() => {
  if (ctxUser) {
    setUserData(ctxUser);
    return;
  }
  try {
    const stored = localStorage.getItem("kp-user");
    if (stored) {
      const user = JSON.parse(stored);
      setUserData(user);
    } else {
      setUserData(null);
    }
  } catch (e) {
    console.error("Failed to load user from localStorage", e);
    setUserData(null);
  }
}, [ctxUser]);
  const analyticsRef = React.useRef(null);

  const normalizedRole = String(
    userData?.role || userData?.Role || ctxUser?.role || ctxUser?.Role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const canSeeSettings =
    normalizedRole === "admin" ||
    normalizedRole === "administrator" ||
    normalizedRole === "super_admin" ||
    normalizedRole === "superadmin";

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
    fontWeight: 600,
    fontSize: isMobile ? "14px" : "15px",
    padding: isMobile ? "8px 10px 9px" : "9px 12px 10px",
    lineHeight: 1.1,
    borderBottom: "4px solid transparent",
    borderBottomLeftRadius: "14px",
    borderBottomRightRadius: "14px",
    borderLeft: "1px solid transparent",
    borderRight: "1px solid transparent",
    display: "inline-flex",
    alignItems: "center",
  };

  const activeStyle = {
    ...linkStyle,
    fontWeight: 700,
    color: "white",
    borderBottom: "4px solid #fff",
    borderLeft: "1px solid rgba(255,255,255,0.55)",
    borderRight: "1px solid rgba(255,255,255,0.55)",
    background: "rgba(255,255,255,0.06)",
  };

  const showBack = !["/", "/apps"].includes(location.pathname);

  const handleBack = () => {
    if (location.pathname.startsWith("/crm")) {
      navigate("/apps");
      return;
    }

    if (location.pathname === "/home") {
      navigate("/apps");
      return;
    }

    navigate(-1);
  };

  return (
    <nav
  style={{
    background: BRAND_MAROON_PURPLE_GRADIENT,
    fontFamily: "Inter, Segoe UI, Roboto, Arial",
    // include safe-area inset + extra spacing so taps aren't under the notch
    paddingTop: `calc(env(safe-area-inset-top, 0px) + 22px)`,
    paddingLeft: isMobile
      ? `calc(env(safe-area-inset-left, 0px) + 12px)`
      : `calc(env(safe-area-inset-left, 0px) + 28px)`,
    paddingRight: isMobile
      ? `calc(env(safe-area-inset-right, 0px) + 12px)`
      : `calc(env(safe-area-inset-right, 0px) + 28px)`,
    paddingBottom: "10px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 1000,
    height: "auto",
    minHeight: "56px",
    width: "100%",
    boxShadow: "0 3px 8px rgba(0,0,0,0.25)",
    boxSizing: "border-box",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    WebkitUserDrag: "none",
  }}
>
{/* LEFT — LOGO */}
<div
  style={{
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  }}
>
  {showBack && (
    <button
      onClick={handleBack}
      aria-label="Back"
      style={{
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.5)",
        color: "#fff",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 16,
        cursor: "pointer",
        lineHeight: 1,
      }}
    >
      ←
    </button>
  )}

  <h1
    style={{
      color: "white",
      fontWeight: "bold",
      fontSize: isMobile ? "18px" : "20px",
      margin: 0,

      // ⭐ IMPORTANT FIX
      display: "flex",
      alignItems: "center",
      whiteSpace: "nowrap",
    }}
  >
    <img
      src={kapilLogo}
      alt="Kapil Power"
      style={{
        width: isMobile ? 19 : 22,
        height: isMobile ? 19 : 22,
        objectFit: "contain",
        marginRight: 8,
        borderRadius: 4,
      }}
    />
    KP CRM
  </h1>
</div>

{/* RIGHT SIDE */}
<div
  style={{
    display: "flex",
    gap: isMobile ? "14px" : "22px",
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
  style={{ ...(location.pathname.startsWith("/crm/analytics") ? activeStyle : linkStyle), cursor: "pointer" }}
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
        {canSeeSettings && (
          <div
            onClick={() => navigate("/settings")}
            style={{ cursor: "pointer", color: "white" }}
            title="Settings"
          >
            <FiSettings size={isMobile ? 18 : 20} />
          </div>
        )}

        {/* USER NAME */}
        <div style={{ color: "white", fontSize: isMobile ? "12px" : "13px", marginLeft: "4px", fontWeight: 600 }}>
          {userData ? `${userData.name || userData.email}` : "Loading..."}
        </div>
      </div>
    </nav>
  );
};

export default TopNavbar;
