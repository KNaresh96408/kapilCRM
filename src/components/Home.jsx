// src/components/Home.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { auth, db } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import TopNavbar from "./TopNavbar";




export default function Home() {
 const [range, setRange] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [deals, setDeals] = useState(0);
const [orders, setOrders] = useState(0);
const [revenue, setRevenue] = useState(0);
const [pendingRevenue, setPendingRevenue] = useState(0);
const chartData = [
  { name: "Deals", value: deals },
  { name: "Sales Orders", value: orders },
];

const revenueData = [
  { name: "Revenue", value: revenue },
  { name: "Pending", value: pendingRevenue },
];

const COLORS = ["#800000", "#e6a303"];
useEffect(() => {
  fetchData();
}, [range, customFrom, customTo]);

async function fetchData() {
  try {
    const user = auth.currentUser;
    if (!user) return;

    let q = query(
      collection(db, "deals"),
      where("assignedConsultant", "==", user.email)
    );

    const dateRange = getDateRange(range);

    if (range === "custom" && customFrom && customTo) {
      q = query(
        collection(db, "deals"),
        where("assignedConsultant", "==", user.email),
        where("createdAt", ">=", new Date(customFrom)),
        where("createdAt", "<=", new Date(customTo))
      );
    } 
    else if (dateRange) {
      q = query(
        collection(db, "deals"),
        where("assignedConsultant", "==", user.email),
        where("createdAt", ">=", dateRange.start),
        where("createdAt", "<=", dateRange.end)
      );
    }

    const snap = await getDocs(q);

    let dealCount = 0;
    let orderCount = 0;
    let totalRevenue = 0;
    let pending = 0;

    snap.forEach(doc => {
      const d = doc.data();
      dealCount++;

      if (d.salesOrderIssued) orderCount++;
      if (d.expectedRevenue) totalRevenue += Number(d.expectedRevenue);
      if (d.pendingRevenue) pending += Number(d.pendingRevenue);
    });

    setDeals(dealCount);
    setOrders(orderCount);
    setRevenue(totalRevenue);
    setPendingRevenue(pending);

  } catch (e) {
    console.error("Dashboard Load Error", e);
  }
}
useEffect(() => {
  loadDashboard();
}, [range, customFrom, customTo]);

function getDateRange(range) {
  const now = new Date();

  if (range === "current") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: now
    };
  }

  if (range === "previous") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0)
    };
  }

  return null;
}
async function loadDashboard() {
  const user = auth.currentUser;
  if (!user) return;

  let dealRef = collection(db, "deals");
  let conditions = [];

  // Consultant → only his deals
  if (user.email !== "admin@kapilpower.com") {
    conditions.push(where("assignedConsultant", "==", user.email));
  }

  // Custom Range
  if (range === "custom" && customFrom && customTo) {
    conditions.push(
      where("createdAt", ">=", new Date(customFrom)),
      where("createdAt", "<=", new Date(customTo))
    );
  } 
  else {
    const dr = getDateRange(range);
    if (dr) {
      conditions.push(where("createdAt", ">=", dr.start));
      conditions.push(where("createdAt", "<=", dr.end));
    }
  }

  const q = conditions.length ? query(dealRef, ...conditions) : dealRef;
  const snap = await getDocs(q);

  setDeals(snap.size);

  let total = 0;
  let pending = 0;

  snap.forEach(d => {
    const x = d.data();
    total += x.expectedRevenue || 0;
    pending += x.pendingRevenue || 0;
  });

  setRevenue(total);
  setPendingRevenue(pending);
}
  return (
    <div style={styles.container}>
      {/* 🔥 TOP NAVIGATION BAR (same as old) */}
      <TopNavbar />

      {/* HEADER */}
      <div style={styles.header}>
        <h2 style={styles.heading}>Welcome to Dashboard</h2>

        {/* FILTERS LEFT SIDE */}
        <div style={styles.filterWrapper}>
          <select
  value={range}
  onChange={(e) => setRange(e.target.value)}
  style={styles.dropdown}
>
  <option value="all">All Time</option>
  <option value="current">Current Month</option>
  <option value="previous">Previous Month</option>
  <option value="custom">Custom Range</option>
</select>

          {range === "custom" && (
            <div style={styles.customDateRow}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={styles.dateInput}
              />
              <span style={{ color: "#800000", fontWeight: "600" }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={styles.dateInput}
              />
              <button
  style={{
    padding: "6px 14px",
    background:"#800000",
    color:"white",
    borderRadius:"6px",
    border:"none",
    cursor:"pointer"
  }}
  onClick={fetchData}
>
  Apply
</button>
            </div>
          )}
        </div>
      </div>

      {/* KPI CARDS */}
      <div style={styles.kpiGrid}>
      {[
  ["My Deals", deals],
  ["My Sales Orders", orders],
  ["Revenue (₹)", revenue],
  ["Pending Revenue (₹)", pendingRevenue],
].map(([label, val]) => (
  <div key={label} style={styles.card}>
    <p style={styles.cardLabel}>{label}</p>
    <h3 style={styles.cardValue}>{val}</h3>
  </div>
))}
      </div>

      {/* CHARTS */}
      <div style={styles.chartGrid}>
        {/* Deals vs Orders */}
<ResponsiveContainer width="100%" height="100%">
  <BarChart
    data={chartData}
    barSize={60}
    margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
  >
    <XAxis dataKey="name" />
    <YAxis />
    <YAxis hide />
    <Tooltip />
    <Bar dataKey="value" fill="#800000" radius={[10, 10, 0, 0]} />
  </BarChart>
</ResponsiveContainer>

{/* Revenue Breakdown */}
<div style={styles.chartBox}>
  <ResponsiveContainer width="100%" height="100%">
  <BarChart
    data={revenueData}
    barSize={60}
    margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
  >
    <XAxis dataKey="name" />
    <YAxis hide />
    <Tooltip />
    <Bar
      dataKey="value"
      fill="#800000"
      radius={[10, 10, 0, 0]}
      background={false}
    />
  </BarChart>
</ResponsiveContainer>

</div>
      </div>

      {/* FOOTER */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>
          © {new Date().getFullYear()} Kapil Power & Infra Pvt. Ltd. | CRM v0.1
        </p>
      </footer>
    </div>
  );
}

// 🎨 STYLES
const styles = {
  container: {
    width: "100vw",
    minHeight: "100vh",
    backgroundColor: "#fff5f5",
    display: "flex",
    flexDirection: "column",
  },

  /* NAV BAR */
  navbar: {
    backgroundColor: "#800000",
    padding: "14px 45px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 1000,
  },

  logo: {
    color: "white",
    fontWeight: "bold",
    fontSize: "24px",
  },

  navLinks: {
    display: "flex",
    gap: "45px",
  },

  link: {
  color: "white",
  textDecoration: "none",
  fontWeight: "700",
  fontSize: "19px",   // ⬅️ Increase button font
  letterSpacing: "0.5px"
},


  /* HEADER */
  header: {
    padding: "25px 45px",
    backgroundColor: "#fff",
    boxShadow: "0 3px 6px rgba(0,0,0,0.12)",
  },

  heading: {
    fontSize: "22px",
    color: "#800000",
    marginBottom: "12px",
  },

  filterWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "flex-start",
  },

  dropdown: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1.5px solid #800000",
    color: "#800000",
    width: "200px",
    fontSize: "15px",
  },

  customDateRow: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },

  dateInput: {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1.5px solid #800000",
    color: "#800000",
  },

  /* KPI CARDS */
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    padding: "35px",
    gap: "25px",
  },

  card: {
    border: "2px solid #800000",
    borderRadius: "12px",
    backgroundColor: "#fff",
    padding: "28px",
    textAlign: "center",
  },

  cardLabel: {
    color: "#800000",
    fontSize: "16px",
    fontWeight: "600",
  },

  cardValue: {
    fontSize: "30px",
    fontWeight: "bold",
    color: "#800000",
    marginTop: "8px",
  },

  /* CHART BOXES */
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    padding: "35px",
    gap: "28px",
  },

chartBox: {
  border: "2px solid #800000",
  borderRadius: "12px",
  height: "320px",     // <--- VERY IMPORTANT
  background: "#fff",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  color: "#800000",
  fontWeight: 700,
  fontSize: "18px",
},
  /* FOOTER */
  footer: {
    backgroundColor: "#800000",
    color: "white",
    textAlign: "center",
    padding: "12px",
    marginTop: "auto",      // 🟢 Keeps footer always bottom
  },

  footerText: { margin: 0 },
};
