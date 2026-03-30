import { useEffect, useMemo, useRef } from "react";
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

function isWeb() {
  return typeof window !== "undefined" && typeof Notification !== "undefined";
}

export default function WebNotificationListener() {
  const { user, roleData } = useAuth();
  const initializedRef = useRef(false);
  const seenIdsRef = useRef(new Set());

  const uid = String(user?.uid || "").trim();
  const email = String(user?.email || "").trim().toLowerCase();

  const sessionRole = useMemo(() => {
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.role || parsed?.profile?.role || parsed?.profile?.Role || "";
    } catch {
      return "";
    }
  }, [user?.uid]);

  const myRole = canonicalRole(roleData?.role || sessionRole);

  useEffect(() => {
    if (!isWeb()) return;

    const asked = localStorage.getItem("kp-web-notification-permission");
    if (Notification.permission === "default" && asked !== "asked") {
      Notification.requestPermission().finally(() => {
        localStorage.setItem("kp-web-notification-permission", "asked");
      });
    }
  }, []);

  useEffect(() => {
    if (!uid && !email && !myRole) return;
    if (!isWeb()) return;

    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(300));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docById = new Map();
        snap.docs.forEach((d) => {
          docById.set(d.id, { id: d.id, ...(d.data() || {}) });
        });

        if (!initializedRef.current) {
          const seed = new Set();
          snap.docs.forEach((d) => seed.add(d.id));
          seenIdsRef.current = seed;
          initializedRef.current = true;
          return;
        }

        snap.docChanges().forEach((chg) => {
          if (chg.type !== "added") return;
          const id = chg.doc.id;
          if (seenIdsRef.current.has(id)) return;

          const n = docById.get(id) || { id, ...(chg.doc.data() || {}) };
          if (n.active === false) return;

          const toUserId = String(n.toUserId || n.toUid || "").trim();
          const toEmail = String(n.toEmail || "").trim().toLowerCase();
          const toRole = canonicalRole(n.toRole || "");
          const toEmails = Array.isArray(n.toEmails)
            ? n.toEmails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
            : [];

          const uidMatch = !!uid && !!toUserId && toUserId === uid;
          const emailMatch = !!email && (!!toEmail && toEmail === email || toEmails.includes(email));
          const roleMatch = !!myRole && !!toRole && toRole === myRole;

          if (!(uidMatch || emailMatch || roleMatch)) {
            seenIdsRef.current.add(id);
            return;
          }

          if (Notification.permission === "granted") {
            try {
              const popup = new Notification(n.title || n.subject || "CRM Notification", {
                body: n.message || n.body || "You have a new notification",
                tag: `kp-${id}`,
              });

              popup.onclick = () => {
                try {
                  window.focus();
                  window.location.hash = "#/notifications";
                } catch {}
              };
            } catch (e) {
              console.warn("Web notification popup failed", e?.message || e);
            }
          }

          seenIdsRef.current.add(id);
        });
      },
      (err) => {
        console.warn("WebNotificationListener snapshot failed:", err?.message || err);
      }
    );

    return () => unsub();
  }, [uid, email, myRole]);

  return null;
}
