import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import UpdateSiteVisitModal from "../components/UpdateSiteVisitModal";
import { BRAND_MAROON_PURPLE_GRADIENT } from "../styles/brandTheme";

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const roleAlias = {
  saleshead: "sales_head",
  hroperationsmanager: "agm",
  hr_operations_manager: "agm",
  financemanager: "dgm",
  finance_manager: "dgm",
  hrexecutive: "hr_executive",
  tele_sales: "telesales",
  tele_sale: "telesales",
  telecaller: "telesales",
  tele_caller: "telesales",
};

const canonicalRole = (value) => {
  const normalized = normalizeRole(value);
  if (!normalized) return "";
  const compact = normalized.replace(/_/g, "");
  return roleAlias[normalized] || roleAlias[compact] || normalized;
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

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const normalizeSurveyLink = (rawUrl = "") => {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";

  return raw
    .replace("https://crm.kapilpower.com/site-survey/", "https://crm.kapilpower.com/#/site-survey/");
};

const toAbsoluteAppLink = (rawValue = "") => {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;

  const origin = typeof window !== "undefined" ? window.location.origin : "https://crm.kapilpower.com";
  if (value.startsWith("#/")) return `${origin}/${value}`;
  if (value.startsWith("/")) return `${origin}/#${value}`;
  return `${origin}/#/${value.replace(/^\/+/, "")}`;
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user, roleData } = useAuth();
  const [rows, setRows] = useState([]);
  const [removingId, setRemovingId] = useState("");
  const [dealById, setDealById] = useState({});
  const [selectedDealForUpdate, setSelectedDealForUpdate] = useState(null);
  const [selectedNotificationId, setSelectedNotificationId] = useState("");

  const sessionUser = (() => {
    try {
      const raw = localStorage.getItem("kp-user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const uid = String(user?.uid || sessionUser?.uid || sessionUser?.id || "").trim();
  const email = String(user?.email || sessionUser?.email || sessionUser?.Email || "").trim().toLowerCase();

  const sessionRole = (() => {
    try {
      return sessionUser?.role || sessionUser?.Role || sessionUser?.profile?.role || sessionUser?.profile?.Role || "";
    } catch {
      return "";
    }
  })();

  const myRole = canonicalRole(roleData?.role || user?.role || user?.Role || sessionRole);

  const resolveDeal = async (referenceId) => {
    const refId = String(referenceId || "").trim();
    if (!refId) return null;

    try {
      const byDoc = await getDoc(doc(db, "deals", refId));
      if (byDoc.exists()) return { id: byDoc.id, ...(byDoc.data() || {}) };
    } catch {
      // continue fallback
    }

    try {
      const byAuto = await getDocs(query(collection(db, "deals"), where("autoId", "==", refId), limit(1)));
      if (!byAuto.empty) {
        const d = byAuto.docs[0];
        return { id: d.id, ...(d.data() || {}) };
      }
    } catch {
      // continue fallback
    }

    try {
      const byKpi = await getDocs(query(collection(db, "deals"), where("kpiId", "==", refId), limit(1)));
      if (!byKpi.empty) {
        const d = byKpi.docs[0];
        return { id: d.id, ...(d.data() || {}) };
      }
    } catch {
      // ignore
    }

    return null;
  };

  useEffect(() => {
    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
      },
      (err) => {
        console.warn("Notifications list failed:", err?.message || err);
      }
    );

    return () => unsub();
  }, []);

  const visibleRows = useMemo(() => {
    const sorted = (rows || [])
      .filter((n) => n.active !== false)
      .filter((n) => String(n.type || "").trim().toLowerCase() !== "meeting_maintenance_alert")
      .filter((n) => {
        const toUserId = String(n.toUserId || n.toUid || "").trim();
        const toEmail = String(n.toEmail || "").trim().toLowerCase();
        const toRole = canonicalRole(n.toRole || "");
        const toEmails = Array.isArray(n.toEmails)
          ? n.toEmails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
          : [];

        const uidMatch = !!uid && !!toUserId && toUserId === uid;
        const emailMatch = !!email && (!!toEmail && toEmail === email || toEmails.includes(email));
        const roleMatch = !!myRole && !!toRole && toRole === myRole;

        return uidMatch || emailMatch || roleMatch;
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    // Keep at most 2 repeated notifications with the same signature
    // to avoid noisy triples for the same event.
    const bucketCount = new Map();
    return sorted.filter((n) => {
      const type = String(n.type || "notification").trim().toLowerCase();
      const ref = String(n.referenceId || n.dealId || "").trim();
      const title = String(n.title || n.subject || "").trim().toLowerCase();
      const body = String(n.message || n.body || "").trim().toLowerCase();
      const owner = String(n.toUserId || n.toUid || n.toRole || "").trim().toLowerCase();
      const key = `${type}__${ref}__${owner}__${title}__${body}`;
      const nextCount = (bucketCount.get(key) || 0) + 1;
      bucketCount.set(key, nextCount);
      return nextCount <= 2;
    });
  }, [rows, uid, email, myRole]);

  const unreadRows = useMemo(
    () => visibleRows.filter((n) => !isNotificationRead(n)),
    [visibleRows]
  );

  useEffect(() => {
    let active = true;

    const run = async () => {
      const ids = Array.from(
        new Set(
          visibleRows
            .filter((n) => String(n.type || "").trim().toLowerCase() === "site_survey_link")
            .map((n) => String(n.dealId || n.referenceId || "").trim())
            .filter(Boolean)
        )
      );

      if (!ids.length) return;

      const entries = await Promise.all(
        ids.map(async (id) => {
          const deal = await resolveDeal(id);
          return [id, deal];
        })
      );

      if (!active) return;
      setDealById((prev) => {
        const next = { ...prev };
        entries.forEach(([id, deal]) => {
          if (deal) next[id] = deal;
        });
        return next;
      });
    };

    run();
    return () => {
      active = false;
    };
  }, [visibleRows]);

  const hasSiteVisitUpdate = (deal) => {
    const status = String(deal?.siteVisitStatus || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, " ");
    return ["completed", "not interested", "rescheduled", "reschedule"].includes(status);
  };

  const canRemoveNotification = (notification) => {
    if (!notification) return false;

    const type = String(notification.type || "").trim().toLowerCase();
    if (type === "site_survey_link") {
      if (!isNotificationRead(notification)) return false;
      const deal = dealById[String(notification.dealId || notification.referenceId || "").trim()];
      return hasSiteVisitUpdate(deal);
    }

    return true;
  };

  const getSurveyLink = (notification) => {
    const dealId = String(notification?.dealId || notification?.referenceId || "").trim();
    const linkedDeal = dealId ? dealById[dealId] : null;
    const directLinkRaw = String(
      notification?.surveyLink || notification?.link || notification?.url || ""
    ).trim();
    const directLink = normalizeSurveyLink(directLinkRaw);

    if (directLink) return directLink;
    if (linkedDeal?.id && linkedDeal?.siteSurveyToken) {
      return `https://crm.kapilpower.com/#/site-survey/start/${linkedDeal.id}/${linkedDeal.siteSurveyToken}`;
    }
    return "";
  };

  const getNotificationLink = (notification) => {
    const type = String(notification?.type || "").trim().toLowerCase();

    if (type === "meeting_invite" || type === "meeting_reminder") {
      const meetingId = String(notification?.referenceId || "").trim();
      if (meetingId) {
        return toAbsoluteAppLink(`/crm/meetings?join=${encodeURIComponent(meetingId)}`);
      }
    }

    if (type === "site_survey_link") {
      return getSurveyLink(notification);
    }

    const direct = String(notification?.link || notification?.url || notification?.route || "").trim();
    return toAbsoluteAppLink(direct);
  };

  const openUpdateSiteVisit = (notification) => {
    const dealId = String(notification?.dealId || notification?.referenceId || "").trim();
    if (!dealId) {
      alert("Deal reference missing for this notification.");
      return;
    }

    const deal = dealById[dealId] || null;
    setSelectedDealForUpdate({
      id: deal?.id || dealId,
      autoId: deal?.autoId || deal?.kpiId || notification?.dealId || dealId,
      assignedConsultant: deal?.assignedConsultant || notification?.assignedTo || "",
      ...deal,
    });
    setSelectedNotificationId(notification?.id || "");
  };

  const handleSiteVisitSaved = async (payload = {}) => {
    const resolvedId = String(payload?.resolvedId || "").trim();
    const notificationDealId = String(payload?.notificationDealId || "").trim();
    const siteVisitStatus = String(payload?.siteVisitStatus || "").trim();

    const optimisticKeys = Array.from(new Set([notificationDealId, resolvedId].filter(Boolean)));
    if (optimisticKeys.length && siteVisitStatus) {
      setDealById((prev) => {
        const next = { ...prev };
        optimisticKeys.forEach((k) => {
          next[k] = {
            ...(next[k] || {}),
            siteVisitStatus,
          };
        });
        return next;
      });
    }

    const lookupId = notificationDealId || resolvedId;
    if (!lookupId) return;

    try {
      const deal = await resolveDeal(lookupId);
      if (!deal) return;

      setDealById((prev) => ({
        ...prev,
        [lookupId]: deal,
        ...(resolvedId ? { [resolvedId]: deal } : {}),
        ...(notificationDealId ? { [notificationDealId]: deal } : {}),
      }));
    } catch (e) {
      console.warn("Failed to refresh deal status", e?.message || e);
    }
  };

  useEffect(() => {
    if (!unreadRows.length) return;

    const markSeen = async () => {
      try {
        const batch = writeBatch(db);
        unreadRows.forEach((n) => {
          batch.update(doc(db, "notifications", n.id), {
            read: true,
            readAt: serverTimestamp(),
            seenAt: serverTimestamp(),
          });
        });
        await batch.commit();
      } catch (e) {
        console.warn("Failed to mark notifications as read", e?.message || e);
      }
    };

    markSeen();
  }, [unreadRows]);

  const handleRemove = async (notification) => {
    const id = String(notification?.id || "").trim();
    if (!id || removingId) return;
    if (!canRemoveNotification(notification)) {
      alert("You can remove this notification only after reading it. For site visit, update is required first.");
      return;
    }
    setRemovingId(id);
    try {
      await updateDoc(doc(db, "notifications", id), { active: false });
    } catch (e) {
      console.error("Remove notification failed", e);
      alert("Unable to remove notification");
    } finally {
      setRemovingId("");
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.moduleHeader}>
        <button style={styles.backBtn} onClick={() => navigate("/apps")}>← Apps</button>
        <div style={styles.moduleTitle}>Notifications Module</div>
      </div>

      <div style={styles.headerRow}>
        <h2 style={styles.title}>Notifications</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={styles.softCount}>Unread: {unreadRows.length}</span>
          <span style={styles.count}>{visibleRows.length}</span>
        </div>
      </div>

      {!visibleRows.length ? (
        <div style={styles.empty}>No notifications available.</div>
      ) : (
        <div style={styles.list}>
          {visibleRows.map((n) => (
            <div key={n.id} style={styles.item}>
              <div style={styles.itemTop}>
                <div style={styles.itemLeft}>
                  <div style={styles.itemTitle}>{n.title || n.subject || "Notification"}</div>
                  <div style={styles.itemBody}>{n.message || n.body || "You have an update."}</div>
                  <div style={styles.meta}>{String(n.type || "notification")}</div>
                  {!!getNotificationLink(n) && (
                    <a
                      href={getNotificationLink(n)}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.link}
                    >
                      Open link
                    </a>
                  )}
                </div>
                <div style={styles.itemRight}>
                  <div style={styles.time}>{toMillis(n.createdAt) ? new Date(toMillis(n.createdAt)).toLocaleString() : ""}</div>
                  {String(n.type || "").toLowerCase() === "site_survey_link" ? (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                      <button
                        onClick={() => openUpdateSiteVisit(n)}
                        style={styles.updateBtn}
                      >
                        Update Site Visit
                      </button>

                      {canRemoveNotification(n) ? (
                        <button
                          onClick={() => handleRemove(n)}
                          disabled={removingId === n.id}
                          style={{ ...styles.removeBtn, opacity: removingId === n.id ? 0.6 : 1 }}
                        >
                          {removingId === n.id ? "Removing..." : "Remove"}
                        </button>
                      ) : (
                        <span style={styles.updateHint}>
                          {isNotificationRead(n) ? "Update required before remove" : "Read first to remove"}
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRemove(n)}
                      disabled={removingId === n.id || !canRemoveNotification(n)}
                      style={{ ...styles.removeBtn, opacity: removingId === n.id ? 0.6 : canRemoveNotification(n) ? 1 : 0.45 }}
                    >
                      {removingId === n.id ? "Removing..." : "Remove"}
                    </button>
                  )}
                </div>
              </div>

              {selectedNotificationId === n.id && selectedDealForUpdate && (
                <div style={styles.inlineModalWrap}>
                  <UpdateSiteVisitModal
                    deal={selectedDealForUpdate}
                    onClose={() => {
                      setSelectedDealForUpdate(null);
                      setSelectedNotificationId("");
                    }}
                    onSaved={(payload) => {
                      handleSiteVisitSaved(payload);
                      setSelectedDealForUpdate(null);
                      setSelectedNotificationId("");
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: 16,
    paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
    background: BRAND_MAROON_PURPLE_GRADIENT,
    height: "100dvh",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  moduleHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    position: "relative",
    zIndex: 3,
    marginBottom: 14,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
  },
  moduleTitle: {
    color: "#fff",
    fontWeight: 700,
  },
  backBtn: {
    border: "1px solid rgba(255,255,255,0.55)",
    background: "transparent",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
    minHeight: 40,
    minWidth: 92,
    touchAction: "manipulation",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 12,
    padding: "10px 12px",
  },
  title: {
    margin: 0,
    color: "#fff",
  },
  count: {
    minWidth: 32,
    textAlign: "center",
    borderRadius: 999,
    background: "#800000",
    color: "#fff",
    padding: "4px 10px",
    fontWeight: 700,
  },
  softCount: {
    minWidth: 72,
    textAlign: "center",
    borderRadius: 999,
    background: "#fff",
    color: "#800000",
    border: "1px solid rgba(255,255,255,0.45)",
    padding: "4px 10px",
    fontWeight: 700,
    fontSize: 12,
  },
  empty: {
    border: "1px solid rgba(255,255,255,0.24)",
    borderRadius: 12,
    padding: 18,
    color: "#fff",
    background: "rgba(255,255,255,0.08)",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
    paddingRight: 2,
  },
  item: {
    border: "1px solid #ead9e6",
    borderRadius: 12,
    padding: 12,
    background: "linear-gradient(180deg, #ffffff 0%, #fff7fb 100%)",
    boxShadow: "0 8px 18px rgba(63,11,28,0.08)",
  },
  itemTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  itemLeft: {
    flex: "1 1 520px",
    minWidth: 260,
  },
  itemRight: {
    flex: "0 0 auto",
    textAlign: "right",
    marginLeft: "auto",
  },
  itemTitle: {
    fontWeight: 700,
    color: "#2d2d2d",
    marginBottom: 4,
  },
  itemBody: {
    color: "#555",
    marginBottom: 6,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  meta: {
    color: "#888",
    fontSize: 12,
  },
  link: {
    display: "inline-block",
    marginTop: 6,
    color: "#800000",
    textDecoration: "underline",
    fontWeight: 600,
  },
  time: {
    color: "#777",
    fontSize: 12,
    marginBottom: 8,
  },
  updateBtn: {
    border: "1px solid #800000",
    background: "#800000",
    color: "#fff",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  updateHint: {
    color: "#8a5a00",
    fontSize: 12,
    fontWeight: 600,
  },
  removeBtn: {
    border: "1px solid #b52b27",
    background: "#fff",
    color: "#b52b27",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  inlineModalWrap: {
    marginTop: 12,
    borderTop: "1px dashed #e1c3c3",
    paddingTop: 10,
  },
};
