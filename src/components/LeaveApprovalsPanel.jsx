import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";

const REQUEST_TYPE_LABELS = {
  leave: "Leave",
  comp_off: "Comp-Off",
  early_checkin: "Early Check-In",
  early_checkout: "Early Check-Out",
};

const norm = (v) => String(v || "").trim().toLowerCase();

const roleAlias = {
  saleshead: "sales_head",
  "sales head": "sales_head",
  hroperationsmanager: "agm",
  "hr operations manager": "agm",
  hr_operations_manager: "agm",
  agm: "agm",
  financemanager: "dgm",
  finance_manager: "dgm",
  dgm: "dgm",
  hrexecutive: "hr_executive",
  "hr executive": "hr_executive",
};

const canonicalRole = (v) => {
  const n = norm(v).replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  const compact = n.replace(/_/g, "");
  return roleAlias[n] || roleAlias[compact] || n;
};

const ALLOWED_PANEL_ROLES = new Set([
  "admin",
  "sales_head",
  "director",
  "state_head",
  "team_lead",
  "zonal_manager",
  "hr",
  "agm",
  "dgm",
  "hr_executive",
]);

const BULK_ACTION_ROLES = new Set([
  "admin",
  "sales_head",
  "director",
  "dgm",
  "agm",
  "hr_executive",
]);

const ANYTIME_APPROVER_ROLES = new Set([
  "zonal_manager",
  "state_head",
  "team_lead",
  "sales_head",
  "agm",
  "dgm",
  "admin",
  "director",
]);

const roleToPendingStatus = (role) => {
  const r = norm(role);
  if (r === "zonal_manager") return "pending_zonal";
  if (r === "state_head") return "pending_state";
  if (r === "sales_head") return "pending_sales";
  if (r === "director") return "pending_director";
  return "pending";
};

const MANAGER_ROLE_REGEX = /manager/i;

const parseDateSafe = (v) => {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const csvEscape = (value) => {
  const raw = value == null ? "" : String(value);
  if (/[,"\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const isPendingRequest = (req) => {
  const status = norm(req?.status);
  const finalStatus = norm(req?.final_status);
  if (finalStatus === "approved" || finalStatus === "rejected") return false;
  if (!status) return true;
  return status.startsWith("pending") || status === "in_progress" || status === "pending_approval";
};

const isFinalizedRequest = (req) => {
  const status = norm(req?.status);
  const finalStatus = norm(req?.final_status);
  return ["approved", "rejected"].includes(finalStatus) || ["approved", "rejected"].includes(status);
};

const getApprovalChain = (req) => (Array.isArray(req?.approvalChain) ? req.approvalChain : []);

const getCurrentApprover = (req) => {
  const chain = getApprovalChain(req);
  const idxRaw = Number(req?.currentApprovalIndex);
  const idx = Number.isFinite(idxRaw) ? idxRaw : 0;
  if (chain[idx]) return chain[idx];

  return {
    uid: req?.approverUid || "",
    email: req?.approverEmail || "",
    role: req?.approverRole || "",
  };
};

const userNameFromAny = (u = {}) =>
  u.Name || u.name || u.fullName || u.displayName || "";

const userEmailFromAny = (u = {}) =>
  norm(u.email || u.Email || u.mail || u.Mail || "");

const prettifyEmailLocalPart = (email = "") => {
  const local = String(email || "").split("@")[0] || "";
  if (!local) return "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
};

const findUserByAnyRef = (usersMap, rawRef) => {
  const ref = norm(rawRef);
  if (!ref) return null;

  if (usersMap[ref]) return usersMap[ref];

  const all = Object.values(usersMap || {});
  return all.find((u) => {
    const uid = norm(u.id || u.uid || u.userId);
    const email = userEmailFromAny(u);
    return uid === ref || email === ref;
  }) || null;
};

const resolveManagerFromRequester = (usersMap, requester = {}, row = {}) => {
  const managerRefs = [
    requester.managerUID,
    requester.managerUid,
    requester.managerId,
    requester.reportsTo,
    requester.reportingTo,
    requester.reporting_to,
    row.managerUID,
    row.managerUid,
    row.managerId,
    row.reportsTo,
    row.reportingTo,
    row.reporting_to,
    row.reportsToEmail,
    row.reports_to_email,
    row.reportingManagerEmail,
    row.reporting_manager_email,
  ];

  let manager = null;
  for (const candidate of managerRefs) {
    manager = findUserByAnyRef(usersMap, candidate);
    if (manager) break;
  }

  const managerEmail =
    userEmailFromAny(manager || {}) ||
    norm(
      row.reportsToEmail ||
      row.reports_to_email ||
      row.reportingManagerEmail ||
      row.reporting_manager_email ||
      requester.reportsToEmail ||
      requester.reports_to_email ||
      requester.reportingManagerEmail ||
      requester.reporting_manager_email ||
      requester.reportsTo ||
      row.reportsTo ||
      ""
    );

  const managerName =
    userNameFromAny(manager || {}) ||
    row.reportsToName ||
    row.reports_to_name ||
    row.reportingManagerName ||
    row.reporting_manager_name ||
    requester.reportsToName ||
    requester.reports_to_name ||
    requester.reportingManagerName ||
    requester.reporting_manager_name ||
    "";

  return {
    uid: manager?.id || "",
    role: norm(manager?.role || manager?.Role || ""),
    email: managerEmail,
    name: managerName,
  };
};

const readableDateTime = (val) => {
  const d = parseDateSafe(val);
  if (!d) return "-";
  return d.toLocaleString();
};

const buildManagerPathFromMap = (usersMap, requesterUid) => {
  const out = [];
  const seen = new Set();
  let cursorUid = requesterUid;

  for (let i = 0; i < 8; i += 1) {
    if (!cursorUid || seen.has(cursorUid)) break;
    seen.add(cursorUid);

    const user = usersMap[cursorUid] || {};
    const managerInfo = resolveManagerFromRequester(usersMap, user, user);
    if (!managerInfo?.email && !managerInfo?.uid) break;

    const manager = managerInfo.uid ? (usersMap[managerInfo.uid] || findUserByAnyRef(usersMap, managerInfo.email)) : findUserByAnyRef(usersMap, managerInfo.email);
    const managerRole = norm(managerInfo.role || manager?.role || manager?.Role);

    out.push({
      uid: managerInfo.uid || manager?.id || "",
      email: managerInfo.email || "",
      role: managerRole,
    });

    if (!(managerInfo.uid || manager?.id)) break;
    cursorUid = managerInfo.uid || manager.id;
  }

  return out;
};

const buildConsultantChainFromMap = (usersMap, requesterUid) => {
  const path = buildManagerPathFromMap(usersMap, requesterUid);
  if (!path.length) return [];

  const zonal = path.find((x) => norm(x.role) === "zonal_manager") || null;
  const zonalIdx = zonal ? path.indexOf(zonal) : -1;
  const state = path.slice(zonalIdx >= 0 ? zonalIdx + 1 : 0).find((x) => norm(x.role) === "state_head") || null;
  const stateIdx = state ? path.indexOf(state) : -1;
  const sales = path
    .slice(stateIdx >= 0 ? stateIdx + 1 : zonalIdx >= 0 ? zonalIdx + 1 : 0)
    .find((x) => norm(x.role) === "sales_head") || null;

  const chain = [zonal, state, sales].filter(Boolean);
  if (chain.length) return chain;

  return path;
};

export default function LeaveApprovalsPanel({
  externalBelongsToFilter = null,
  onExternalBelongsToFilterChange = null,
}) {
  const { user, roleData } = useAuth();

  const [rows, setRows] = useState([]);
  const [usersById, setUsersById] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState({});
  const [actionBusy, setActionBusy] = useState(false);
  const [processingIds, setProcessingIds] = useState({});

  const [queue, setQueue] = useState("pending_my_action");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [belongsToFilter, setBelongsToFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const myUid = user?.uid || "";

  const sessionRole = (() => {
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.role || "";
    } catch {
      return "";
    }
  })();

  const myRole = canonicalRole(roleData?.role || user?.role || sessionRole);
  const myEmail = norm(user?.email || roleData?.email || roleData?.Email || "");
  const myName = roleData?.Name || roleData?.name || user?.displayName || user?.email || "Approver";

  const canViewPanel = ALLOWED_PANEL_ROLES.has(myRole);
  const canBulkModerate = BULK_ACTION_ROLES.has(myRole);

  const isBelongsToExternallyControlled =
    typeof externalBelongsToFilter === "string" &&
    typeof onExternalBelongsToFilterChange === "function";

  const effectiveBelongsToFilter = isBelongsToExternallyControlled
    ? externalBelongsToFilter
    : belongsToFilter;

  const loadData = async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const [leaveDocs, userDocs] = await Promise.all([
        fetchCollectionDocs("leaveRequests"),
        fetchCollectionDocs("Users"),
      ]);

      const usersMap = {};
      userDocs.forEach((u) => {
        if (!u?.id) return;
        usersMap[u.id] = { ...u };
      });

      const leaveRows = leaveDocs
        .filter((r) => !!r?.id)
        .map((r) => ({ ...r }))
        .sort((a, b) => {
          const aDate = parseDateSafe(a.createdAt)?.getTime() || 0;
          const bDate = parseDateSafe(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

      const repairs = [];
      const repairedRows = leaveRows.map((row) => {
        const userMeta = usersMap[row.userId] || {};
        const role = norm(userMeta.role || userMeta.Role || row.userRole);
        const status = norm(row.status);
        const finalStatus = norm(row.final_status);
        const currentApprover = getCurrentApprover(row);
        const isConsultant = role === "consultant";
        const wronglyAtDirector = status === "pending_director" || norm(currentApprover.role || row.approverRole) === "director";

        if (!isConsultant || !wronglyAtDirector) return row;
        if (finalStatus === "approved" || finalStatus === "rejected") return row;

        const chain = buildConsultantChainFromMap(usersMap, row.userId);
        const first = chain[0] || null;
        if (!first?.email) return row;

        repairs.push(
          updateDoc(doc(db, "leaveRequests", row.id), {
            approvalChain: chain,
            currentApprovalIndex: 0,
            approverUid: first.uid || "",
            approverEmail: first.email,
            approverRole: first.role || "",
            status: roleToPendingStatus(first.role),
            updatedAt: serverTimestamp(),
          })
        );

        return {
          ...row,
          approvalChain: chain,
          currentApprovalIndex: 0,
          approverUid: first.uid || "",
          approverEmail: first.email,
          approverRole: first.role || "",
          status: roleToPendingStatus(first.role),
        };
      });

      if (repairs.length) {
        await Promise.allSettled(repairs);
      }

      setUsersById(usersMap);
      setRows(repairedRows);
    } catch (err) {
      console.error("Leave approvals load failed:", err);
      alert("Failed to load leave approvals.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getUserMeta = (row) => {
    const u = usersById[row.userId] || {};
    return {
      role: norm(u.role || row.userRole),
      state: String(u.state || u.State || row.state || "").trim(),
      zone: String(u.zone || u.Zone || row.zone || "").trim(),
      belongsTo: String(u.belongsTo || u.belongs_to || u.team || "").trim().toLowerCase(),
      name: u.Name || u.name || row.userName || row.userEmail || row.userId,
      email: norm(u.email || row.userEmail),
    };
  };

  const getResolvedApprover = (row, usersMap = {}) => {
    const current = getCurrentApprover(row);
    const currentEmail = norm(current.email || row.approverEmail);
    const currentRole = norm(current.role || row.approverRole);
    const currentName =
      row.approverName ||
      row.approver_name ||
      row.currentApproverName ||
      row.current_approver_name ||
      "";

    if (currentEmail || current.uid) {
      const currentUser = current.uid ? (usersMap[current.uid] || null) : findUserByAnyRef(usersMap, currentEmail);
      return {
        email: currentEmail || userEmailFromAny(currentUser || {}),
        name: currentName || userNameFromAny(currentUser || {}),
        role: currentRole,
        inferred: false,
      };
    }

    const requester = usersMap[row.userId] || {};
    const managerInfo = resolveManagerFromRequester(usersMap, requester, row);
    if (managerInfo.email || managerInfo.uid) {
      const manager = managerInfo.uid
        ? (usersMap[managerInfo.uid] || findUserByAnyRef(usersMap, managerInfo.email) || {})
        : (findUserByAnyRef(usersMap, managerInfo.email) || {});
      return {
        email: managerInfo.email || userEmailFromAny(manager),
        name: managerInfo.name || userNameFromAny(manager),
        role: norm(managerInfo.role || manager.role || manager.Role),
        inferred: true,
      };
    }

    return {
      email: "",
      name: "",
      role: currentRole,
      inferred: false,
    };
  };

  const canActOn = (row) => {
    if (!isPendingRequest(row)) return false;
    if (ANYTIME_APPROVER_ROLES.has(myRole)) return true;
    if (canBulkModerate) return true;

    const current = getCurrentApprover(row);
    const resolvedApprover = getResolvedApprover(row, usersById);
    const approverUid = norm(current.uid || row.approverUid);
    const approverEmail = norm(resolvedApprover.email || current.email || row.approverEmail);
    const approverRole = norm(resolvedApprover.role || current.role || row.approverRole);

    if (approverUid && myUid && approverUid === norm(myUid)) return true;
    if (approverEmail && myEmail && approverEmail === myEmail) return true;
    if (approverRole && myRole && approverRole === myRole) return true;

    if (MANAGER_ROLE_REGEX.test(myRole) && MANAGER_ROLE_REGEX.test(approverRole)) {
      return true;
    }

    return false;
  };

  const roleOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const role = getUserMeta(r).role;
      if (role) set.add(role);
    });
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, usersById]);

  const stateOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const st = getUserMeta(r).state;
      if (st) set.add(st);
    });
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, usersById]);

  const zoneOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const z = getUserMeta(r).zone;
      if (z) set.add(z);
    });
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, usersById]);

  const belongsToOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const b = getUserMeta(r).belongsTo;
      if (b) set.add(b);
    });
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, usersById]);

  const filteredRows = useMemo(() => {
    const term = norm(search);
    return rows.filter((row) => {
      const meta = getUserMeta(row);
      const type = norm(row.type);
      const finalStatus = norm(row.final_status);
      const status = norm(row.status);
      const isPending = isPendingRequest(row);
      const canAct = canActOn(row);
      const isFinalized = isFinalizedRequest(row);

      if (queue === "pending_my_action" && (!isPending || !canAct)) return false;
      if (queue === "all_pending" && !isPending) return false;
      if (queue === "history" && !isFinalized) return false;

      if (statusFilter !== "all") {
        const targetStatus = statusFilter === "approved" || statusFilter === "rejected" ? finalStatus || status : status;
        if (targetStatus !== statusFilter) return false;
      }

      if (typeFilter !== "all" && type !== typeFilter) return false;
      if (roleFilter !== "all" && meta.role !== roleFilter) return false;
      if (effectiveBelongsToFilter !== "all" && meta.belongsTo !== effectiveBelongsToFilter) return false;
      if (stateFilter !== "all" && meta.state !== stateFilter) return false;
      if (zoneFilter !== "all" && meta.zone !== zoneFilter) return false;

      if (fromDate && row.from && row.from < fromDate) return false;
      if (toDate && row.to && row.to > toDate) return false;

      if (term) {
        const blob = [
          row.id,
          meta.name,
          row.userEmail,
          row.reason,
          type,
          status,
          finalStatus,
          meta.state,
          meta.zone,
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(term)) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, usersById, queue, statusFilter, typeFilter, roleFilter, effectiveBelongsToFilter, stateFilter, zoneFilter, fromDate, toDate, search, myUid, myEmail, myRole]);

  const userNameByEmail = useMemo(() => {
    const map = {};

    Object.values(usersById || {}).forEach((u) => {
      const email = userEmailFromAny(u);
      const name = userNameFromAny(u);
      if (email && name) map[email] = name;
    });

    rows.forEach((r) => {
      const approverEmail = norm(r.approverEmail || r.approver_email || r.currentApproverEmail || r.current_approver_email || "");
      const approverName =
        r.approverName ||
        r.approver_name ||
        r.currentApproverName ||
        r.current_approver_name ||
        "";
      if (approverEmail && approverName && !map[approverEmail]) {
        map[approverEmail] = approverName;
      }
    });

    return map;
  }, [usersById, rows]);

  useEffect(() => {
    setSelectedIds({});
  }, [queue, statusFilter, typeFilter, roleFilter, effectiveBelongsToFilter, stateFilter, zoneFilter, fromDate, toDate, search]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectableRows = filteredRows.filter((r) => canActOn(r));
  const selectedActionableRows = selectableRows.filter((r) => selectedIds[r.id]);

  const selectAllCurrent = () => {
    const next = {};
    selectableRows.forEach((r) => {
      next[r.id] = true;
    });
    setSelectedIds(next);
  };

  const clearSelection = () => setSelectedIds({});

  const writeNotification = async ({ toUid, toEmail, title, body, relatedId }) => {
    try {
      const cleanEmail = norm(toEmail);
      await addDoc(collection(db, "notifications"), {
        toUid: toUid || "",
        toEmail: cleanEmail || "",
        toUserId: toUid || "",
        toEmails: cleanEmail ? [cleanEmail] : [],
        type: "leave_request_update",
        module: "attendance",
        route: "/attendance",
        title,
        subject: title,
        body,
        message: body,
        referenceType: "leave_request",
        referenceId: relatedId,
        active: true,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn("Notification write failed:", err);
    }
  };

  const applyApprove = async (row) => {
    const ref = doc(db, "leaveRequests", row.id);
    const freshSnap = await getDoc(ref);
    if (!freshSnap.exists()) throw new Error("Leave request not found.");

    const fresh = { id: freshSnap.id, ...freshSnap.data() };
    if (!isPendingRequest(fresh)) return { skipped: true };

    const chain = getApprovalChain(fresh);
    const idxRaw = Number(fresh.currentApprovalIndex);
    const currentIndex = Number.isFinite(idxRaw) ? idxRaw : 0;
    const hasChain = chain.length > 0;

    const actor = {
      uid: myUid,
      email: user?.email || "",
      role: myRole,
      name: myName,
    };

    const logEntry = {
      action: "approved",
      at: new Date().toISOString(),
      by: actor,
    };

    if (hasChain && currentIndex < chain.length - 1) {
      const nextIndex = currentIndex + 1;
      const next = chain[nextIndex] || {};

      await updateDoc(ref, {
        status: "pending",
        currentApprovalIndex: nextIndex,
        approverUid: next.uid || "",
        approverEmail: next.email || "",
        approverRole: next.role || "",
        updatedAt: serverTimestamp(),
        actionLogs: arrayUnion(logEntry),
      });

      await writeNotification({
        toUid: fresh.userId,
        toEmail: fresh.userEmail,
        relatedId: fresh.id,
        title: "Leave request moved to next approver",
        body: `Your ${REQUEST_TYPE_LABELS[fresh.type] || fresh.type || "leave"} request is progressing through approval flow.`,
      });

      await writeNotification({
        toUid: next.uid,
        toEmail: next.email,
        relatedId: fresh.id,
        title: "Leave request pending your approval",
        body: `${fresh.userName || fresh.userEmail || "Employee"} has a request waiting for your action.`,
      });

      return { moved: true };
    }

    await updateDoc(ref, {
      status: "approved",
      final_status: "approved",
      finalApprovedBy: actor,
      finalApprovedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      actionLogs: arrayUnion(logEntry),
    });

    await writeNotification({
      toUid: fresh.userId,
      toEmail: fresh.userEmail,
      relatedId: fresh.id,
      title: "Leave request approved",
      body: `Your ${REQUEST_TYPE_LABELS[fresh.type] || fresh.type || "leave"} request has been approved.`,
    });

    return { finalized: true };
  };

  const applyReject = async (row, rejectReason) => {
    const reason = String(rejectReason || "").trim();
    if (!reason) throw new Error("Rejection reason is required.");

    const ref = doc(db, "leaveRequests", row.id);
    const freshSnap = await getDoc(ref);
    if (!freshSnap.exists()) throw new Error("Leave request not found.");

    const fresh = { id: freshSnap.id, ...freshSnap.data() };
    if (!isPendingRequest(fresh)) return { skipped: true };

    const actor = {
      uid: myUid,
      email: user?.email || "",
      role: myRole,
      name: myName,
    };

    await updateDoc(ref, {
      status: "rejected",
      final_status: "rejected",
      rejectedBy: actor,
      rejectReason: reason,
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      actionLogs: arrayUnion({
        action: "rejected",
        reason,
        at: new Date().toISOString(),
        by: actor,
      }),
    });

    await writeNotification({
      toUid: fresh.userId,
      toEmail: fresh.userEmail,
      relatedId: fresh.id,
      title: "Leave request rejected",
      body: `Your ${REQUEST_TYPE_LABELS[fresh.type] || fresh.type || "leave"} request was rejected. Reason: ${reason}`,
    });

    return { finalized: true };
  };

  const runBulkAction = async (action) => {
    if (!canBulkModerate) {
      alert("You do not have bulk approval access.");
      return;
    }
    if (!selectedActionableRows.length) {
      alert("Select at least one actionable request.");
      return;
    }

    const reason = action === "reject" ? prompt("Enter rejection reason (applies to all selected):") : "";
    if (action === "reject" && !String(reason || "").trim()) {
      alert("Rejection reason is required.");
      return;
    }

    setActionBusy(true);
    const nextBusyMap = {};
    selectedActionableRows.forEach((r) => {
      nextBusyMap[r.id] = true;
    });
    setProcessingIds(nextBusyMap);

    let success = 0;
    let failed = 0;

    try {
      for (const row of selectedActionableRows) {
        try {
          if (action === "approve") {
            await applyApprove(row);
          } else {
            await applyReject(row, reason);
          }
          success += 1;
        } catch (err) {
          console.error(`Bulk ${action} failed for ${row.id}:`, err);
          failed += 1;
        }
      }

      await loadData({ silent: true });
      clearSelection();

      const msg = `${action === "approve" ? "Approved" : "Rejected"}: ${success}` +
        (failed ? `, Failed: ${failed}` : "");
      alert(msg);
    } finally {
      setActionBusy(false);
      setProcessingIds({});
    }
  };

  const runSingleAction = async (row, action) => {
    if (!canActOn(row)) return;

    const reason = action === "reject" ? prompt("Enter rejection reason:") : "";
    if (action === "reject" && !String(reason || "").trim()) {
      alert("Rejection reason is required.");
      return;
    }

    setProcessingIds((prev) => ({ ...prev, [row.id]: true }));
    try {
      if (action === "approve") await applyApprove(row);
      else await applyReject(row, reason);
      await loadData({ silent: true });
    } catch (err) {
      console.error(`Single ${action} failed:`, err);
      alert(err?.message || `Failed to ${action} request.`);
    } finally {
      setProcessingIds((prev) => ({ ...prev, [row.id]: false }));
    }
  };

  const exportAuditCsv = () => {
    if (!filteredRows.length) {
      alert("No rows to export.");
      return;
    }

    const headers = [
      "requestId",
      "employee",
      "email",
      "type",
      "from",
      "to",
      "status",
      "final_status",
      "belongs_to",
      "state",
      "zone",
      "approval_chain_length",
      "current_approval_index",
      "approver_email",
      "approved_by",
      "rejected_by",
      "reject_reason",
      "created_at",
      "updated_at",
    ];

    const body = filteredRows.map((row) => {
      const meta = getUserMeta(row);
      const chainLen = getApprovalChain(row).length;
      const resolvedApprover = getResolvedApprover(row, usersById);
      const approvedBy = row.finalApprovedBy?.name || row.finalApprovedBy?.email || "";
      const rejectedBy = row.rejectedBy?.name || row.rejectedBy?.email || "";

      return [
        row.id,
        meta.name,
        row.userEmail || meta.email,
        REQUEST_TYPE_LABELS[row.type] || row.type || "",
        row.from || "",
        row.to || "",
        row.status || "",
        row.final_status || "",
        meta.belongsTo || "",
        meta.state,
        meta.zone,
        chainLen,
        row.currentApprovalIndex ?? "",
        resolvedApprover.email || row.approverEmail || "",
        approvedBy,
        rejectedBy,
        row.rejectReason || "",
        readableDateTime(row.createdAt),
        readableDateTime(row.updatedAt),
      ]
        .map(csvEscape)
        .join(",");
    });

    const csv = [headers.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leave-approvals-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canViewPanel) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.empty}>You are not authorized to view this panel.</div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={{ margin: 0, color: "#800000" }}>Leave Approvals Console</h3>
          <small style={{ color: "#666" }}>
            Filters + bulk actions + audit export for admin/director workflows.
          </small>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.secondaryBtn} onClick={() => loadData({ silent: true })}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button style={styles.primaryBtn} onClick={exportAuditCsv}>Export Audit CSV</button>
        </div>
      </div>

      <div style={styles.filterGrid}>
        <select value={queue} onChange={(e) => setQueue(e.target.value)} style={styles.select}>
          <option value="pending_my_action">Pending My Action</option>
          <option value="all_pending">All Pending</option>
          <option value="history">History</option>
        </select>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={styles.select}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={styles.select}>
          <option value="all">All Types</option>
          <option value="leave">Leave</option>
          <option value="comp_off">Comp-Off</option>
          <option value="early_checkin">Early Check-In</option>
          <option value="early_checkout">Early Check-Out</option>
        </select>

        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={styles.select}>
          <option value="all">All Roles</option>
          {roleOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <select
          value={effectiveBelongsToFilter}
          onChange={(e) => {
            const next = e.target.value;
            if (isBelongsToExternallyControlled) onExternalBelongsToFilterChange(next);
            else setBelongsToFilter(next);
          }}
          style={styles.select}
        >
          <option value="all">All Teams</option>
          {belongsToOptions.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={styles.select}>
          <option value="all">All States</option>
          {stateOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} style={styles.select}>
          <option value="all">All Zones</option>
          {zoneOptions.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>

        <input
          style={styles.input}
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          type="date"
        />
        <input
          style={styles.input}
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          type="date"
        />
        <input
          style={styles.input}
          placeholder="Search name/email/reason..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={styles.bulkBar}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={styles.secondaryBtn} onClick={selectAllCurrent}>Select All Actionable</button>
          <button style={styles.secondaryBtn} onClick={clearSelection}>Clear Selection</button>
          <span style={{ fontSize: 13, color: "#555" }}>
            Selected actionable: {selectedActionableRows.length}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...styles.primaryBtn, opacity: actionBusy ? 0.6 : 1 }}
            onClick={() => runBulkAction("approve")}
            disabled={actionBusy || !canBulkModerate}
          >
            {actionBusy ? "Processing..." : "Bulk Approve"}
          </button>
          <button
            style={{ ...styles.dangerBtn, opacity: actionBusy ? 0.6 : 1 }}
            onClick={() => runBulkAction("reject")}
            disabled={actionBusy || !canBulkModerate}
          >
            {actionBusy ? "Processing..." : "Bulk Reject"}
          </button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <div style={styles.empty}>Loading leave approvals...</div>
        ) : filteredRows.length === 0 ? (
          <div style={styles.empty}>No matching leave requests found.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Select</th>
                <th style={styles.th}>Employee</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Dates</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>State</th>
                <th style={styles.th}>Approver</th>
                <th style={styles.th}>Reason</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const meta = getUserMeta(row);
                const canAct = canActOn(row);
                const busy = !!processingIds[row.id];
                const current = getCurrentApprover(row);
                const resolvedApprover = getResolvedApprover(row, usersById);
                const approverEmail = resolvedApprover.email || current.email || row.approverEmail || "";
                const approverName =
                  resolvedApprover.name ||
                  userNameByEmail[norm(approverEmail)] ||
                  prettifyEmailLocalPart(approverEmail) ||
                  "-";
                return (
                  <tr key={row.id}>
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={!!selectedIds[row.id]}
                        disabled={!canAct || busy}
                        onChange={() => toggleSelect(row.id)}
                      />
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600 }}>{meta.name}</div>
                      <div style={styles.small}>{row.userEmail || meta.email || "-"}</div>
                      <div style={styles.small}>Role: {meta.role || "-"}</div>
                    </td>
                    <td style={styles.td}>{REQUEST_TYPE_LABELS[row.type] || row.type || "-"}</td>
                    <td style={styles.td}>
                      <div>{row.from || "-"} → {row.to || "-"}</div>
                      <div style={styles.small}>Created: {readableDateTime(row.createdAt)}</div>
                    </td>
                    <td style={styles.td}>
                      <div>{row.final_status || row.status || "pending"}</div>
                      <div style={styles.small}>Raw: {row.status || "-"}</div>
                    </td>
                    <td style={styles.td}>
                      <div>{meta.state || "-"}</div>
                      <div style={styles.small}>Zone: {meta.zone || "-"}</div>
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600 }}>{approverName}</div>
                      <div>{approverEmail || "-"}</div>
                      <div style={styles.small}>{resolvedApprover.role || current.role || row.approverRole || "-"}</div>
                      {resolvedApprover.inferred && (
                        <div style={styles.small}>(from reporting manager)</div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <div style={{ maxWidth: 220, whiteSpace: "pre-wrap" }}>{row.reason || "-"}</div>
                      {row.rejectReason && <div style={{ ...styles.small, color: "#c0392b" }}>Rejected: {row.rejectReason}</div>}
                    </td>
                    <td style={styles.td}>
                      {canAct ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button
                            style={{ ...styles.primaryBtn, padding: "6px 10px" }}
                            disabled={busy}
                            onClick={() => runSingleAction(row, "approve")}
                          >
                            {busy ? "Approving..." : "Approve"}
                          </button>
                          <button
                            style={{ ...styles.dangerBtn, padding: "6px 10px" }}
                            disabled={busy}
                            onClick={() => runSingleAction(row, "reject")}
                          >
                            {busy ? "Rejecting..." : "Reject"}
                          </button>
                        </div>
                      ) : (
                        <span style={styles.small}>No action</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 8,
  },
  bulkBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    border: "1px dashed #ddd",
    borderRadius: 8,
    padding: 8,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #eee",
    borderRadius: 8,
    maxHeight: 540,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    position: "sticky",
    top: 0,
    background: "#f3f4f6",
    color: "#111827",
    fontWeight: 700,
    borderBottom: "1px solid #d1d5db",
    padding: 8,
    zIndex: 3,
  },
  td: {
    borderBottom: "1px solid #f3f4f6",
    padding: 8,
    verticalAlign: "top",
  },
  primaryBtn: {
    border: "1px solid #800000",
    background: "#800000",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  secondaryBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  dangerBtn: {
    border: "1px solid #b91c1c",
    background: "#ef4444",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  select: {
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "8px 10px",
    background: "#fff",
  },
  input: {
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "8px 10px",
  },
  small: {
    fontSize: 12,
    color: "#6b7280",
  },
  empty: {
    padding: 20,
    textAlign: "center",
    color: "#666",
  },
};
