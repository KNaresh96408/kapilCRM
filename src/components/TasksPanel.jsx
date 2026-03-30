import React, { useEffect, useState } from "react";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import UpdateSiteVisitModal from "./UpdateSiteVisitModal";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";

export default function TasksPanel() {
  const [tasks, setTasks] = useState([]);
  const [pending, setPending] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [siteVisitKeys, setSiteVisitKeys] = useState({ completedKey: "", arrangedKey: "" });

  const normalizeKey = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "");

  const normalizeRole = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

  const parseDate = (v) => {
    if (!v) return null;
    if (v?.toDate && typeof v.toDate === "function") {
      try {
        return v.toDate();
      } catch {
        return null;
      }
    }
    if (typeof v === "number") {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const diffDaysFromNow = (dateVal) => {
    const d = parseDate(dateVal);
    if (!d) return 0;
    const ms = Date.now() - d.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  };

  const isDealClosedForTask = (deal) => {
    const stage = normalizeKey(deal?.stage || "");
    const completedRaw =
      (siteVisitKeys.completedKey && deal?.[siteVisitKeys.completedKey]) ||
      deal?.siteVisitCompletedDate ||
      null;
    if (completedRaw) return true;
    return stage.includes("notinterested");
  };

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("kp-user") : null;
    const parsed = stored ? JSON.parse(stored) : null;
    setUser(parsed);

    const localRole = normalizeRole(
      parsed?.profile?.role ||
      parsed?.profile?.Role ||
      parsed?.role ||
      parsed?.Role ||
      ""
    );
    if (localRole) setRole(localRole);

    if (parsed?.email) {
      (async () => {
        try {
          const q = query(collection(db, "Users"), where("email", "==", parsed.email));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const r = snap.docs[0].data();
            setRole(normalizeRole(r.role || r.designation || ""));
            return;
          }

          // Fallback for case/format mismatches in email field
          const allUsers = await fetchCollectionDocs("Users");
          const me = String(parsed.email || "").trim().toLowerCase();
          const matched = (allUsers || []).find((d) => String(d?.email || "").trim().toLowerCase() === me);
          if (matched) {
            const r = matched || {};
            setRole(normalizeRole(r.role || r.designation || ""));
          }
        } catch (e) {
          console.error(e);
        }
      })();
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const ref = doc(db, "crm_fields", "deals");
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data() || {};
        const defs = Array.isArray(data.fields) ? data.fields : [];
        const names = defs
          .map((f) => (typeof f === "string" ? f : f?.name))
          .filter(Boolean);

        const isCompleted = (n) =>
          n.includes("site") && n.includes("visit") && n.includes("completed");
        const isArranged = (n) =>
          n.includes("site") &&
          n.includes("visit") &&
          (n.includes("arranged") || n.includes("scheduled") || n.includes("rescheduled"));

        const completedKey = names.find((n) => isCompleted(normalizeKey(n))) || "";
        const arrangedKey = names.find((n) => isArranged(normalizeKey(n))) || "";

        if (!active) return;
        setSiteVisitKeys({ completedKey, arrangedKey });
      } catch (e) {
        console.error("Failed to load crm_fields/deals", e);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      try {
        const currentEmail = String(user?.email || "").trim().toLowerCase();
        const currentName = String(
          user?.profile?.Name ||
          user?.profile?.name ||
          user?.Name ||
          user?.name ||
          ""
        )
          .trim()
          .toLowerCase();

        // Tasks for assignee: every assigned deal must be updated for site visit.
        const q = query(collection(db, "deals"), where("assignedConsultant", "==", user.email));
        const snap = await getDocs(q);
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const t = [];
        const p = [];

        all.forEach((d) => {
          if (isDealClosedForTask(d)) return;

          const baseDate = d.createdAt || d.created_at || d.updatedAt || null;
          const ageDays = diffDaysFromNow(baseDate);

          // Stay in task box for first 7 days, then move to pending.
          if (ageDays <= 7) t.push(d);
          else p.push(d);
        });

        setTasks(t);
        setPending(p);

        // Escalation Updates (reporting officer after 7 days, state/sales head after 14 days)
        const updateRolesAllowed = new Set([
          "tele_caller",
          "telesales",
          "team_lead",
          "consultant",
          "area_sales_manager",
          "zonal_manager",
          "state_head",
          "sales_head",
          "admin",
        ]);

        if (!updateRolesAllowed.has(role)) {
          setUpdates([]);
          return;
        }

        const [dealsRows, usersRows] = await Promise.all([
          fetchCollectionDocs("deals"),
          fetchCollectionDocs("Users"),
        ]);

        const usersByEmail = new Map();
        (usersRows || []).forEach((u) => {
          const data = u || {};
          const email = String(data.email || "").trim().toLowerCase();
          if (!email) return;
          usersByEmail.set(email, data);
        });

        const list = [];
        (dealsRows || []).forEach((d) => {
          if (isDealClosedForTask(d)) return;

          const ageDays = diffDaysFromNow(d.createdAt || d.created_at || d.updatedAt || null);
          if (ageDays <= 7) return;

          const consultantEmail = String(d.assignedConsultant || "").trim().toLowerCase();
          const consultantUser = usersByEmail.get(consultantEmail) || {};
          const consultantName =
            String(d.consultantName || consultantUser.Name || consultantUser.name || consultantEmail || "Consultant").trim();
          const reportingOfficerEmail = String(
            consultantUser.reportsToEmail ||
            consultantUser.reportingOfficerEmail ||
            consultantUser.managerEmail ||
            consultantUser.reportsTo ||
            consultantUser.reports_to ||
            ""
          )
            .trim()
            .toLowerCase();

          const kpi = d.autoId || d.kpi_id || d.kpiId || d.id;
          const zonalName = d.zonal_manager || d.zonalManager || "zonal manager";

          if (ageDays > 7 && ageDays <= 14 && reportingOfficerEmail && currentEmail === reportingOfficerEmail) {
            list.push({
              id: `lvl1_${kpi}`,
              text: `${kpi} was not updated from 7 days by ${consultantName}.`,
            });
          }

          if (ageDays > 14 && ["state_head", "sales_head", "admin"].includes(role)) {
            list.push({
              id: `lvl2_${kpi}`,
              text: `${kpi} no update regarding site visit by ${consultantName} and ${zonalName}.`,
            });
          }
        });

        // Consultant update notifications for Tele-caller / Team Lead
        if (["tele_caller", "telesales", "team_lead"].includes(role)) {
          const statusUpdates = [];

          (dealsRows || []).forEach((d) => {
            const siteStatus = String(d.siteVisitStatus || "").trim();
            if (!siteStatus) return;

            const teleSale = String(d.teleSale || "").trim().toLowerCase();
            if (role !== "team_lead") {
              const matchByName = currentName && teleSale && teleSale === currentName;
              const matchByEmail = currentEmail && teleSale && teleSale === currentEmail;
              if (!matchByName && !matchByEmail) return;
            }

            const kpi = d.autoId || d.kpi_id || d.kpiId || d.id;
            const consultantName = String(d.consultantName || d.assignedConsultant || "Consultant");

            if (siteStatus === "Completed") {
              const completedDate = parseDate(
                d.siteVisitCompletedDate ||
                (siteVisitKeys.completedKey ? d[siteVisitKeys.completedKey] : null)
              );
              const dateText = completedDate ? completedDate.toLocaleDateString("en-GB") : "today";
              statusUpdates.push({
                id: `status_done_${kpi}`,
                text: `${kpi}: ${consultantName} marked site visit completed on ${dateText}. Keep follow-up to convert to sales.`,
              });
              return;
            }

            if (siteStatus === "Rescheduled") {
              const arrangedDate = parseDate(
                d.siteVisitArrangedDate ||
                (siteVisitKeys.arrangedKey ? d[siteVisitKeys.arrangedKey] : null)
              );
              const dateText = arrangedDate ? arrangedDate.toLocaleDateString("en-GB") : "new date";
              statusUpdates.push({
                id: `status_re_${kpi}`,
                text: `${kpi}: ${consultantName} rescheduled site visit to ${dateText}.`,
              });
              return;
            }

            if (siteStatus === "Not Interested") {
              const reason = String(d.notInterestedReason || "No reason provided");
              statusUpdates.push({
                id: `status_ni_${kpi}`,
                text: `${kpi}: customer marked Not Interested by ${consultantName}. Reason: ${reason}.`,
              });
            }
          });

          const merged = [...statusUpdates, ...list];
          setUpdates(merged.slice(0, 8));
          return;
        }

        setUpdates(list.slice(0, 8));
      } catch (e) {
        console.error(e);
      }
    };

    load();
  }, [user, role, siteVisitKeys.completedKey, siteVisitKeys.arrangedKey]);

  // Decide visibility: show Tasks/Pending for these roles
  const showTaskBoxes = ["consultant", "area_sales_manager", "zonal_manager", "telesales", "tele_caller", "team_lead"].includes(role);
  const showUpdatesBox = [
    "tele_caller",
    "telesales",
    "team_lead",
    "consultant",
    "area_sales_manager",
    "zonal_manager",
    "state_head",
    "sales_head",
    "admin",
  ].includes(role);

  if (user && !role) {
    return (
      <div style={{ border: "2px solid #800000", padding: 16, borderRadius: 8, background: "#fff" }}>
        <h3 style={{ color: "#800000" }}>Loading tasks...</h3>
      </div>
    );
  }

  if (!showTaskBoxes && !showUpdatesBox) {
    return (
      <div style={{ border: "2px solid #800000", padding: 16, borderRadius: 8, background: "#fff" }}>
        <h3 style={{ color: "#800000" }}>Updates</h3>
        <p>All updates and notifications will appear here for your review.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: showTaskBoxes ? "1fr 1fr" : "1fr", gap: 16 }}>
      {showTaskBoxes && (
        <>
          <div style={{ border: "2px solid #800000", padding: 12, borderRadius: 8, background: "#fff" }}>
            <h3 style={{ color: "#800000" }}>Tasks</h3>
            <p style={{ fontSize: 28, fontWeight: 700, color: "#800000" }}>{tasks.length}</p>
            {tasks.slice(0,5).map((d) => (
              <div key={d.autoId || d.id} style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.autoId}</div>
                    <div style={{ color: "#666" }}>{d.name} — {d.location}</div>
                  </div>
                  <div>
                    <button onClick={() => setSelectedDeal(d)} style={{ background: "#800000", color: "#fff", border: "none", padding: "6px 10px", borderRadius: 6 }}>Update</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ border: "2px solid #800000", padding: 12, borderRadius: 8, background: "#fff" }}>
            <h3 style={{ color: "#800000" }}>Pending Tasks</h3>
            <p style={{ fontSize: 28, fontWeight: 700, color: "#800000" }}>{pending.length}</p>
            {pending.slice(0,5).map((d) => (
              <div key={d.autoId || d.id} style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.autoId}</div>
                    <div style={{ color: "#666" }}>{d.name} — {d.location}</div>
                  </div>
                  <div>
                    <button onClick={() => setSelectedDeal(d)} style={{ background: "#f0ad4e", color: "#fff", border: "none", padding: "6px 10px", borderRadius: 6 }}>Update</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showUpdatesBox && (
        <div style={{ gridColumn: "1 / -1", border: "2px solid #800000", padding: 12, borderRadius: 8, background: "#fff" }}>
          <h3 style={{ color: "#800000" }}>Updates</h3>
          {updates.length === 0 ? (
            <p style={{ color: "#666", margin: 0 }}>No escalation updates.</p>
          ) : (
            updates.map((u) => (
              <div key={u.id} style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
                <div style={{ color: "#333" }}>{u.text}</div>
              </div>
            ))
          )}
        </div>
      )}

      {selectedDeal && (
        <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
          <UpdateSiteVisitModal deal={selectedDeal} onClose={() => { setSelectedDeal(null); window.location.reload(); }} onSaved={() => { /* reload tasks */ window.location.reload(); }} />
        </div>
      )}
    </div>
  );
}
