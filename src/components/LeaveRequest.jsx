import React, { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  limit,
} from "firebase/firestore";
import { db, serverTimestamp } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";
import { fetchCollectionREST } from "../helpers/firestoreRest";

/* =====================================================
   HELPERS
===================================================== */

const DIRECTOR_EMAIL = "khader@kapilpower.com";

const normalizeRole = (raw) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const roleAlias = {
  hroperationsmanager: "agm",
  hr_operations_manager: "agm",
  agm: "agm",
  financemanager: "dgm",
  finance_manager: "dgm",
  dgm: "dgm",
  hrexecutive: "hr_executive",
  "hr executive": "hr_executive",
  hr_operations: "hr",
  telecaller: "tele_caller",
  tele_callers: "tele_caller",
  telesales: "tele_caller",
  saleshead: "sales_head",
};

const canonicalRole = (raw) => {
  const normalized = normalizeRole(raw);
  const compact = normalized.replace(/_/g, "");
  return roleAlias[normalized] || roleAlias[compact] || normalized;
};

const titleCase = (v = "") =>
  String(v)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());

const REQUEST_TYPE_LABEL = {
  leave: "Leave",
  comp_off: "Comp-Off",
  early_checkin: "Early Check-in",
  early_checkout: "Early Check-out",
};

const REQUEST_TYPE_OPTIONS = [
  { value: "leave", label: "Leave" },
  { value: "comp_off", label: "Comp-Off" },
  { value: "early_checkin", label: "Early Check-in" },
  { value: "early_checkout", label: "Early Check-out" },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toMillis = (v) => {
  if (!v) return 0;
  if (typeof v?.seconds === "number") return Number(v.seconds) * 1000;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

/* =====================================================
   COMPONENT
===================================================== */

export default function LeaveRequest({ user }) {
  const { roleData } = useAuth();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [requestType, setRequestType] = useState("leave");

  const [myRequests, setMyRequests] = useState([]);
  const [pendingForMe, setPendingForMe] = useState([]);
  const [usersIndex, setUsersIndex] = useState({
    byId: new Map(),
    byEmail: new Map(),
    byRole: new Map(),
  });
  const [rejectingId, setRejectingId] = useState("");
  const [rejectReasonById, setRejectReasonById] = useState({});
  const [processingById, setProcessingById] = useState({});

  const [role, setRole] = useState("");

  const uid = user?.uid;
  const email = user?.email || "";
  const isAdminRole = canonicalRole(role || roleData?.role) === "admin";

  const isPendingStatus = (status) => {
    const s = String(status || "").toLowerCase();
    if (!s) return false;
    return s === "pending" || s.startsWith("pending_");
  };

  const isMeCurrentApprover = (req) => {
    if (isAdminRole && isPendingStatus(req?.status)) return true;
    const reqApproverEmail = String(req?.approverEmail || "").toLowerCase();
    const reqApproverUid = String(req?.approverUid || "");

    // Legacy single-step docs (no approvalChain)
    const hasChain = Array.isArray(req?.approvalChain) && req.approvalChain.length > 0;
    if (!hasChain) {
      return !!(
        isPendingStatus(req?.status) &&
        ((uid && reqApproverUid && reqApproverUid === uid) ||
          (email && reqApproverEmail && reqApproverEmail === String(email).toLowerCase()))
      );
    }

    return !!(
      isPendingStatus(req?.status) &&
      ((uid && reqApproverUid && reqApproverUid === uid) ||
        (email && reqApproverEmail && reqApproverEmail === String(email).toLowerCase()))
    );
  };

  const buildUsersIndex = (rows = []) => {
    const byId = new Map();
    const byEmail = new Map();
    const byRole = new Map();

    (rows || []).forEach((r) => {
      if (!r) return;
      const id = r.id || r.uid || "";
      const e = String(r.email || r.Email || "").trim().toLowerCase();
      const name = r.Name || r.name || r.displayName || r.email || id || "Unknown";
      const resolvedRole = canonicalRole(r.role || r.Role || r.designation || r.Designation || "");
      const reportsToRaw = r.reportsTo || r.reportingTo || r.manager || "";

      const u = {
        id,
        email: e,
        name,
        role: resolvedRole,
        reportsToRaw,
      };

      if (id) byId.set(id, u);
      if (e) byEmail.set(e, u);
      if (resolvedRole) {
        if (!byRole.has(resolvedRole)) byRole.set(resolvedRole, []);
        byRole.get(resolvedRole).push(u);
      }
    });

    return { byId, byEmail, byRole };
  };

  const resolveUserFromReportsTo = (reportsToRaw, idx) => {
    if (!reportsToRaw) return null;
    const v = String(reportsToRaw).trim();
    if (!v) return null;
    if (idx.byId.has(v)) return idx.byId.get(v);
    const byMail = idx.byEmail.get(v.toLowerCase());
    if (byMail) return byMail;
    return null;
  };

  const pushApprover = (chain, userObj) => {
    if (!userObj) return;
    if (!userObj.id && !userObj.email) return;
    const exists = chain.some((x) => x.id === userObj.id || (x.email && x.email === userObj.email));
    if (exists) return;
    chain.push({
      id: userObj.id || "",
      email: userObj.email || "",
      name: userObj.name || userObj.email || userObj.id || "Unknown",
      role: canonicalRole(userObj.role),
    });
  };

  const pickFirstByRole = (roleKey, idx, excludeIds = new Set()) => {
    const list = idx.byRole.get(canonicalRole(roleKey)) || [];
    return list.find((u) => !excludeIds.has(u.id));
  };

  const buildApprovalChain = (requester, idx) => {
    const requesterRole = canonicalRole(requester?.role);
    const chain = [];

    const upwards = [];
    const seen = new Set();
    let cursor = requester;
    for (let i = 0; i < 8; i += 1) {
      const parent = resolveUserFromReportsTo(cursor?.reportsToRaw, idx);
      if (!parent) break;
      if (seen.has(parent.id || parent.email)) break;
      seen.add(parent.id || parent.email);
      upwards.push(parent);
      cursor = parent;
    }

    const exclude = new Set([requester?.id].filter(Boolean));

    const addByRole = (r) => {
      const roleToFind = canonicalRole(r);
      const fromUpward = upwards.find((u) => canonicalRole(u.role) === roleToFind);
      if (fromUpward) {
        pushApprover(chain, fromUpward);
        exclude.add(fromUpward.id);
        return;
      }
      const fallback = pickFirstByRole(roleToFind, idx, exclude);
      if (fallback) {
        pushApprover(chain, fallback);
        exclude.add(fallback.id);
      }
    };

    if (["consultant", "area_sales_manager"].includes(requesterRole)) {
      ["zonal_manager", "state_head", "sales_head"].forEach(addByRole);
    } else if (requesterRole === "zonal_manager") {
      ["state_head", "sales_head"].forEach(addByRole);
    } else if (requesterRole === "state_head") {
      ["sales_head"].forEach(addByRole);
    } else if (requesterRole === "team_lead") {
      ["sales_head"].forEach(addByRole);
    } else if (requesterRole === "hr") {
      ["agm", "sales_head"].forEach(addByRole);
    } else if (requesterRole === "hr_executive") {
      ["agm", "sales_head"].forEach(addByRole);
    } else if (["sales_head", "dgm", "agm"].includes(requesterRole)) {
      ["director"].forEach(addByRole);
    } else if (requesterRole === "director") {
      // director self-flow: no approval needed
    } else if (requesterRole === "tele_caller") {
      ["team_lead", "sales_head"].forEach(addByRole);
    } else {
      const firstManager = upwards.find((u) => canonicalRole(u.role).includes("manager"));
      if (firstManager) {
        pushApprover(chain, firstManager);
        exclude.add(firstManager.id);
      } else if (upwards[0]) {
        pushApprover(chain, upwards[0]);
        exclude.add(upwards[0].id);
      }

      const managerInChain = chain.some((u) => canonicalRole(u.role).includes("manager"));
      const hasSalesHead = chain.some((u) => canonicalRole(u.role) === "sales_head");
      if ((managerInChain || chain.length > 0) && !hasSalesHead) {
        addByRole("sales_head");
      }
    }

    if (chain.length === 0 && requesterRole !== "director") {
      addByRole("director");
    }

    return chain;
  };

  const createLeaveNotification = async ({
    toUserId,
    toRole,
    toEmails = [],
    title,
    message,
    leaveId,
  }) => {
    try {
      await addDoc(collection(db, "notifications"), {
        title,
        message,
        body: message,
        subject: title,
        type: "leave_approval",
        module: "attendance",
        referenceType: "leaveRequest",
        referenceId: leaveId || "",
        toUserId: toUserId || null,
        toRole: toRole || null,
        toEmails: (toEmails || []).filter(Boolean),
        status: "unread",
        active: true,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Leave notification create failed", e?.message || e);
    }
  };

  /* ---------------- ROLE ---------------- */

  useEffect(() => {
    if (roleData?.role) {
      setRole(canonicalRole(roleData.role));
    }
  }, [roleData]);

  /* ---------------- MY REQUESTS ---------------- */

  useEffect(() => {
    if (!uid) return;
    loadMyRequests();
  }, [uid]);

  useEffect(() => {
    loadUsersIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUsersIndex = async () => {
    const TIMEOUT_MS = 3500;
    try {
      let rows = [];

      try {
        const q = query(collection(db, "Users"));
        const snap = await Promise.race([
          getDocs(q),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
        ]);
        rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (sdkErr) {
        console.warn("Users list SDK fallback in LeaveRequest", sdkErr?.message || sdkErr);
      }

      if (!rows.length) {
        try {
          const stored = localStorage.getItem("kp-user");
          const parsed = stored ? JSON.parse(stored) : null;
          const token = parsed?.idToken;
          if (token) {
            rows = await fetchCollectionREST("Users", token);
          }
        } catch (restErr) {
          console.warn("Users list REST fallback failed in LeaveRequest", restErr?.message || restErr);
        }
      }

      setUsersIndex(buildUsersIndex(rows || []));
    } catch (e) {
      console.warn("loadUsersIndex error", e);
      setUsersIndex(buildUsersIndex([]));
    }
  };

  const loadMyRequests = async () => {
    const TIMEOUT_MS = 3000;
    try {
      // Try SDK first
      try {
        const q = query(
          collection(db, "leaveRequests"),
          where("userId", "==", uid)
        );
        const sdkPromise = getDocs(q);
        const snap = await Promise.race([
          sdkPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
        ]);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
        setMyRequests(rows);
        return;
      } catch (sdkErr) {
        console.warn('🟡 LeaveRequest SDK failed, trying REST', sdkErr?.message);
      }

      // REST fallback
      try {
        const stored = localStorage.getItem('kp-user');
        const parsed = stored ? JSON.parse(stored) : null;
        const token = parsed?.idToken;

        if (token) {
          const data = await fetchCollectionREST('leaveRequests', token);
          const filtered = data
            .filter(d => d.userId === uid)
            .sort((a, b) => {
              const at = a?.createdAt?.seconds || 0;
              const bt = b?.createdAt?.seconds || 0;
              return bt - at;
            });
          setMyRequests(filtered);
          return;
        }
      } catch (restErr) {
        console.warn('⚠️ REST fallback failed', restErr?.message);
      }

      setMyRequests([]);
    } catch (e) {
      console.error("loadMyRequests error:", e);
      setMyRequests([]);
    }
  };

  /* =====================================================
     SUBMIT LEAVE (FINAL LOGIC)
  ===================================================== */

  const submitLeave = async () => {
    if (!from || !to || !reason) {
      alert("Please fill all fields");
      return;
    }

    const requester = {
      id: uid,
      email: String(email || "").toLowerCase(),
      name: user?.displayName || email,
      role: canonicalRole(role || roleData?.role),
      reportsToRaw:
        usersIndex.byId.get(uid)?.reportsToRaw ||
        usersIndex.byEmail.get(String(email || "").toLowerCase())?.reportsToRaw ||
        "",
    };

    const chain = buildApprovalChain(requester, usersIndex);

    if (!chain.length) {
      alert("No approver chain found. Please contact admin.");
      return;
    }

    const approvalChain = chain.map((u, idx) => ({
      level: idx + 1,
      uid: u.id || "",
      email: u.email || "",
      name: u.name || u.email || "Unknown",
      role: canonicalRole(u.role),
      status: "pending",
      actedAt: null,
      actionBy: null,
      actionReason: "",
    }));

    const first = approvalChain[0];

    const ref = await addDoc(collection(db, "leaveRequests"), {
      userId: uid,
      userName: user.displayName || email,
      userEmail: email,
      userRole: requester.role,
      from,
      to,
      reason,
      type: requestType,
      status: "pending",
      final_status: "pending",
      currentApprovalIndex: 0,
      approvalChain,
      approverUid: first.uid || "",
      approverEmail: first.email || "",
      approverRole: first.role || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await createLeaveNotification({
      toUserId: first.uid || null,
      toRole: first.uid ? null : first.role,
      toEmails: [first.email].filter(Boolean),
      title: `${REQUEST_TYPE_LABEL[requestType] || "Leave"} approval required`,
      message: `${requester.name} requested ${REQUEST_TYPE_LABEL[requestType] || "Leave"} (${from} → ${to}).`,
      leaveId: ref.id,
    });

    alert(`${REQUEST_TYPE_LABEL[requestType] || "Request"} submitted`);
    setFrom("");
    setTo("");
    setReason("");
    setRequestType("leave");
    loadMyRequests();
    loadPendingForMe();
  };

  /* =====================================================
     APPROVAL ACTION
  ===================================================== */

  const handleAction = async (req, action) => {
    if (!req?.id) return;
    if (processingById[req.id]) return;

    setProcessingById((prev) => ({ ...prev, [req.id]: true }));

    try {
    const ref = doc(db, "leaveRequests", req.id);

    if (!isMeCurrentApprover(req)) {
      alert("This request is not assigned to you now.");
      await loadPendingForMe();
      return;
    }

    const chain = Array.isArray(req.approvalChain) ? [...req.approvalChain] : [];
    const idx = Number(req.currentApprovalIndex || 0);

    const meName = user?.displayName || email;
    const meRole = canonicalRole(role || roleData?.role);

    // Legacy single-step request compatibility (old docs without approvalChain)
    if (!chain.length || !chain[idx]) {
      if (action === "approve") {
        await updateDoc(ref, {
          status: "approved",
          final_status: "approved",
          approverUid: "",
          approverEmail: "",
          approverRole: "",
          finalApprovedBy: {
            uid,
            email,
            name: meName,
            role: meRole,
            at: new Date().toISOString(),
          },
          updatedAt: serverTimestamp(),
        });

        await createLeaveNotification({
          toUserId: req.userId,
          toEmails: [req.userEmail].filter(Boolean),
          title: `${REQUEST_TYPE_LABEL[req.type] || "Request"} approved`,
          message: `Your ${REQUEST_TYPE_LABEL[req.type] || "request"} (${req.from} → ${req.to}) is approved.`,
          leaveId: req.id,
        });

        alert("Approved successfully");
      } else {
        const reasonText = String(rejectReasonById[req.id] || "").trim();
        if (!reasonText) {
          alert("Rejection reason is required");
          return;
        }

        await updateDoc(ref, {
          status: "rejected",
          final_status: "rejected",
          rejectReason: reasonText,
          approverUid: "",
          approverEmail: "",
          approverRole: "",
          rejectedBy: {
            uid,
            email,
            name: meName,
            role: meRole,
            at: new Date().toISOString(),
          },
          updatedAt: serverTimestamp(),
        });

        await createLeaveNotification({
          toUserId: req.userId,
          toEmails: [req.userEmail].filter(Boolean),
          title: `${REQUEST_TYPE_LABEL[req.type] || "Request"} rejected`,
          message: `Rejected by ${meName} (${titleCase(meRole)}). Reason: ${reasonText}`,
          leaveId: req.id,
        });

        setRejectingId("");
        setRejectReasonById((prev) => ({ ...prev, [req.id]: "" }));
        alert("Rejected successfully");
      }

      await wait(120);
      await Promise.all([loadMyRequests(), loadPendingForMe()]);
      return;
    }

    if (action === "approve") {
      chain[idx] = {
        ...chain[idx],
        status: "approved",
        actedAt: new Date().toISOString(),
        actionBy: { uid, email, name: meName, role: meRole },
        actionReason: "",
      };

      const hasNext = idx + 1 < chain.length;

      if (hasNext) {
        const next = chain[idx + 1];
        await updateDoc(ref, {
          approvalChain: chain,
          currentApprovalIndex: idx + 1,
          approverUid: next.uid || "",
          approverEmail: next.email || "",
          approverRole: next.role || "",
          status: "pending",
          final_status: "pending",
          updatedAt: serverTimestamp(),
        });

        await createLeaveNotification({
          toUserId: req.userId,
          toEmails: [req.userEmail].filter(Boolean),
          title: `${REQUEST_TYPE_LABEL[req.type] || "Request"} progressed`,
          message: `Approved by ${meName} (${titleCase(meRole)}). Pending with ${next.name} (${titleCase(next.role)}).`,
          leaveId: req.id,
        });

        await createLeaveNotification({
          toUserId: next.uid || null,
          toRole: next.uid ? null : next.role,
          toEmails: [next.email].filter(Boolean),
          title: `${REQUEST_TYPE_LABEL[req.type] || "Leave"} approval required`,
          message: `${req.userName || req.userEmail} requested ${REQUEST_TYPE_LABEL[req.type] || "Leave"} (${req.from} → ${req.to}).`,
          leaveId: req.id,
        });
      } else {
        await updateDoc(ref, {
          approvalChain: chain,
          currentApprovalIndex: idx,
          approverUid: "",
          approverEmail: "",
          approverRole: "",
          status: "approved",
          final_status: "approved",
          finalApprovedBy: {
            uid,
            email,
            name: meName,
            role: meRole,
            at: new Date().toISOString(),
          },
          updatedAt: serverTimestamp(),
        });

        await createLeaveNotification({
          toUserId: req.userId,
          toEmails: [req.userEmail].filter(Boolean),
          title: `${REQUEST_TYPE_LABEL[req.type] || "Request"} approved`,
          message: `Your ${REQUEST_TYPE_LABEL[req.type] || "request"} (${req.from} → ${req.to}) is fully approved.`,
          leaveId: req.id,
        });
      }
      alert("Approved successfully");
    } else {
      const reasonText = String(rejectReasonById[req.id] || "").trim();
      if (!reasonText) {
        alert("Rejection reason is required");
        return;
      }

      chain[idx] = {
        ...chain[idx],
        status: "rejected",
        actedAt: new Date().toISOString(),
        actionBy: { uid, email, name: meName, role: meRole },
        actionReason: reasonText,
      };

      await updateDoc(ref, {
        approvalChain: chain,
        status: "rejected",
        final_status: "rejected",
        rejectReason: reasonText,
        approverUid: "",
        approverEmail: "",
        approverRole: "",
        rejectedBy: {
          uid,
          email,
          name: meName,
          role: meRole,
          at: new Date().toISOString(),
        },
        updatedAt: serverTimestamp(),
      });

      await createLeaveNotification({
        toUserId: req.userId,
        toEmails: [req.userEmail].filter(Boolean),
        title: `${REQUEST_TYPE_LABEL[req.type] || "Request"} rejected`,
        message: `Rejected by ${meName} (${titleCase(meRole)}). Reason: ${reasonText}`,
        leaveId: req.id,
      });

      setRejectingId("");
      setRejectReasonById((prev) => ({ ...prev, [req.id]: "" }));
      alert("Rejected successfully");
    }

    await wait(120);
    await Promise.all([loadMyRequests(), loadPendingForMe()]);
    } catch (e) {
      console.error("Leave approval action failed", e);
      alert(e?.message || "Action failed. Please try again.");
    } finally {
      setProcessingById((prev) => ({ ...prev, [req.id]: false }));
    }
  };

  /* ---------------- PENDING FOR ME ---------------- */

  useEffect(() => {
    loadPendingForMe();
  }, [email, isAdminRole]);

  const loadPendingForMe = async () => {
    if (!email) return;

    const TIMEOUT_MS = 3000;
    try {
      // Try SDK first
      try {
        const q = query(
          collection(db, "leaveRequests"),
          where("status", "==", "pending"),
          limit(200)
        );

        const sdkPromise = getDocs(q);
        const snap = await Promise.race([
          sdkPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
        ]);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
        setPendingForMe(rows.filter((r) => isMeCurrentApprover(r)));
        return;
      } catch (sdkErr) {
        console.warn('🟡 loadPendingForMe SDK failed, trying REST', sdkErr?.message);
      }

      // REST fallback
      try {
        const stored = localStorage.getItem('kp-user');
        const parsed = stored ? JSON.parse(stored) : null;
        const token = parsed?.idToken;

        if (token) {
          const data = await fetchCollectionREST('leaveRequests', token);
          const filtered = data.filter(d => isMeCurrentApprover(d));
          setPendingForMe(filtered);
          return;
        }
      } catch (restErr) {
        console.warn('⚠️ REST fallback failed', restErr?.message);
      }

      setPendingForMe([]);
    } catch (e) {
      console.error("loadPendingForMe error:", e);
      setPendingForMe([]);
    }
  };

  /* =====================================================
     UI
  ===================================================== */

  return (
    <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 8 }}>
      <h3>Leave / Comp-Off Request</h3>

      <label>Request Type</label>
      <select value={requestType} onChange={(e) => setRequestType(e.target.value)} style={input}>
        {REQUEST_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <label>From</label>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />

      <label>To</label>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />

      <label>Reason</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={textArea} />

      <button style={btn} onClick={submitLeave}>Submit Request</button>

      <hr />

      <h4>My Requests</h4>
      {myRequests.map((r) => (
        <div key={r.id} style={item}>
          <b>{REQUEST_TYPE_LABEL[r.type] || "Request"}: {r.from} → {r.to}</b>
          <p>Status: {r.status}</p>
          {Array.isArray(r.approvalChain) && Number.isInteger(r.currentApprovalIndex) && isPendingStatus(r.status) && r.approvalChain[r.currentApprovalIndex] ? (
            <p style={{ marginTop: 4, color: "#555" }}>
              Pending with: {r.approvalChain[r.currentApprovalIndex].name} ({titleCase(r.approvalChain[r.currentApprovalIndex].role)})
            </p>
          ) : null}
          {r.rejectReason && <p><b>Rejected:</b> {r.rejectReason}</p>}
        </div>
      ))}

      {pendingForMe.length > 0 && (
        <>
          <h4>Requests Waiting For Your Approval</h4>
          {pendingForMe.map((r) => (
            <div key={r.id} style={item}>
              <b>{r.userName}</b>
              <p><b>Type:</b> {REQUEST_TYPE_LABEL[r.type] || "Request"}</p>
              <p>{r.from} → {r.to}</p>
              <p>{r.reason}</p>
              <button
                style={{ ...btn, opacity: processingById[r.id] ? 0.6 : 1 }}
                onClick={() => handleAction(r, "approve")}
                disabled={!!processingById[r.id]}
              >
                {processingById[r.id] ? "Approving..." : "Approve"}
              </button>
              <button
                style={{ ...btnRed, opacity: processingById[r.id] ? 0.6 : 1 }}
                onClick={() => setRejectingId((prev) => (prev === r.id ? "" : r.id))}
                disabled={!!processingById[r.id]}
              >
                Reject
              </button>
              {rejectingId === r.id && (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={rejectReasonById[r.id] || ""}
                    onChange={(e) =>
                      setRejectReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="Rejection reason (required)"
                    style={textArea}
                  />
                  <button
                    style={{ ...btnRed, opacity: processingById[r.id] ? 0.6 : 1 }}
                    onClick={() => handleAction(r, "reject")}
                    disabled={!!processingById[r.id]}
                  >
                    {processingById[r.id] ? "Rejecting..." : "Confirm Reject"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* =====================================================
   STYLES
===================================================== */

const btn = {
  marginTop: 8,
  padding: "8px 12px",
  background: "#800000",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const btnRed = { ...btn, background: "#c50000" };

const item = {
  padding: 10,
  border: "1px solid #eee",
  borderRadius: 6,
  marginTop: 8,
  background: "#fafafa",
};

const input = {
  width: "100%",
  marginBottom: 8,
  padding: 6,
  borderRadius: 6,
  border: "1px solid #ccc",
};

const textArea = {
  width: "100%",
  height: 70,
  marginBottom: 8,
  padding: 6,
  borderRadius: 6,
  border: "1px solid #ccc",
};
