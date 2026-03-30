import React, { useEffect, useState } from "react";
import { doc, updateDoc, arrayUnion, serverTimestamp, collection, addDoc, query, where, getDocs, getDoc, limit } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { fetchDocumentREST, updateDocumentREST } from "../helpers/firestoreRest";

export default function UpdateSiteVisitModal({ deal, onClose, onSaved }) {
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [siteVisitKeys, setSiteVisitKeys] = useState({ completedKey: "", arrangedKey: "" });

  const normalizeKey = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "");

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

  const createNotification = async (payload) => {
    try {
      await addDoc(collection(db, "notifications"), payload);
    } catch (e) {
      try {
        const apiBase = import.meta.env.VITE_API_BASE;
        if (!apiBase) throw e;

        const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
        const headers = {
          "Content-Type": "application/json",
        };
        if (stored?.idToken) {
          headers.Authorization = `Bearer ${stored.idToken}`;
        }

        const payloadForHttp = { ...payload };
        if (payloadForHttp.createdAt && typeof payloadForHttp.createdAt !== "string") {
          delete payloadForHttp.createdAt;
        }

        const res = await fetch(`${apiBase}/createNotification`, {
          method: "POST",
          headers,
          body: JSON.stringify(payloadForHttp),
          mode: "cors",
        });

        if (!res.ok) {
          throw new Error(`createNotification failed (${res.status})`);
        }
      } catch (err) {
        console.error("Notification create failed", err);
      }
    }
  };

  const isRetryableSdkWriteError = (err) => {
    const code = String(err?.code || "").toLowerCase();
    const msg = String(err?.message || "").toLowerCase();
    return (
      code.includes("permission-denied") ||
      code.includes("unauthenticated") ||
      code.includes("unavailable") ||
      msg.includes("permission") ||
      msg.includes("insufficient") ||
      msg.includes("missing or insufficient")
    );
  };

  const getSessionToken = () => {
    try {
      const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
      return stored?.idToken || null;
    } catch {
      return null;
    }
  };

  const updateDealWithFallback = async (dealRef, resolvedId, patch) => {
    try {
      await updateDoc(dealRef, patch);
      return;
    } catch (sdkErr) {
      if (!isRetryableSdkWriteError(sdkErr)) throw sdkErr;

      const token = getSessionToken();
      if (!token) throw sdkErr;

      const restPatch = { ...patch };
      // Firestore transforms are not valid in REST patch payload
      if (restPatch.updatedAt) {
        restPatch.updatedAt = new Date();
      }

      await updateDocumentREST("deals", resolvedId, restPatch, token);
    }
  };

  const appendNoteWithFallback = async (dealRef, resolvedId, noteObj) => {
    try {
      await updateDoc(dealRef, {
        notes: arrayUnion(noteObj),
        updatedAt: serverTimestamp(),
      });
      return;
    } catch (sdkErr) {
      if (!isRetryableSdkWriteError(sdkErr)) throw sdkErr;

      const token = getSessionToken();
      if (!token) throw sdkErr;

      let existing = [];
      try {
        const snap = await getDoc(dealRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          existing = Array.isArray(data.notes) ? data.notes : [];
        }
      } catch {
        const rest = await fetchDocumentREST(`deals/${resolvedId}`, token);
        existing = Array.isArray(rest?.notes) ? rest.notes : [];
      }

      await updateDocumentREST(
        "deals",
        resolvedId,
        {
          notes: [...existing, noteObj],
          updatedAt: new Date(),
        },
        token
      );
    }
  };

  const resolveDealRef = async () => {
    const dealId = String(deal?.id || "").trim();
    const autoId = String(deal?.autoId || deal?.kpiId || deal?.kpi_id || "").trim();

    if (dealId) {
      const byIdRef = doc(db, "deals", dealId);
      const byIdSnap = await getDoc(byIdRef);
      if (byIdSnap.exists()) {
        return { ref: byIdRef, resolvedId: byIdSnap.id };
      }
    }

    if (autoId) {
      const byAutoIdRef = doc(db, "deals", autoId);
      const byAutoIdSnap = await getDoc(byAutoIdRef);
      if (byAutoIdSnap.exists()) {
        return { ref: byAutoIdRef, resolvedId: byAutoIdSnap.id };
      }

      const [q1, q2] = await Promise.all([
        getDocs(query(collection(db, "deals"), where("autoId", "==", autoId), limit(1))),
        getDocs(query(collection(db, "deals"), where("kpiId", "==", autoId), limit(1))),
      ]);

      const first = !q1.empty ? q1.docs[0] : !q2.empty ? q2.docs[0] : null;
      if (first) {
        return { ref: doc(db, "deals", first.id), resolvedId: first.id };
      }
    }

    throw new Error("Deal not found for site visit update");
  };

  const handleSubmit = async () => {
    if (!status) return alert("Select a status");

    if ((status === "Completed" || status === "Rescheduled") && !date) {
      return alert(status === "Completed" ? "Enter completion date" : "Enter rescheduled date");
    }

    if (status === "Not Interested" && !reason) {
      return alert("Enter reason");
    }

    setLoading(true);

    try {
      const { ref: dealRef, resolvedId } = await resolveDealRef();
      const notifyDealId = String(deal?.autoId || deal?.kpiId || deal?.kpi_id || resolvedId || "");

      // deactivate previous notifications for this deal
      try {
        const notifQ = query(collection(db, "notifications"), where("dealId", "==", notifyDealId), where("active", "==", true));
        const snap = await getDocs(notifQ);
        for (const d of snap.docs) {
          await updateDoc(d.ref, { active: false });
        }
      } catch (notifErr) {
        // permissions may block notifications updates for consultant users; continue deal update.
        console.warn("Skipping notification deactivation:", notifErr?.message || notifErr);
      }

      const noteParts = [];

      const completedKey = siteVisitKeys.completedKey;
      const arrangedKey = siteVisitKeys.arrangedKey;

      if (status === "Completed") {
        const completedValue = new Date(date).toISOString();
        await updateDealWithFallback(dealRef, resolvedId, {
          siteVisitCompletedDate: completedValue,
          ...(completedKey ? { [completedKey]: completedValue } : {}),
          siteVisitStatus: "Completed",
          updatedAt: serverTimestamp(),
        });
        noteParts.push(`Site visit completed on ${date}`);

        // create notification for tele-caller (update)
        await createNotification({
          dealId: notifyDealId,
          type: "update",
          toRole: "telesales",
          subject: `Update: ${deal.autoId} site visit completed`,
          body: `KPI ${deal.autoId} site visit completed on ${date}`,
          active: true,
          assignedTo: deal.assignedConsultant || "",
          createdAt: serverTimestamp(),
        });

      } else if (status === "Not Interested") {
        await updateDealWithFallback(dealRef, resolvedId, {
          notInterestedReason: reason,
          siteVisitStatus: "Not Interested",
          stage: "Not Interested",
          updatedAt: serverTimestamp(),
        });

        noteParts.push(`Customer not interested — ${reason}`);

        await createNotification({
          dealId: notifyDealId,
          type: "update",
          toRole: "telesales",
          subject: `Update: ${deal.autoId} customer not interested`,
          body: `KPI ${deal.autoId} customer not interested. Reason: ${reason}`,
          active: true,
          assignedTo: deal.assignedConsultant || "",
          createdAt: serverTimestamp(),
        });

      } else if (status === "Rescheduled") {
        const arrangedValue = new Date(date).toISOString();
        await updateDealWithFallback(dealRef, resolvedId, {
          siteVisitArrangedDate: arrangedValue,
          ...(arrangedKey ? { [arrangedKey]: arrangedValue } : {}),
          siteVisitStatus: "Rescheduled",
          updatedAt: serverTimestamp(),
        });

        noteParts.push(`Site visit rescheduled to ${date}`);

        await createNotification({
          dealId: notifyDealId,
          type: "update",
          toRole: "telesales",
          subject: `Update: ${deal.autoId} site visit rescheduled`,
          body: `KPI ${deal.autoId} site visit rescheduled to ${date}`,
          active: true,
          assignedTo: deal.assignedConsultant || "",
          createdAt: serverTimestamp(),
        });

        // create scheduled notification for arranged date
        await createNotification({
          dealId: notifyDealId,
          type: "site_visit_pending",
          toRole: "consultant",
          subject: `Site visit pending: ${deal.autoId}`,
          body: `Site visit pending on ${date} for ${deal.autoId}`,
          notifyAt: arrangedValue,
          active: true,
          assignedTo: deal.assignedConsultant || "",
          createdAt: serverTimestamp(),
        });
      }

      // push note to deal
      const noteObj = {
        by: (localStorage.getItem("kp-user") && JSON.parse(localStorage.getItem("kp-user")).email) || "",
        at: new Date().toISOString(),
        text: noteParts.join(" — "),
        type: status,
      };

      await appendNoteWithFallback(dealRef, resolvedId, noteObj);

      alert("Saved");
      window.dispatchEvent(
        new CustomEvent("deal-updated", {
          detail: { id: deal.autoId || deal.id || "" },
        })
      );
      window.dispatchEvent(new CustomEvent("refresh-deals"));
      if (onSaved) {
        onSaved({
          resolvedId,
          notificationDealId: notifyDealId,
          siteVisitStatus: status,
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      alert("Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
      <h3 style={{ color: "#800000" }}>Update Site Visit — {deal.autoId}</h3>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #800000" }}>
          <option value="">Select</option>
          <option value="Completed">Completed</option>
          <option value="Not Interested">Not Interested</option>
          <option value="Rescheduled">Rescheduled</option>
        </select>
      </div>

      {(status === "Completed" || status === "Rescheduled") && (
        <div style={{ marginTop: 10 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #800000" }} />
        </div>
      )}

      {status === "Not Interested" && (
        <div style={{ marginTop: 10 }}>
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #800000" }} />
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={handleSubmit} disabled={loading} style={{ background: "#800000", color: "#fff", padding: "8px 12px", borderRadius: 6, border: "none" }}>
          {loading ? "Saving..." : "Save"}
        </button>
        <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 6 }}>Cancel</button>
      </div>
    </div>
  );
}
