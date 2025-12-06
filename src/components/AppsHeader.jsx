// ✅ src/components/AppsHeader.jsx
import React from "react";

const AppsHeader = ({ onProfileClick }) => {
  return (
    <div
      style={{
        width: "100%",
        background: "#7a0000",
        height: "90px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 40px",
        boxSizing: "border-box",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 1000,
      }}
    >

      {/* MOBILE RESPONSIVE CSS */}
      <style>
        {`
          @media (max-width: 600px) {
            .app-header {
              height: 65px !important;
              padding: 0 18px !important;
            }
            .logo-text {
              font-size: 22px !important;
            }
            .logo-icon {
              font-size: 26px !important;
            }
            .user-icon-box {
              width: 40px !important;
              height: 40px !important;
            }
            .user-icon {
              font-size: 20px !important;
            }
          }
        `}
      </style>

      {/* LEFT SIDE */}
      <div
        className="app-header"
        style={{ display: "flex", alignItems: "center", gap: "14px" }}
      >
        <span className="logo-icon" style={{ fontSize: "34px", color: "gold" }}>
          ⚡
        </span>

        <h2
          className="logo-text"
          style={{
            color: "white",
            fontSize: "32px",
            fontWeight: "700",
            margin: 0,
          }}
        >
          Kapil Power CRM
        </h2>
      </div>

      {/* USER ICON */}
      <div
        onClick={onProfileClick}
        className="user-icon-box"
        style={{
          width: "55px",
          height: "55px",
          borderRadius: "50%",
          background: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 0 10px rgba(0,0,0,0.2)",
        }}
      >
        <span className="user-icon" style={{ fontSize: "28px", color: "#6c2eb9" }}>
          👤
        </span>
      </div>
    </div>
  );
};

export default AppsHeader;
