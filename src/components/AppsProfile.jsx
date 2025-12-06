import React from "react";

const AppsProfile = ({ user, onClose, onLogout }) => {
  return (
    <div
      className="profile-box"
      style={{
        position: "absolute",
        top: "70px",
        right: "30px",
        background: "white",
        borderRadius: "12px",
        padding: "20px",
        width: "260px",
        boxShadow: "0 8px 25px rgba(0,0,0,0.25)",
        zIndex: 100,
      }}
    >
      <style>
        {`
          @media (max-width: 600px) {
            .profile-box {
              top: 60px !important;
              right: 10px !important;
              width: 180px !important;
              padding: 15px !important;
            }
            .profile-box h3 {
              font-size: 16px !important;
            }
            .profile-box p {
              font-size: 13px !important;
            }
            .profile-box button {
              padding: 8px !important;
              font-size: 14px !important;
            }
          }
        `}
      </style>

      {/* NAME */}
      <h3 style={{ margin: 0, fontWeight: "bold", color: "#800000" }}>
        ● {user?.name || "User"}
      </h3>

      {/* EMAIL */}
      <p style={{ margin: "8px 0", color: "#333" }}>{user?.email}</p>

      {/* ROLE */}
      <p style={{ margin: "8px 0", color: "#555" }}>
        <strong>Role:</strong> {user?.role ?? "User"}
      </p>

      {/* LOGOUT */}
      <button
        onClick={onLogout}
        style={{
          width: "100%",
          marginTop: "15px",
          padding: "10px",
          borderRadius: "8px",
          border: "none",
          background: "#800000",
          color: "white",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        Logout
      </button>

      {/* CLOSE */}
      <button
        onClick={onClose}
        style={{
          width: "100%",
          marginTop: "10px",
          padding: "10px",
          borderRadius: "8px",
          border: "1px solid #800000",
          background: "white",
          color: "#800000",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        Cancel
      </button>
    </div>
  );
};

export default AppsProfile;
