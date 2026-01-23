import React, { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";

/* =====================================================
   HELPERS
===================================================== */

const DIRECTOR_EMAIL = "khader@kapilpower.com";

const SALES_HEAD_USERS = [
  "saikiransingoji@kapilpower.com",
  "vasantha@kapilpower.com",
  "varalakshmi@kapilpower.com",
];

const getReportsToEmail = async (uid) => {
  const snap = await getDoc(doc(db, "Users", uid));
  return snap.exists() ? snap.data().reportsTo || "" : "";
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

  const [role, setRole] = useState("");

  const uid = user?.uid;
  const email = user?.email || "";

  /* ---------------- ROLE ---------------- */

  useEffect(() => {
    if (roleData?.role) {
      setRole(roleData.role.toLowerCase());
    }
  }, [roleData]);

  /* ---------------- MY REQUESTS ---------------- */

  useEffect(() => {
    if (!uid) return;
    loadMyRequests();
  }, [uid]);

  const loadMyRequests = async () => {
    const q = query(
      collection(db, "leaveRequests"),
      where("userId", "==", uid)
    );
    const snap = await getDocs(q);
    setMyRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  /* =====================================================
     SUBMIT LEAVE (FINAL LOGIC)
  ===================================================== */

  const submitLeave = async () => {
    if (!from || !to || !reason) {
      alert("Please fill all fields");
      return;
    }

    let approverEmail = "";
    let status = "";

    /* ---------- CONSULTANT ---------- */
    if (role === "consultant") {
      approverEmail = await getReportsToEmail(uid); // zonal
      status = "pending_zonal";
    }

    /* ---------- ZONAL MANAGER ---------- */
    else if (role === "zonal_manager") {
      approverEmail = await getReportsToEmail(uid); // state head
      status = "pending_state";
    }

    /* ---------- STATE HEAD ---------- */
    else if (role === "state_head") {
      approverEmail = await getReportsToEmail(uid); // sales head
      status = "pending_sales";
    }

    /* ---------- SALES HEAD ---------- */
    else if (
      role === "sales_head" ||
      SALES_HEAD_USERS.includes(email)
    ) {
      approverEmail = DIRECTOR_EMAIL;
      status = "pending_director";
    }

    /* ---------- FALLBACK ---------- */
    else {
      approverEmail = DIRECTOR_EMAIL;
      status = "pending_director";
    }

    if (!approverEmail) {
      alert("Reporting manager not configured");
      return;
    }

    await addDoc(collection(db, "leaveRequests"), {
      userId: uid,
      userName: user.displayName || email,
      userEmail: email,
      from,
      to,
      reason,
      type: requestType,
      approverEmail,
      status,
      createdAt: serverTimestamp(),
    });

    alert("Leave request submitted");
    setFrom("");
    setTo("");
    setReason("");
    loadMyRequests();
  };

  /* =====================================================
     APPROVAL ACTION
  ===================================================== */

  const handleAction = async (req, action) => {
    const ref = doc(db, "leaveRequests", req.id);

    if (action === "approve") {
      /* FINAL APPROVAL BY DIRECTOR */
      if (email === DIRECTOR_EMAIL) {
        await updateDoc(ref, { status: "approved" });
      } else {
        const nextApprover = await getReportsToEmail(req.userId);

        await updateDoc(ref, {
          approverEmail: nextApprover || DIRECTOR_EMAIL,
          status:
            req.status === "pending_sales"
              ? "pending_director"
              : "pending",
        });
      }
    } else {
      const reason = prompt("Rejection reason:");
      if (!reason) return;
      await updateDoc(ref, {
        status: "rejected",
        rejectReason: reason,
      });
    }

    loadMyRequests();
    loadPendingForMe();
  };

  /* ---------------- PENDING FOR ME ---------------- */

  useEffect(() => {
    loadPendingForMe();
  }, [email]);

  const loadPendingForMe = async () => {
    if (!email) return;

    const q = query(
      collection(db, "leaveRequests"),
      where("approverEmail", "==", email),
      where("status", "in", [
        "pending",
        "pending_zonal",
        "pending_state",
        "pending_sales",
        "pending_director",
      ])
    );

    const snap = await getDocs(q);
    setPendingForMe(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  /* =====================================================
     UI
  ===================================================== */

  return (
    <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 8 }}>
      <h3>Leave / Comp-Off Request</h3>

      <label>Request Type</label>
      <select value={requestType} onChange={(e) => setRequestType(e.target.value)} style={input}>
        <option value="leave">Leave</option>
        <option value="comp_off">Comp-Off</option>
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
          <b>{r.from} → {r.to}</b>
          <p>Status: {r.status}</p>
          {r.rejectReason && <p><b>Rejected:</b> {r.rejectReason}</p>}
        </div>
      ))}

      {pendingForMe.length > 0 && (
        <>
          <h4>Requests Waiting For Your Approval</h4>
          {pendingForMe.map((r) => (
            <div key={r.id} style={item}>
              <b>{r.userName}</b>
              <p>{r.from} → {r.to}</p>
              <p>{r.reason}</p>
              <button style={btn} onClick={() => handleAction(r, "approve")}>Approve</button>
              <button style={btnRed} onClick={() => handleAction(r, "reject")}>Reject</button>
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
