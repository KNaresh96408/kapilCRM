import React, { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";

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
};

const canonicalRole = (value) => {
  const normalized = normalizeRole(value);
  if (!normalized) return "";
  const compact = normalized.replace(/_/g, "");
  return roleAlias[normalized] || roleAlias[compact] || normalized;
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

export default function WebNotificationsPanel() {
  const { user, roleData } = useAuth();
  const [allRows, setAllRows] = useState([]);

  const uid = String(user?.uid || "").trim();
  const email = String(user?.email || "").trim().toLowerCase();

  const sessionRole = (() => {
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.role || parsed?.profile?.role || parsed?.profile?.Role || "";
    } catch {
      return "";
    }
  })();

  const myRole = canonicalRole(roleData?.role || sessionRole);

  useEffect(() => {
    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(250));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setAllRows(rows);
      },
      (err) => {
        console.warn("Notifications live feed failed:", err?.message || err);
      }
    );

    return () => unsub();
  }, []);

  const rows = useMemo(() => {
    return (allRows || [])
      .filter((n) => n.active !== false)
      .filter((n) => {
        const toUserId = String(n.toUserId || n.toUid || "").trim();
        const toEmail = String(n.toEmail || "").trim().toLowerCase();
        const toRole = canonicalRole(n.toRole || "");
        const emails = Array.isArray(n.toEmails)
          ? n.toEmails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
          : [];

        const uidMatch = !!uid && !!toUserId && toUserId === uid;
        const emailMatch = !!email && (!!toEmail && toEmail === email || emails.includes(email));
        const roleMatch = !!myRole && !!toRole && toRole === myRole;

        return uidMatch || emailMatch || roleMatch;
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [allRows, uid, email, myRole]);

  if (!user) return null;

  return (
    <div style={styles.wrapper}>
      <div style={styles.headerRow}>
        <h3 style={styles.title}>Notifications</h3>
        <span style={styles.badge}>{rows.length}</span>
      </div>

      {!rows.length ? (
        <p style={styles.empty}>No notifications yet.</p>
      ) : (
        <div style={styles.list}>
          {rows.slice(0, 20).map((n) => (
            <div key={n.id} style={styles.item}>
              <div style={styles.itemTitle}>{n.title || n.subject || "Update"}</div>
              <div style={styles.itemBody}>{n.message || n.body || "You have a new update."}</div>
              <div style={styles.meta}>
                <span>{String(n.type || "notification")}</span>
                <span>{toMillis(n.createdAt) ? new Date(toMillis(n.createdAt)).toLocaleString() : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    border: "2px solid #800000",
    borderRadius: 8,
    background: "#fff",
    padding: 12,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    margin: 0,
    color: "#800000",
    fontSize: 18,
  },
  badge: {
    background: "#800000",
    color: "#fff",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  empty: {
    margin: 0,
    color: "#666",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: 320,
    overflow: "auto",
  },
  item: {
    border: "1px solid #eee",
    borderRadius: 6,
    padding: 8,
    background: "#fafafa",
  },
  itemTitle: {
    fontWeight: 700,
    color: "#2d2d2d",
    marginBottom: 4,
  },
  itemBody: {
    color: "#555",
    fontSize: 13,
    marginBottom: 6,
  },
  meta: {
    display: "flex",
    justifyContent: "space-between",
    color: "#888",
    fontSize: 11,
  },
};
