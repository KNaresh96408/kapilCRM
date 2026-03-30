import { booksIcon } from "./booksIcons";
// ✅ src/components/AppSelect.jsx (UPDATED for mobile layout)
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebaseConfig";
import { signOut } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { useAuth } from "../context/AuthContext";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebaseConfig";

import AppsHeader from "./AppsHeader";
import AppsProfile from "./AppsProfile";

const BOOKS_ALLOWED_ROLES = new Set([
  "admin",
  "sales_head",
  "director",
  "dgm",
  "agm",
  "operations_manager",
  "operations_executive",
]);

const ORG_ALLOWED_ROLES = new Set([
  "admin",
  "sales_head",
  "director",
  "agm",
  "dgm",
  "hr_executive",
]);

const normalizeBelongsTo = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeRole = (role) => {
  const n = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  const compact = n.replace(/_/g, "");
  if (n === "finance" || n === "finance_manager" || n === "financemanager" || compact === "financemanager") return "dgm";
  if (n === "dgm" || compact === "dgm") return "dgm";
  if (n === "agm" || compact === "agm") return "agm";
  if (n === "saleshead" || compact === "saleshead") return "sales_head";
  if (n === "hrexecutive" || compact === "hrexecutive") return "hr_executive";
  if (n === "hroperationsmanager" || n === "hr_operations_manager" || compact === "hroperationsmanager") return "agm";
  if (["tele_sales", "tele_sale", "telecaller", "tele_caller"].includes(n) || compact === "telesales") return "telesales";
  return n;
};

const canonicalRole = (role) => {
  const n = normalizeRole(role);
  const compact = n.replace(/_/g, "");
  if (n === "saleshead" || compact === "saleshead") return "sales_head";
  if (n === "hroperationsmanager" || n === "hr_operations_manager" || compact === "hroperationsmanager") return "agm";
  if (n === "financemanager" || n === "finance_manager" || compact === "financemanager") return "dgm";
  if (n === "hrexecutive" || n === "hr_executive" || compact === "hrexecutive") return "hr_executive";
  if (["tele_sales", "tele_sale", "telecaller", "tele_caller"].includes(n) || compact === "telesales") return "telesales";
  if (n === "service_enginner" || compact === "serviceenginner") return "service_engineer";
  return n;
};

const isNotificationRead = (notification) => {
  const n = notification || {};
  const readRaw = n.read;
  const readNormalized = typeof readRaw === "string" ? readRaw.trim().toLowerCase() : readRaw;
  const explicitRead = readNormalized === true || readNormalized === "true" || readNormalized === 1 || readNormalized === "1";
  if (explicitRead) return true;

  const status = String(n.status || "").trim().toLowerCase();
  return status === "read" || status === "seen" || status === "resolved";
};

const AppIcon = ({ sources, alt }) => {
  const [index, setIndex] = useState(0);
  const currentSrc = sources[index] || sources[sources.length - 1];

  const handleError = () => {
    setIndex((prev) => (prev < sources.length - 1 ? prev + 1 : prev));
  };

  return (
    <div className="app-icon-shell">
      <img
        src={currentSrc}
        alt={alt}
        decoding="async"
        className="app-icon-img"
        onError={handleError}
      />
    </div>
  );
};

const AppSelect = () => {
  const navigate = useNavigate();
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const headerOffset = isMobile ? "104px" : "110px";

  const navLockRef = useRef(false);
  const handleNavigate = (path) => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    navigate(path);
    setTimeout(() => {
      navLockRef.current = false;
    }, 500);
  };

  const handleCardKeyDown = (path) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNavigate(path);
    }
  };

  const handlePressStart = (key) => (e) => {
    e.stopPropagation();
    setPressedCard(key);
  };

  const handlePressEnd = () => {
    setPressedCard(null);
  };

  const [userData, setUserData] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [unreadMailCount, setUnreadMailCount] = useState(0);
  const [pressedCard, setPressedCard] = useState(null);

  // Prefer AuthContext (fast + resilient). Fallback to localStorage if needed.
  const { user: ctxUser, roleData, clearSession } = useAuth();

  useEffect(() => {
    if (ctxUser) {
      setUserData(ctxUser);
      return;
    }
    const stored = localStorage.getItem("kp-user");
    if (stored) {
      try {
        setUserData(JSON.parse(stored));
      } catch {
        setUserData(null);
      }
    }
  }, [ctxUser]);

  const profileUser = {
    ...(userData || {}),
    ...(ctxUser || {}),
    email: (ctxUser && ctxUser.email) || (userData && (userData.email || userData.Email)) || "",
    name:
      (ctxUser && (ctxUser.name || ctxUser.Name || ctxUser.displayName)) ||
      (userData && (userData.name || userData.Name || userData.displayName)) ||
      "User",
    role:
      (ctxUser && (ctxUser.role || ctxUser.Role)) ||
      (roleData && roleData.role) ||
      (userData && (userData.role || userData.Role)) ||
      "User",
  };

  const sessionProfile = (() => {
    try {
      const stored = localStorage.getItem("kp-user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  })();

  const effectiveUid = String(
    profileUser?.uid || sessionProfile?.uid || sessionProfile?.id || sessionProfile?.profile?.uid || ""
  ).trim();

  const effectiveEmail = String(
    profileUser?.email ||
    sessionProfile?.email ||
    sessionProfile?.Email ||
    sessionProfile?.profile?.email ||
    sessionProfile?.profile?.Email ||
    ""
  ).trim().toLowerCase();

  const effectiveRole = canonicalRole(
    profileUser?.role ||
    profileUser?.Role ||
    sessionProfile?.role ||
    sessionProfile?.Role ||
    sessionProfile?.profile?.role ||
    sessionProfile?.profile?.Role ||
    ""
  );

  const canViewBooks = BOOKS_ALLOWED_ROLES.has(normalizeRole(profileUser?.role));
  const canViewOrganization = ORG_ALLOWED_ROLES.has(normalizeRole(profileUser?.role));
  const belongsTo = normalizeBelongsTo(profileUser?.belongsTo || profileUser?.belongs_to || profileUser?.team);
  const isOperationsTeam = belongsTo.includes("operations");
  const isServiceEngineer = effectiveRole === "service_engineer";
  const hideNonAttendanceApps = isOperationsTeam && !isServiceEngineer;

  useEffect(() => {
    if (!effectiveUid && !effectiveEmail && !effectiveRole) {
      setUnreadNotificationCount(0);
      return;
    }

    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let count = 0;
        snap.docs.forEach((d) => {
          const n = d.data() || {};
          if (n.active === false) return;
          if (isNotificationRead(n)) return;

          const toUserId = String(n.toUserId || n.toUid || "").trim();
          const toEmail = String(n.toEmail || "").trim().toLowerCase();
          const toRole = canonicalRole(n.toRole || "");
          const toEmails = Array.isArray(n.toEmails)
            ? n.toEmails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
            : [];

          const uidMatch = !!effectiveUid && !!toUserId && toUserId === effectiveUid;
          const emailMatch = !!effectiveEmail && ((!!toEmail && toEmail === effectiveEmail) || toEmails.includes(effectiveEmail));
          const roleMatch = !!effectiveRole && !!toRole && toRole === effectiveRole;

          if (uidMatch || emailMatch || roleMatch) count += 1;
        });

        setUnreadNotificationCount(count);
      },
      (err) => {
        console.warn("Notification badge listener failed", err?.message || err);
        setUnreadNotificationCount(0);
      }
    );

    return () => unsub();
  }, [effectiveUid, effectiveEmail, effectiveRole]);

  useEffect(() => {
    const uid = String(profileUser?.uid || "").trim();
    if (!uid) {
      setUnreadMailCount(0);
      return;
    }

    const q = query(
      collection(db, "mailboxes", uid, "messages"),
      where("folder", "==", "inbox"),
      where("isRead", "==", false),
      limit(300)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setUnreadMailCount(snap.size || 0);
      },
      (err) => {
        console.warn("Mail badge listener failed", err?.message || err);
        setUnreadMailCount(0);
      }
    );

    return () => unsub();
  }, [profileUser?.uid]);

  const logout = async () => {
    console.log("🔴 Logout clicked - starting logout process");

    // Prevent any re-renders by clearing immediately
    setShowProfile(false);

    // Clear session FIRST before any async operations
    console.log("🧹 Clearing localStorage");
    localStorage.clear();

    // Clear AuthContext
    if (typeof clearSession === "function") {
      console.log("🧹 Calling clearSession");
      clearSession();
    }

    // Sign out from Firebase (async, but don't wait)
    (async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          try {
            await FirebaseAuthentication.signOut();
            console.log("✅ Native signOut complete");
          } catch (nativeErr) {
            if (nativeErr?.code !== "UNIMPLEMENTED") {
              console.warn("Logout native error:", nativeErr);
            }
          }
        }

        try {
          await signOut(auth);
          console.log("✅ Web signOut complete");
        } catch (webErr) {
          console.warn("Logout web error:", webErr);
        }
      } catch (err) {
        console.warn("Logout error:", err);
      }
    })();

    // Navigate immediately (don't wait for Firebase)
    console.log("🔄 Navigating to /");

    // For HashRouter, we need to reload the app to clear state
    setTimeout(() => {
      console.log("🔄 Forcing full reload");
      window.location.href = window.location.origin + "/#/";
      // Fallback: force reload if hash change didn't trigger
      setTimeout(() => {
        window.location.reload();
      }, 200);
    }, 50);
  };

  const toggleProfile = () => {
    setShowProfile((prev) => !prev);
  };

  const profileImageUrl =
    (ctxUser && (ctxUser.profilePhotoPreview || ctxUser.profilePhotoUrl || ctxUser.profilePhoto || ctxUser.photoURL)) ||
    (userData && (userData.profilePhotoPreview || userData.profilePhotoUrl || userData.profilePhoto || userData.photoURL)) ||
    "";

  useEffect(() => {
    const preview =
      (ctxUser && ctxUser.profilePhotoPreview) ||
      (userData && userData.profilePhotoPreview) ||
      "";
    const url =
      (ctxUser && (ctxUser.profilePhotoUrl || ctxUser.profilePhoto || ctxUser.photoURL)) ||
      (userData && (userData.profilePhotoUrl || userData.profilePhoto || userData.photoURL)) ||
      "";
    const uid = (ctxUser && ctxUser.uid) || (userData && userData.uid) || "";

    if (!preview || !url || !uid) return;

    const img = new Image();
    img.onload = () => {
      try {
        const stored = localStorage.getItem("kp-user");
        const parsed = stored ? JSON.parse(stored) : null;
        if (parsed && parsed.uid === uid) {
          const next = { ...parsed };
          delete next.profilePhotoPreview;
          localStorage.setItem("kp-user", JSON.stringify(next));
          window.dispatchEvent(new CustomEvent("kp-login", { detail: next }));
        }
      } catch (e) {
        console.warn("Failed to clear profile preview", e);
      }
    };
    img.src = url;
  }, [ctxUser, userData]);

  const goToEditProfile = () => {
    setShowProfile(false);
    navigate("/organization?self=1&from=login");
  };

  return (
    <div
      style={{
        position: "relative",
        height: "100dvh",
        minHeight: "100dvh",
        width: "100%",
        overflowX: "hidden",
        overflowY: "auto",
        padding: "0",
        margin: "0",
        background: "radial-gradient(120% 85% at 20% 0%, #b41626 0%, #7e113d 40%, #4a0d62 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)",
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
          pointerEvents: "none",
        }}
      ></div>

      {/* HEADER */}
      <div style={{ zIndex: 9999, position: "relative", pointerEvents: "auto" }}>
        <AppsHeader onProfileClick={toggleProfile} profileImageUrl={profileImageUrl} />
      </div>

      {/* PROFILE DRAWER */}
      {showProfile && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 10000, pointerEvents: "none" }}>
          <div onClick={() => setShowProfile(false)} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "all" }}></div>
          <div style={{ pointerEvents: "all" }}>
            <AppsProfile
              user={profileUser}
              onClose={() => setShowProfile(false)}
              onLogout={logout}
              onEditProfile={goToEditProfile}
            />
          </div>
        </div>
      )}

      {/* SPACER FOR FIXED HEADER */}
      <div style={{ height: headerOffset, flexShrink: 0 }} />

      {/* CARDS WRAPPER */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          flex: 1,
          width: "100%",
          display: "flex",
          alignItems: isMobile ? "flex-end" : "center",
          justifyContent: isMobile ? "flex-end" : "center",
          padding: isMobile ? "0 6px 22px" : "10px 12px 24px",
          boxSizing: "border-box",
        }}
      >
      <div
        className="app-grid"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: isMobile ? "calc(100% - 8px)" : "min(1420px, calc(100% - 20px))",
          zIndex: 2,
          flexWrap: "nowrap",
          flex: "0 0 auto",
          overflowX: "auto",
          overflowY: "hidden",
          alignSelf: "center",
          marginTop: 0,
          background: "linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: isMobile ? 18 : 24,
          boxShadow: "0 10px 28px rgba(32, 6, 36, 0.18)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        {/* CRM CARD */}
        {!hideNonAttendanceApps && !isServiceEngineer && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/crm/home")}
            onPointerDown={handlePressStart("crm")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("crm")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/crm/home")}
            className={`app-card ${pressedCard === "crm" ? "is-pressed" : ""}`}
          >
            <AppIcon sources={["/icons/crm.png"]} alt="CRM" />
            <p className="app-label">CRM</p>
          </div>
        )}

        {/* ATTENDANCE CARD */}
        <div
          role="button"
          tabIndex={0}
          onKeyDown={handleCardKeyDown("/attendance")}
          onPointerDown={handlePressStart("attendance")}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onPointerCancel={handlePressEnd}
          onTouchStart={handlePressStart("attendance")}
          onTouchEnd={handlePressEnd}
          onClick={() => handleNavigate("/attendance")}
          className={`app-card ${pressedCard === "attendance" ? "is-pressed" : ""}`}
        >
          <AppIcon sources={["/icons/attendance.png"]} alt="Attendance" />
          <p className="app-label">Attendance</p>
        </div>

        {/* BOOKS CARD */}
        {canViewBooks && !isServiceEngineer && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/books")}
            onPointerDown={handlePressStart("books")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("books")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/books")}
            className={`app-card ${pressedCard === "books" ? "is-pressed" : ""}`}
          >
            <AppIcon sources={[booksIcon]} alt="Books" />
            <p className="app-label">Books</p>
          </div>
        )}

        {/* ORGANIZATION CARD */}
        {canViewOrganization && !hideNonAttendanceApps && !isServiceEngineer && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/organization")}
            onPointerDown={handlePressStart("organization")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("organization")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/organization")}
            className={`app-card ${pressedCard === "organization" ? "is-pressed" : ""}`}
          >
            <AppIcon
              sources={["/icons/organization.png", "/icons/organization.svg", "/icons/crm.png"]}
              alt="Organization"
            />
            <p className="app-label">Organization</p>
          </div>
        )}

        {!hideNonAttendanceApps && !isServiceEngineer && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/notifications")}
            onPointerDown={handlePressStart("notifications")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("notifications")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/notifications")}
            className={`app-card ${pressedCard === "notifications" ? "is-pressed" : ""}`}
          >
            {unreadNotificationCount > 0 && (
              <span className="notification-badge" aria-label={`${unreadNotificationCount} unread notifications`}>
                {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
              </span>
            )}
            <AppIcon
              sources={["/icons/Notifications.jpeg", "/icons/crm.png"]}
              alt="Notifications"
            />
            <p className="app-label">Notifications</p>
          </div>
        )}

        {!hideNonAttendanceApps && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/crm/meetings")}
            onPointerDown={handlePressStart("meetings")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("meetings")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/crm/meetings")}
            className={`app-card ${pressedCard === "meetings" ? "is-pressed" : ""}`}
          >
            <AppIcon
              sources={["/icons/meetings.svg", "/icons/attendance.png", "/icons/crm.png"]}
              alt="Meetings"
            />
            <p className="app-label">Meetings</p>
          </div>
        )}

        {!hideNonAttendanceApps && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/mail")}
            onPointerDown={handlePressStart("mail")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("mail")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/mail")}
            className={`app-card ${pressedCard === "mail" ? "is-pressed" : ""}`}
          >
            {unreadMailCount > 0 && (
              <span className="notification-badge" aria-label={`${unreadMailCount} unread mails`}>
                {unreadMailCount > 99 ? "99+" : unreadMailCount}
              </span>
            )}
            <AppIcon
              sources={["/icons/mail.svg", "/icons/attachments.svg", "/icons/crm.png"]}
              alt="Mail"
            />
            <p className="app-label">Mail</p>
          </div>
        )}

        {/* ATTACHMENTS CARD (keep last) */}
        {!hideNonAttendanceApps && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleCardKeyDown("/crm/attachments")}
            onPointerDown={handlePressStart("attachments")}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onTouchStart={handlePressStart("attachments")}
            onTouchEnd={handlePressEnd}
            onClick={() => handleNavigate("/crm/attachments")}
            className={`app-card ${pressedCard === "attachments" ? "is-pressed" : ""}`}
          >
            <AppIcon
              sources={["/icons/attachments.svg", "/icons/attachments.png", "/icons/crm.png"]}
              alt="Attachments"
            />
            <p className="app-label">Attachments</p>
          </div>
        )}
      </div>
      </div>

      {/* 📱 EXTRA MOBILE CSS */}
      <style>{`
        .app-grid {
          gap: 14px;
          margin-top: 0;
          padding: 18px 28px;
          white-space: nowrap;
          scroll-behavior: smooth;
        }

        .app-card {
          width: clamp(108px, 10vw, 132px);
          min-height: clamp(94px, 9vw, 116px);
          border: 1px solid rgba(255,255,255,0.28);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 10px 8px;
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
          background: linear-gradient(165deg, #fffefe 0%, #fff9fb 62%, #fff3f7 100%);
          box-shadow: 0 8px 18px rgba(28, 8, 26, 0.2);
          margin-bottom: 0;
          gap: 7px;
          position: relative;
          overflow: hidden;
          flex: 0 0 auto;
        }

        .app-card.is-pressed,
        .app-card:active {
          transform: translateY(-1px) scale(0.985);
          box-shadow: 0 8px 14px rgba(28, 8, 26, 0.18);
          border-color: rgba(128,0,0,0.45);
        }

        .app-card::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
          pointer-events: none;
        }

        .notification-badge {
          position: absolute;
          top: 10px;
          right: 10px;
          min-width: 22px;
          height: 22px;
          border-radius: 999px;
          background: #e11d48;
          color: #fff;
          border: 2px solid #fff;
          font-size: 11px;
          line-height: 18px;
          font-weight: 800;
          text-align: center;
          padding: 0 4px;
          box-shadow: 0 6px 12px rgba(225, 29, 72, 0.32);
          z-index: 3;
        }

        .app-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 20px rgba(22, 4, 26, 0.26);
          border-color: rgba(128,0,0,0.35);
        }

        .app-icon-shell {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: linear-gradient(145deg, #95101a 0%, #73124a 54%, #5f1380 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 7px 12px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.3);
          position: relative;
        }

        .app-icon-shell::after {
          content: "";
          position: absolute;
          inset: 2px;
          border-radius: 14px;
          box-shadow: inset 0 1px 8px rgba(255,255,255,0.12);
          pointer-events: none;
        }

        .app-icon-img {
          width: 18px;
          height: 18px;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18));
        }

        .app-label {
          margin: 0;
          font-size: 12px;
          color: #7a0f1a;
          font-weight: 700;
          letter-spacing: 0.2px;
          text-align: center;
          padding: 0 4px;
          line-height: 1.2;
        }

        @media (max-width: 768px) {
          h1 {
            margin-top: 60px !important;
            font-size: 26px !important;
          }

          .app-grid {
            display: flex;
            justify-content: flex-start;
            gap: 10px;
            margin-top: 0;
            padding: 16px 14px;
          }

          .app-card {
            width: clamp(76px, 21vw, 92px);
            min-height: clamp(66px, 18vw, 82px);
            border-radius: 10px;
            padding: 6px 4px;
            gap: 4px;
            margin-bottom: 0;
          }

          .app-icon-shell {
            width: 24px;
            height: 24px;
            border-radius: 6px;
          }

          .app-icon-img {
            width: 13px;
            height: 13px;
          }

          .app-label {
            font-size: 10px;
            line-height: 1.2;
          }
        }

        @media (max-width: 480px) {
          h1 {
            margin-top: 54px !important;
            font-size: 22px !important;
          }

          .app-grid {
            display: flex;
            justify-content: flex-start;
            gap: 9px;
            margin-top: 0;
            padding: 14px 12px;
          }

          .app-card {
            width: clamp(74px, 23vw, 88px);
            min-height: clamp(64px, 19vw, 78px);
            border-radius: 10px;
            padding: 6px 4px;
            gap: 3px;
            margin-bottom: 0;
          }

          .app-icon-shell {
            width: 22px;
            height: 22px;
            border-radius: 6px;
          }

          .app-icon-img {
            width: 12px;
            height: 12px;
          }

          .app-label {
            font-size: 9px;
          }

          .notification-badge {
            top: 6px;
            right: 6px;
            min-width: 18px;
            height: 18px;
            font-size: 10px;
            line-height: 14px;
          }
        }
      `}</style>
    </div>
  );
};

export default AppSelect;
