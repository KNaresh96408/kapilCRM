import React, { useEffect, useState } from "react";
import { auth, db } from "../../firebase/firebaseConfig";
import { useDashboardFilters } from "../../context/DashboardFilterContext";
import { isDateInFilter } from "../utils/isDateInFilter";
import PaymentTrackerFilterBar from "./PaymentTrackerFilterBar";
import PaymentGauge from "./PaymentGauge";

import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  query,
  where
} from "firebase/firestore";
import { getScopedQuery } from "../../helpers/getScopedQuery";
import { getDocsWithFallback } from "../../helpers/firestoreFetch";




export default function PaymentTracker() {
  const [userRole, setUserRole] = useState("user");
  const user = JSON.parse(localStorage.getItem("kp-user") || "{}");

  const normalizeRole = (raw) => {
    const base = (raw || "").toString().trim().toLowerCase();
    if (!base) return "";
    const underscored = base.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
    const compact = underscored.replace(/_/g, "");
    const aliasByCompact = {
      saleshead: "sales_head",
      hroperationsmanager: "agm",
      hr_operations_manager: "agm",
      agm: "agm",
      financemanager: "dgm",
      finance_manager: "dgm",
      dgm: "dgm",
      salesheadmanager: "sales_head",
    };
    return aliasByCompact[compact] || underscored;
  };

  const toDateSafe = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value?.seconds) return new Date(value.seconds * 1000);
    if (value instanceof Date) return value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  };

  const { filters } = useDashboardFilters();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const [sortOrder, setSortOrder] = useState("DESC");

  const [targetAmount, setTargetAmount] = useState(0);

  const [zoneFilter, setZoneFilter] = useState("All");
  const [teleFilter, setTeleFilter] = useState("All");
  const [consultFilter, setConsultFilter] = useState("All");


const fetchUserRole = async () => {
  try {

    const email = auth.currentUser?.email;
    if (!email) return;

    const q = query(
      collection(db, "Users"),
      where("email", "==", email)
    );

    const snap = await getDocs(q);

    if (!snap.empty) {
      const data = snap.docs[0].data();
      setUserRole(normalizeRole(data.role || data.designation || "user"));
    }
  } catch (e) {
    console.log("Role Fetch Error", e);
  }
};



  // Month Key (Dec-2025 etc)
  const monthKey = `${new Date().getFullYear()}-${String(
    new Date().getMonth() + 1
  ).padStart(2, "0")}`;

  useEffect(() => {
    fetchUserRole();
    loadSalesOrders();
    fetchTarget();
  }, [filters]);

  // ---------------- GET MONTHLY TARGET ----------------
  const fetchTarget = async () => {
    try {
      const ref = doc(db, "paymentTargets", monthKey);
      const snap = await getDoc(ref);
      if (snap.exists()) setTargetAmount(Number(snap.data().targetAmount || 0));
      else setTargetAmount(0);
    } catch (e) {
      console.log("Target Fetch Error", e);
    }
  };

  // ---------------- SAVE MONTHLY TARGET ----------------
  const saveTarget = async () => {
    try {
      await setDoc(doc(db, "paymentTargets", monthKey), {
        targetAmount: Number(targetAmount),
        updatedAt: new Date(),
      });

      alert("🎯 Monthly Target Saved Successfully");
      fetchTarget();
    } catch (err) {
      console.log(err);
      alert("Failed to save target");
    }
  };

  // ---------------- LOAD ORDERS ----------------
  const loadSalesOrders = async () => {
    setLoading(true);

    const q = await getScopedQuery("salesOrders");
    const rows = await getDocsWithFallback(q, "salesOrders", null);
    let list = [];

    rows.forEach((row) => {
      const data = row.data || row;

      // Apply Filter Bar (Zone + Dates + 60%)
      if (filters.zone !== "All" && (data.sales_zone || "") !== filters.zone)
        return;

      if (!isDateInFilter(data.createdAt, filters)) return;

      const paymentPercentage = Number(data.paymentPercentage || 0);
      const sixtyPercentReceived = paymentPercentage >= 60 ? "YES" : "NO";
      // ---------- GLOBAL 60% PAYMENT FILTER ----------
if (
  filters.sixtyFilter !== "All" &&
  filters.sixtyFilter !== sixtyPercentReceived
)
  return;


      let createdDate = toDateSafe(data.createdAt) || new Date();

      let delayDays = 0;

      if (sixtyPercentReceived === "YES" && data.sixtyPercentReceivedDate) {
        const receivedDate = toDateSafe(data.sixtyPercentReceivedDate) || createdDate;
        delayDays = Math.max(
          0,
          Math.round((receivedDate - createdDate) / (1000 * 60 * 60 * 24))
        );
      } else {
        const today = new Date();
        delayDays = Math.max(
          0,
          Math.round((today - createdDate) / (1000 * 60 * 60 * 24))
        );
      }

      list.push({
        ...data,
        id: row.id || data.id,
        sixtyPercentReceived,
        sixtyPercentDelayDays: delayDays,
      });
    });

    setOrders(list);
    setLoading(false);
  };

  // ---------- KPI ----------
  const yesOrders = orders.filter((o) => o.sixtyPercentReceived === "YES");
  const noOrders = orders.filter((o) => o.sixtyPercentReceived === "NO");

  const avgYesTAT =
    yesOrders.length === 0
      ? 0
      : (
          yesOrders.reduce((s, o) => s + o.sixtyPercentDelayDays, 0) /
          yesOrders.length
        ).toFixed(2);

  const avgNoTAT =
    noOrders.length === 0
      ? 0
      : (
          noOrders.reduce((s, o) => s + o.sixtyPercentDelayDays, 0) /
          noOrders.length
        ).toFixed(2);

  const totalPaymentReceived = orders.reduce(
    (s, o) => s + Number(o.paymentReceived || 0),
    0
  );

  // ---------------- Helper Chart Builder ----------------
  const buildChartData = (keyField, filter) => {
    let group = {};

    orders.forEach((o) => {
      const key = o[keyField] || "Unknown";

      if (!group[key]) group[key] = { name: key, yes: 0, no: 0 };

      if (filter === "YES" && o.sixtyPercentReceived !== "YES") return;
      if (filter === "NO" && o.sixtyPercentReceived !== "NO") return;

      if (o.sixtyPercentReceived === "YES") group[key].yes++;
      else group[key].no++;
    });

    let arr = Object.values(group);

    arr.sort((a, b) =>
      sortOrder === "ASC"
        ? a.yes + a.no - (b.yes + b.no)
        : b.yes + b.no - (a.yes + a.no)
    );

    return arr;
  };

  const zoneWise = buildChartData("sales_zone", zoneFilter);
  const teleWise = buildChartData("teleSale", teleFilter);
  const consultWise = buildChartData("consultantName", consultFilter);

  // ---------------- DELAY BUCKET CHART ----------------
  const buckets = [
    { label: "0-9", min: 0, max: 9, yes: 0, no: 0 },
    { label: "10-19", min: 10, max: 19, yes: 0, no: 0 },
    { label: "20-29", min: 20, max: 29, yes: 0, no: 0 },
    { label: "30-39", min: 30, max: 39, yes: 0, no: 0 },
    { label: "40-49", min: 40, max: 49, yes: 0, no: 0 },
    { label: "50-59", min: 50, max: 59, yes: 0, no: 0 },
    { label: "60-69", min: 60, max: 69, yes: 0, no: 0 },
    { label: "70-79", min: 70, max: 79, yes: 0, no: 0 },
    { label: "80+", min: 80, max: 99999, yes: 0, no: 0 },
  ];

  orders.forEach((o) => {
    const days = o.sixtyPercentDelayDays || 0;
    const bucket = buckets.find((b) => days >= b.min && days <= b.max);
    if (!bucket) return;
    if (o.sixtyPercentReceived === "YES") bucket.yes++;
    else bucket.no++;
  });

  return (
    <div style={{ padding: 30 }}>
      <h1 style={{ marginBottom: 10 }}>Payment Tracker Dashboard</h1>

      <PaymentTrackerFilterBar />

      {/* KPI CARDS LIKE SALES DASHBOARD */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 15,
          marginBottom: 25,
        }}
      >
        <div className="kpiCard">
          <h3>60% Received Customers</h3>
          <h1 style={{ color: "#6a11cb" }}>{yesOrders.length}</h1>
          <p>
            Avg TAT to reach 60%: <b>{avgYesTAT} Days</b>
          </p>
        </div>

        <div className="kpiCard">
          <h3>60% Not Received Customers</h3>
          <h1 style={{ color: "#F7971E" }}>{noOrders.length}</h1>
          <p>
            Avg Pending Delay: <b>{avgNoTAT} Days</b>
          </p>
        </div>

        <div className="kpiCard">
          <h3>Total Orders</h3>
          <h1 style={{ color: "#11998e" }}>{orders.length}</h1>
          <p>Filtered based on Zone + Dates + 60%</p>
        </div>
      </div>

      {/* GAUGE */}
      <PaymentGauge received={totalPaymentReceived} target={targetAmount} />

      {/* TARGET INPUT */}
{["admin", "sales_head", "saleshead", "agm", "director", "dgm"].includes(userRole) && (
  <div style={{ textAlign: "center", marginBottom: 25 }}>
    <input
      type="number"
      placeholder="Enter Monthly Target ₹"
      value={targetAmount}
      onChange={(e) => setTargetAmount(e.target.value)}
      style={{
        padding: 10,
        borderRadius: 8,
        border: "1px solid #888",
        marginRight: 10
      }}
    />

    <button
      onClick={saveTarget}
      style={{
        padding: "10px 15px",
        borderRadius: 8,
        border: "none",
        background: "#6a11cb",
        color: "white",
        cursor: "pointer"
      }}
    >
      Save Target
    </button>
  </div>
)}

      {/* CHARTS */}
      {chartBox(
        "Zone Wise – 60% YES / NO Count",
        zoneFilter,
        setZoneFilter,
        zoneWise,
        setSortOrder
      )}

      {chartBox(
        "TeleCaller Wise – 60% YES / NO Count",
        teleFilter,
        setTeleFilter,
        teleWise,
        setSortOrder
      )}

      {chartBox(
        "Consultant Wise – 60% YES / NO Count",
        consultFilter,
        setConsultFilter,
        consultWise,
        setSortOrder
      )}

      {/* Delay Bucket */}
      <div
        style={{
          padding: 20,
          background: "white",
          borderRadius: 10,
          border: "1px solid #ddd",
          marginTop: 25,
        }}
      >
        <h3>Range of Days – 60% Payment Received & Not Received</h3>

        <div style={{ width: "100%", height: 420 }}>
          <ResponsiveContainer>
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="yes" name="60% YES" fill="#6a11cb" />
              <Bar dataKey="no" name="60% NO" fill="#00C49F" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------
// REUSABLE CHART BLOCK
// ----------------------------------
function chartBox(title, filter, setFilter, data, setSortOrder) {
  return (
    <div
      style={{
        padding: 20,
        background: "white",
        borderRadius: 10,
        border: "1px solid #ddd",
        marginTop: 25,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <h3>{title}</h3>

        <div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginRight: 10 }}
          >
            <option value="All">All</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>

          <select onChange={(e) => setSortOrder(e.target.value)}>
            <option value="DESC">DESC</option>
            <option value="ASC">ASC</option>
          </select>
        </div>
      </div>

      <div style={{ width: "100%", height: 420 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="yes" name="60% YES" fill="#6a11cb" />
            <Bar dataKey="no" name="60% NO" fill="#00C49F" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
