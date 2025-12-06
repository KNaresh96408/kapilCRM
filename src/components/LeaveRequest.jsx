import React, { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getUserRoleFromDB } from "../helpers/getUserRole";
import { useAuth } from "../context/AuthContext";


export default function LeaveRequest({ user }) {
  const { roleData } = useAuth();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [myRequests, setMyRequests] = useState([]);
  const [pendingForMe, setPendingForMe] = useState([]);
  const [role, setRole] = useState("");
  const [requestType, setRequestType] = useState("leave"); // "leave" or "comp_off"

  const uid = user?.uid;
  const email = user?.email || "";

useEffect(() => {
  if (roleData?.role) {
    setRole(roleData.role.toLowerCase()); // role = "admin", "state_head", etc.
  }
}, [roleData]);

  useEffect(() => {
    if (!uid) return;
    loadMyRequests();
  }, [uid]);

  const loadMyRequests = async () => {
    const q = query(collection(db, "leaveRequests"), where("userId", "==", uid));
    const snap = await getDocs(q);
    setMyRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const submitLeave = async () => {
    if (!from || !to || !reason) return alert("Please fill all fields");

    let status = "";
    let chain = {
      zonal_status: "n/a",
      state_status: "n/a",
      sales_status: "n/a",
      teamlead_status: "n/a",
      admin_status: "n/a",
    };

    if (role === "consultant") {
      status = "pending_zonal";
      chain.zonal_status = "pending";
    } else if (role === "admin") {
      status = "pending_sales";
      chain.sales_status = "pending";
    } else if (role === "state_head") {
      status = "pending_sales";
      chain.sales_status = "pending";
    } else if (role === "telesales") {
      status = "pending_teamlead";
      chain.teamlead_status = "pending";
    } else if (role === "team_lead") {
      status = "pending_sales";
      chain.sales_status = "pending";
    } else if (role === "mis_executive") {
      status = "pending_admin";
      chain.admin_status = "pending";
    } else {
      status = "pending_sales";
      chain.sales_status = "pending";
    }

    await addDoc(collection(db, "leaveRequests"), {
      userId: uid,
      userName: user.displayName || user.name || email,
      from,
      to,
      reason,
      status,
      type: requestType,
      ...chain,
      createdAt: serverTimestamp(),
    });

    alert("Request submitted");
    setFrom("");
    setTo("");
    setReason("");
    loadMyRequests();
  };

  const handleAction = async (req, action, rejectReason = "") => {
    const ref = doc(db, "leaveRequests", req.id);
    let update = {};

    if (role === "zonal_manager" && req.status === "pending_zonal") {
      update = action === "approve" ? { zonal_status: "approved", status: "pending_state" } : { zonal_status: "rejected", status: "rejected", rejectReason };
    }

    if (role === "state_head" && req.status === "pending_state") {
      update = action === "approve" ? { state_status: "approved", status: "pending_sales" } : { state_status: "rejected", status: "rejected", rejectReason };
    }

    if (role === "sales_head" && req.status === "pending_sales") {
      update = action === "approve" ? { sales_status: "approved", status: "approved" } : { sales_status: "rejected", status: "rejected", rejectReason };
    }

    if (role === "team_lead" && req.status === "pending_teamlead") {
      update = action === "approve" ? { teamlead_status: "approved", status: "pending_sales" } : { teamlead_status: "rejected", status: "rejected", rejectReason };
    }

    if (role === "admin" && req.status === "pending_admin") {
      update = action === "approve" ? { admin_status: "approved", status: "pending_sales" } : { admin_status: "rejected", status: "rejected", rejectReason };
    }

    await updateDoc(ref, update);
    alert("Updated");
    loadMyRequests();
    loadPendingForMe();
  };

  useEffect(() => {
    loadPendingForMe();
  }, [role]);

  const loadPendingForMe = async () => {
    let q;

    if (role === "zonal_manager")
      q = query(collection(db, "leaveRequests"), where("status", "==", "pending_zonal"));
    else if (role === "state_head")
      q = query(collection(db, "leaveRequests"), where("status", "==", "pending_state"));
    else if (role === "sales_head")
      q = query(collection(db, "leaveRequests"), where("status", "==", "pending_sales"));
    else if (role === "team_lead")
      q = query(collection(db, "leaveRequests"), where("status", "==", "pending_teamlead"));
    else if (role === "admin")
      q = query(collection(db, "leaveRequests"), where("status", "==", "pending_admin"));

    if (!q) return setPendingForMe([]);
    const snap = await getDocs(q);
    setPendingForMe(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  return (
    <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 8 }}>
      <h3>Leave / Comp-Off Request</h3>

      <label>Request Type</label>
      <select value={requestType} onChange={(e) => setRequestType(e.target.value)} style={input}>
        <option value="leave">Leave</option>
        <option value="comp_off">Comp-Off (Worked on holiday)</option>
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
          <b>{r.from} → {r.to} ({r.type || "leave"})</b>
          <p>Status: {r.status}</p>
          {r.rejectReason && <p><b>Rejected Reason:</b> {r.rejectReason}</p>}
        </div>
      ))}

      {(pendingForMe.length > 0) && (
        <>
          <h4>Requests Waiting for Your Approval</h4>

          {pendingForMe.map((r) => (
            <div key={r.id} style={item}>
              <b>{r.userName}</b>
              <p>{r.from} → {r.to} ({r.type || "leave"})</p>
              <p><b>Reason:</b> {r.reason}</p>

              <button style={btn} onClick={() => handleAction(r, "approve")}>Approve</button>

              <button
                style={btnRed}
                onClick={() => {
                  const w = prompt("Rejection reason:");
                  if (w) handleAction(r, "reject", w);
                }}
              >
                Reject
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// styles (same as your file)
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
