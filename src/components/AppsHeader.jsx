// ✅ src/components/AppsHeader.jsx
import React from "react";
import kapilLogo from "../kapil-logo.png";

const AppsHeader = ({ onProfileClick, profileImageUrl }) => {
  const handleProfileClick = (e) => {
    e.stopPropagation();
    if (typeof onProfileClick === "function") {
      onProfileClick();
    }
  };
  return (
    <div
      style={{
        left: 0,
        right: 0,
        position: "fixed",
        top: 0,
        background: "linear-gradient(135deg, rgba(132, 12, 18, 0.94) 0%, rgba(98, 13, 84, 0.92) 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.16)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        height: "calc(74px + env(safe-area-inset-top, 0px))",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "calc(env(safe-area-inset-top, 0px) + 8px) 16px 8px",
        boxSizing: "border-box",
        // iOS touch tweaks
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        pointerEvents: "auto",
      }}
    >

      {/* MOBILE RESPONSIVE CSS */}
      <style>
        {`
          /* Prevent dragging/select on header elements for iOS */
          .app-header, .user-icon-box, .user-icon, .logo-icon, .logo-text {
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            touch-action: manipulation;
            -webkit-tap-highlight-color: rgba(0,0,0,0);
          }

          @media (max-width: 600px) {
            .app-header {
              height: 52px !important;
              padding: 0 8px !important;
              overflow-x: auto; /* allow horizontal if items overflow */
              -webkit-overflow-scrolling: touch;
            }
            .logo-text {
              font-size: 28px !important;
            }
            .logo-icon {
              width: 24px !important;
              height: 24px !important;
            }
            .user-icon-box {
              width: 44px !important;
              height: 44px !important;
            }
            .user-icon {
              font-size: 18px !important;
            }
          }
        `}
      </style>

      {/* LEFT SIDE */}
      <div
        className="app-header"
        style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}
      >
        <img
          className="logo-icon"
          src={kapilLogo}
          alt="Kapil Power"
          style={{
            width: "28px",
            height: "28px",
            objectFit: "contain",
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))",
          }}
        />

        <h2
          className="logo-text"
          style={{
            color: "white",
            fontSize: "30px",
            fontWeight: "800",
            margin: 0,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            letterSpacing: "0.2px",
          }}
        >
          Kapil Power CRM
        </h2>
      </div>

      {/* USER ICON */}
      <button
        type="button"
        onClick={handleProfileClick}
        onTouchEnd={handleProfileClick}
        className="user-icon-box"
        style={{
          width: "46px",
          height: "46px",
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.96)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          border: "1px solid rgba(255,255,255,0.7)",
          padding: 0,
          position: "relative",
          zIndex: 10000,
          pointerEvents: "auto",
        }}
        aria-label="Open profile menu"
      >
        {profileImageUrl ? (
          <img
            src={profileImageUrl}
            alt="Profile"
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        ) : (
          <span className="user-icon" style={{ fontSize: "22px", color: "#6c2eb9" }}>
            👤
          </span>
        )}
      </button>
    </div>
  );
};

export default AppsHeader;
