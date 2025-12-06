// src/components/Home.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";

export default function Home() {
  const [range, setRange] = useState("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  return (
    <div style={styles.container}>
      {/* 🔥 TOP NAVIGATION BAR (same as old) */}
      <nav style={styles.navbar}>
        <h1 style={styles.logo}>⚡ Kapil Power CRM</h1>

        <div style={styles.navLinks}>
          <Link to="/crm/home" style={styles.link}>Home</Link>
          <Link to="/crm/leads" style={styles.link}>Leads</Link>
          <Link to="/crm/deals" style={styles.link}>Deals</Link>
          <Link to="/crm/salesOrders" style={styles.link}>Sales Orders</Link>
          <Link to="/crm/projects" style={styles.link}>Projects</Link>
        </div>
      </nav>

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
            <option value="current">Current Month</option>
            <option value="previous">Previous Month</option>
            <option value="custom">Custom Range (TBD)</option>
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
            </div>
          )}
        </div>
      </div>

      {/* KPI CARDS */}
      <div style={styles.kpiGrid}>
        {[
          ["My Deals", 0],
          ["My Sales Orders", 0],
          ["Revenue (₹)", 0],
          ["Pending Revenue (₹)", 0],
        ].map(([label, val]) => (
          <div key={label} style={styles.card}>
            <p style={styles.cardLabel}>{label}</p>
            <h3 style={styles.cardValue}>{val}</h3>
          </div>
        ))}
      </div>

      {/* CHARTS */}
      <div style={styles.chartGrid}>
        <div style={styles.chartBox}>📊 Deals vs Orders</div>
        <div style={styles.chartBox}>💰 Revenue Breakdown</div>
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

  navbar: {
    backgroundColor: "#800000",
    padding: "12px 40px",
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
    fontSize: "22px",
  },

  navLinks: {
    display: "flex",
    gap: "25px",
  },

  link: {
    color: "white",
    textDecoration: "none",
    fontWeight: "500",
    fontSize: "15px",
  },

  header: {
    padding: "20px 40px",
    backgroundColor: "#fff",
    boxShadow: "0 3px 6px rgba(0,0,0,0.1)",
  },

  heading: {
    fontSize: "20px",
    color: "#800000",
    marginBottom: "10px",
  },

  filterWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    alignItems: "flex-start",
  },

  dropdown: {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid #800000",
    color: "#800000",
    width: "180px",
    fontSize: "14px",
  },

  customDateRow: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },

  dateInput: {
    padding: "4px 8px",
    borderRadius: "6px",
    border: "1px solid #800000",
    color: "#800000",
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    padding: "30px",
    gap: "20px",
  },

  card: {
    border: "1.5px solid #800000",
    borderRadius: "8px",
    backgroundColor: "#fff",
    padding: "20px",
    textAlign: "center",
  },

  cardLabel: {
    color: "#800000",
    fontSize: "14px",
  },

  cardValue: {
    fontSize: "25px",
    fontWeight: "bold",
    color: "#800000",
  },

  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
    padding: "30px",
    gap: "25px",
  },

  chartBox: {
    border: "1.5px solid #800000",
    borderRadius: "10px",
    height: "220px",
    background: "#fff",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: "#800000",
    fontWeight: 600,
  },

  footer: {
    backgroundColor: "#800000",
    color: "white",
    textAlign: "center",
    padding: "10px",
  },

  footerText: { margin: 0 },
};
