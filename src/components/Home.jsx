// src/components/Home.jsx
import React, { useState } from "react";
import { useEffect } from "react";
import { auth, db } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getScopedQuery } from "../helpers/getScopedQuery";
import { getDocsWithFallback } from "../helpers/firestoreFetch";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import TasksPanel from "./TasksPanel";
import { fetchCollectionREST } from "../helpers/firestoreRest";




export default function Home() {
const [range] = useState("all");
  const [customFrom] = useState("");
  const [customTo] = useState("");
  const [deals, setDeals] = useState(0);
const [orders, setOrders] = useState(0);
const [revenue, setRevenue] = useState(0);
const [pendingRevenue, setPendingRevenue] = useState(0);
const [teleFilter, setTeleFilter] = useState("today");
const [teleCustomFrom, setTeleCustomFrom] = useState("");
const [teleCustomTo, setTeleCustomTo] = useState("");
const [teleAppliedFrom, setTeleAppliedFrom] = useState("");
const [teleAppliedTo, setTeleAppliedTo] = useState("");
const [visitFilter, setVisitFilter] = useState("today");
const [visitCustomFrom, setVisitCustomFrom] = useState("");
const [visitCustomTo, setVisitCustomTo] = useState("");
const [visitAppliedFrom, setVisitAppliedFrom] = useState("");
const [visitAppliedTo, setVisitAppliedTo] = useState("");
const [teleLeadsDealsData, setTeleLeadsDealsData] = useState([]);
const [consultantSiteVisitData, setConsultantSiteVisitData] = useState([]);
const [insightsLoading, setInsightsLoading] = useState(false);
const chartData = [
  { name: "Deals", value: deals },
  { name: "Sales Orders", value: orders },
];

const revenueData = [
  { name: "Revenue", value: revenue },
  { name: "Pending", value: pendingRevenue },
];
function formatIndian(x) {
  if (x === null || x === undefined) return "0";
  const s = String(Math.round(Number(x)));
  let last3 = s.substring(s.length - 3);
  let other = s.substring(0, s.length - 3);
  if (other !== "") last3 = "," + last3;
  const res = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + last3;
  return res;
}
function parseNumber(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/[^0-9.\-]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function parseDateValue(v) {
  if (!v) return null;
  // Firestore Timestamp
  if (typeof v === "object" && typeof v.toDate === "function") {
    try {
      return v.toDate();
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && typeof v.seconds === "number") {
    const d = new Date(v.seconds * 1000);
    if (!isNaN(d.getTime())) return d;
  }
  // ISO string or date string
  if (typeof v === "string") {
    const raw = v.trim();

    // Handle common CRM format: DD/MM/YYYY (optionally with time)
    const dmY = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(.*))?$/);
    if (dmY) {
      const day = Number(dmY[1]);
      const month = Number(dmY[2]);
      const year = Number(dmY[3]);
      const candidate = new Date(year, month - 1, day);
      if (
        !isNaN(candidate.getTime()) &&
        candidate.getFullYear() === year &&
        candidate.getMonth() === month - 1 &&
        candidate.getDate() === day
      ) {
        return candidate;
      }
    }

    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  // numeric timestamp
  if (typeof v === "number") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function getFilterBounds(type, from, to) {
  const now = new Date();

  if (type === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start, end };
  }

  if (type === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start, end };
  }

  if (type === "custom" && from && to) {
    const start = new Date(from);
    const end = new Date(to);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }

  return null;
}

function getFirstAvailableDate(record, keys = []) {
  for (const key of keys) {
    const parsed = parseDateValue(record?.[key]);
    if (parsed) return parsed;
  }
  return null;
}

function dateMatchesRange(dateVal, filterType, from, to) {
  if (!dateVal) return false;
  const date = parseDateValue(dateVal);
  if (!date) return false;
  const bounds = getFilterBounds(filterType, from, to);
  if (!bounds) return true;
  return date >= bounds.start && date <= bounds.end;
}

const normalizeOwner = (value, fallback = "Unassigned") => {
  const v = String(value || "").trim();
  return v || fallback;
};

const sanitizeLegacyUserDisplay = (value) => {
  const raw = String(value || "").trim();
  if (!raw || !raw.includes("|")) return raw;
  const parts = raw
    .split("|")
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (!parts.length) return raw;
  return parts.find((p) => !p.includes("@")) || parts[0];
};

const getCompletedSiteVisitDate = (deal = {}) => {
  const staticDate = getFirstAvailableDate(deal, [
    "siteVisitCompletedDate",
    "site_visit_completed_date",
    "siteVisitCompleted",
    "site_visit_completed",
  ]);
  if (staticDate) return staticDate;

  const keys = Object.keys(deal || {});
  for (const key of keys) {
    const normalized = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    if (!normalized.includes("site") || !normalized.includes("visit") || !normalized.includes("completed")) {
      continue;
    }
    const parsed = parseDateValue(deal[key]);
    if (parsed) return parsed;
  }

  return null;
};

function isInDateRange(createdVal, range, customFrom, customTo) {
  if (range === "all") return true;
  const dateRange = getDateRange(range);
  const created = parseDateValue(createdVal);
  if (!created) return false;

  if (range === "custom" && customFrom && customTo) {
    const fromD = new Date(customFrom);
    const toD = new Date(customTo);
    return created >= fromD && created <= toD;
  }

  if (dateRange) {
    return created >= dateRange.start && created <= dateRange.end;
  }

  return true;
}
useEffect(() => {
  fetchData();

  const timer = setInterval(() => {
    fetchData();
  }, 60 * 1000);

  return () => clearInterval(timer);
}, [range, customFrom, customTo]);

useEffect(() => {
  fetchHomeInsights();
}, [teleFilter, teleAppliedFrom, teleAppliedTo, visitFilter, visitAppliedFrom, visitAppliedTo]);

function handleApplyTeleCustom() {
  if (!teleCustomFrom || !teleCustomTo) {
    alert("Please select both From and To dates for Telecaller graph.");
    return;
  }
  if (new Date(teleCustomFrom) > new Date(teleCustomTo)) {
    alert("From date cannot be after To date.");
    return;
  }
  setTeleAppliedFrom(teleCustomFrom);
  setTeleAppliedTo(teleCustomTo);
}

function handleApplyVisitCustom() {
  if (!visitCustomFrom || !visitCustomTo) {
    alert("Please select both From and To dates for Consultant graph.");
    return;
  }
  if (new Date(visitCustomFrom) > new Date(visitCustomTo)) {
    alert("From date cannot be after To date.");
    return;
  }
  setVisitAppliedFrom(visitCustomFrom);
  setVisitAppliedTo(visitCustomTo);
}

function handleTeleFilterChange(next) {
  setTeleFilter(next);
  if (next !== "custom") {
    setTeleAppliedFrom("");
    setTeleAppliedTo("");
  }
}

function handleVisitFilterChange(next) {
  setVisitFilter(next);
  if (next !== "custom") {
    setVisitAppliedFrom("");
    setVisitAppliedTo("");
  }
}

async function fetchHomeInsights() {
  setInsightsLoading(true);
  try {
    const teleBounds = getFilterBounds(teleFilter, teleAppliedFrom, teleAppliedTo);
    const visitBounds = getFilterBounds(visitFilter, visitAppliedFrom, visitAppliedTo);
    const teleNeedsApply = teleFilter === "custom" && !(teleAppliedFrom && teleAppliedTo);
    const visitNeedsApply = visitFilter === "custom" && !(visitAppliedFrom && visitAppliedTo);

    const teleDateConstraints = [];
    if (teleBounds) {
      teleDateConstraints.push(where("createdAt", ">=", teleBounds.start));
      teleDateConstraints.push(where("createdAt", "<=", teleBounds.end));
    }

    const leadBase = collection(db, "leads");
    const dealBase = collection(db, "deals");
    const allDealsBase = collection(db, "deals");
    const leadQuery = teleDateConstraints.length ? query(leadBase, ...teleDateConstraints) : leadBase;
    const dealQuery = teleDateConstraints.length ? query(dealBase, ...teleDateConstraints) : dealBase;

    const [leadRows, dealRows, allDealRows] = await Promise.all([
      getDocsWithFallback(leadQuery, "leads", () => true),
      getDocsWithFallback(dealQuery, "deals", () => true),
      getDocsWithFallback(allDealsBase, "deals", () => true),
    ]);

    const leads = (leadRows || []).map((r) => r?.data || r || {});
    const deals = (dealRows || []).map((r) => r?.data || r || {});
    const allDeals = (allDealRows || []).map((r) => r?.data || r || {});

    const usersRows = await getDocsWithFallback(collection(db, "Users"), "Users", () => true);
    const usersByEmail = new Map();
    (usersRows || []).forEach((row) => {
      const u = row?.data || row || {};
      const email = String(u.email || "").trim().toLowerCase();
      const name = sanitizeLegacyUserDisplay(u.Name || u.name || "");
      if (email && name) usersByEmail.set(email, name);
    });

    const teleMap = new Map();
    const upsertTele = (name) => {
      const key = normalizeOwner(name);
      if (!teleMap.has(key)) teleMap.set(key, { name: key, leads: 0, deals: 0 });
      return teleMap.get(key);
    };

    if (!teleNeedsApply) {
      leads.forEach((lead) => {
        if (!dateMatchesRange(lead.createdAt, teleFilter, teleAppliedFrom, teleAppliedTo)) return;
        const row = upsertTele(lead.teleSale || lead.tele_sale || lead.telecaller);
        row.leads += 1;
      });

      deals.forEach((deal) => {
        if (!dateMatchesRange(deal.createdAt, teleFilter, teleAppliedFrom, teleAppliedTo)) return;
        const row = upsertTele(deal.teleSale || deal.tele_sale || deal.telecaller);
        row.deals += 1;
      });
    }

    const teleChart = teleNeedsApply
      ? []
      : Array.from(teleMap.values())
          .sort((a, b) => b.leads + b.deals - (a.leads + a.deals))
          .slice(0, 12);

    const siteVisitMap = new Map();
    if (!visitNeedsApply) {
      allDeals.forEach((deal) => {
      const completedDate = getCompletedSiteVisitDate(deal);

      if (!completedDate) return;
      if (visitBounds && (completedDate < visitBounds.start || completedDate > visitBounds.end)) return;

      const assignedEmail = String(
        sanitizeLegacyUserDisplay(
          deal.assignedConsultant || deal.assigned_consultant || deal.assigned_to || ""
        )
      )
        .trim()
        .toLowerCase();

      const resolvedConsultant = sanitizeLegacyUserDisplay(
        deal.consultantName ||
          deal.consultant_name ||
          usersByEmail.get(assignedEmail) ||
          deal.assignedConsultant ||
          deal.assigned_to ||
          deal.consultant ||
          "Unassigned"
      );

      const consultant = normalizeOwner(
        resolvedConsultant ||
          "Unassigned"
      );

      siteVisitMap.set(consultant, (siteVisitMap.get(consultant) || 0) + 1);
      });
    }

    const siteVisitChart = visitNeedsApply
      ? []
      : Array.from(siteVisitMap.entries())
          .map(([name, completedDeals]) => ({ name, completedDeals }))
          .sort((a, b) => b.completedDeals - a.completedDeals)
          .slice(0, 12);

    setTeleLeadsDealsData(teleChart);
    setConsultantSiteVisitData(siteVisitChart);
  } catch (error) {
    console.error("Home insights fetch failed:", error);
    setTeleLeadsDealsData([]);
    setConsultantSiteVisitData([]);
  } finally {
    setInsightsLoading(false);
  }
}

async function fetchData() {
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem("kp-user") : null;
    const parsed = stored ? JSON.parse(stored) : null;
    const user = auth.currentUser || parsed;
    if (!user?.email) return;

    // Determine user role and region fields from Users collection (if available)
    let role = (parsed && parsed.role) || null;
    let userMeta = null;
    try {
      const uq = query(collection(db, "Users"), where("email", "==", user.email));
      const usnap = await getDocs(uq);
      if (!usnap.empty) {
        userMeta = usnap.docs[0].data();
        role = (userMeta.role || role || "").toLowerCase();
      }
    } catch (e) {
      console.warn("Failed to load user metadata:", e);
    }

    // Use centralized scoping helper to build base queries for `deals` and `salesOrders`.
    let baseDealsQuery = null;
    try {
      baseDealsQuery = await getScopedQuery("deals");
    } catch (err) {
      console.warn("getScopedQuery(deals) failed, falling back to unscoped collection:", err);
      baseDealsQuery = collection(db, "deals");
    }

    const dateRange = getDateRange(range);

    // Add date constraints if needed
    const dateConstraints = [];
    if (range === "custom" && customFrom && customTo) {
      dateConstraints.push(where("createdAt", ">=", new Date(customFrom)));
      dateConstraints.push(where("createdAt", "<=", new Date(customTo)));
    } else if (dateRange) {
      dateConstraints.push(where("createdAt", ">=", dateRange.start));
      dateConstraints.push(where("createdAt", "<=", dateRange.end));
    }

    // Build final deals query from scoped base and date constraints
    const q = dateConstraints.length ? query(baseDealsQuery, ...dateConstraints) : baseDealsQuery;

    let rows = await import('../helpers/firestoreFetch').then((m) => m.getDocsWithFallback(q, 'deals', (d) => {
      // keep server-side fallback predicate minimal; we'll enforce robust date filtering client-side
      return true;
    }));

    // Client-side date filtering to handle Timestamp/string/number createdAt representations
    if (Array.isArray(rows)) {
      rows = rows.filter((r) => {
        const d = r.data || r;
        return isInDateRange(d.createdAt, range, customFrom, customTo);
      });
    }

    if (!rows || rows.length === 0) {
      const token = parsed?.idToken || null;
      if (token) {
        const restDeals = await fetchCollectionREST("deals", token);

        // For REST fallback, apply loose scoping using cached user (if available)
        const matchesScope = (d) => {
          if (!d) return false;

          const created = d.createdAt ? new Date(d.createdAt) : null;
          if (range === 'custom' && customFrom && customTo) {
            const fromD = new Date(customFrom);
            const toD = new Date(customTo);
            if (!created || created < fromD || created > toD) return false;
          } else if (dateRange) {
            if (!created || created < dateRange.start || created > dateRange.end) return false;
          }

          if (userMeta) {
            const roleStr = (userMeta.role || userMeta.Role || "").toString().toLowerCase();
            if (roleStr.includes("consultant")) {
              if (d.assignedConsultant && d.assignedConsultant !== userMeta.email) return false;
            }
            if (roleStr.includes("telesales")) {
              if (d.teleSale && d.teleSale !== userMeta.Name) return false;
            }
            if (roleStr.includes("area_sales_manager") && userMeta.sales_area) {
              if (d.sales_area && d.sales_area !== userMeta.sales_area) return false;
            }
            if (roleStr.includes("zonal_manager") && userMeta.sales_zone) {
              if (d.sales_zone && d.sales_zone !== userMeta.sales_zone) return false;
            }
            if (roleStr.includes("state_head") && userMeta.state) {
              if (d.state && d.state !== userMeta.state) return false;
            }
          }

          return true;
        };

        rows = (restDeals || []).filter(matchesScope).map((d) => ({ data: d }));
      }
    }

    let dealCount = 0;
    let orderCount = 0;
    let totalRevenue = 0;
    let pending = 0;

    rows.forEach((r) => {
      const d = r.data || r;
      dealCount++;

      if (d.salesOrderIssued) orderCount++;
      if (d.expectedRevenue) totalRevenue += Number(d.expectedRevenue);
      if (d.pendingRevenue) pending += Number(d.pendingRevenue);
    });

    setDeals(dealCount);

    // compute sales orders and pendingRevenue from salesOrders collection scoped using getScopedQuery
    try {
      let baseSO = null;
      try {
        baseSO = await getScopedQuery("salesOrders");
      } catch (err) {
        console.warn("getScopedQuery(salesOrders) failed, using collection:", err);
        baseSO = collection(db, "salesOrders");
      }

      const salesQ = dateConstraints.length ? query(baseSO, ...dateConstraints) : baseSO;

        const sSnap = await getDocs(salesQ);
      console.debug("[Home] salesOrders query:", salesQ);
      console.debug("[Home] salesOrders returned:", sSnap.size);
      if (!sSnap.empty) {
        console.debug("[Home] salesOrders sample:", sSnap.docs.slice(0,3).map(d=>d.data()));
      }
        // convert to array and apply client-side date filtering
        const soDocs = sSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        const filteredSo = soDocs.filter((s) => isInDateRange(s.createdAt, range, customFrom, customTo));
        let soCount = filteredSo.length;
        let pendingFromSO = 0;
        let receivedRevenue = 0;
        filteredSo.forEach((so) => {
          const p = parseNumber(so.pendingAmount || so.pendingRevenue || so.pending || so.pendingPayment || so.pending_payment || so.pending_amount || 0);
          pendingFromSO += p;
          
          // Sum of received amounts (payments made)
          const p1 = parseNumber(so.firstPayment || 0);
          const p2 = parseNumber(so.secondPayment || 0);
          const p3 = parseNumber(so.thirdPayment || 0);
          const p4 = parseNumber(so.fourthPayment || 0);
          receivedRevenue += p1 + p2 + p3 + p4;
        });

      setOrders(soCount);
      setPendingRevenue(pendingFromSO);
      setRevenue(receivedRevenue);
      
      // If no salesOrders found via SDK, try REST fallback (useful for WebView timeouts)
      if ((soCount === 0 || pendingFromSO === 0 || receivedRevenue === 0) && parsed?.idToken) {
        try {
          const restSo = await fetchCollectionREST("salesOrders", parsed.idToken);
          console.debug("[Home] salesOrders REST count:", (restSo || []).length);
          const restPending = (restSo || []).reduce((acc, s) => {
            const val = parseNumber(s.pendingAmount || s.pendingRevenue || s.pending || s.pendingPayment || s.pending_payment || s.pending_amount || 0);
            return acc + (isNaN(val) ? 0 : val);
          }, 0);
          const restRevenue = (restSo || []).reduce((acc, s) => {
            const p1 = parseNumber(s.firstPayment || 0);
            const p2 = parseNumber(s.secondPayment || 0);
            const p3 = parseNumber(s.thirdPayment || 0);
            const p4 = parseNumber(s.fourthPayment || 0);
            return acc + p1 + p2 + p3 + p4;
          }, 0);
          const restCount = (restSo || []).length;
          if (restCount > 0) setOrders(restCount);
          if (restPending > 0) setPendingRevenue(restPending);
          if (restRevenue > 0) setRevenue(restRevenue);
        } catch (err) {
          console.warn("[Home] salesOrders REST fallback failed", err);
        }
      }
    } catch (e) {
      // fallback to previous logic if salesOrders query fails
      setOrders(orderCount);
      setPendingRevenue(pending);
      setRevenue(totalRevenue);
    }

  } catch (e) {
      console.error("Dashboard Load Error", e);
    }
  }

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
  return (
    <div style={styles.container}>
      {/* HEADER */}
      <div style={styles.header}>
        <h2 style={styles.heading}>Welcome to Dashboard</h2>
      </div>

      {/* TASKS / PENDING TASKS PANEL (show first) */}
      <div style={{ padding: 20 }}>
        <TasksPanel />
      </div>

      {/* KPI CARDS */}
      <div style={styles.kpiGrid}>
      {[
  ["My Deals", deals, false],
  ["My Sales Orders", orders, false],
  ["Revenue (₹)", revenue, true],
  ["Pending Revenue (₹)", pendingRevenue, true],
].map(([label, val, indian]) => (
  <div key={label} style={styles.card}>
    <p style={styles.cardLabel}>{label}</p>
    <h3 style={styles.cardValue}>{indian ? formatIndian(val) : val}</h3>
  </div>
))}
      </div>

      {/* (removed duplicate TasksPanel) */}

      {/* CHARTS */}
      <div style={styles.chartGrid}>
        {/* Deals vs Orders */}
<div style={styles.chartBox}>
  <ResponsiveContainer width="100%" height="100%">
    <BarChart
      data={chartData}
      barSize={60}
      margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
    >
      <XAxis dataKey="name" />
      <YAxis />
      <Tooltip />
      <Bar dataKey="value" fill="#800000" radius={[10, 10, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
</div>

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

{/* Telecaller-wise Leads and Deals */}
<div style={styles.insightsStack}>
<div style={styles.insightChartBox}>
  <div style={styles.chartHeaderRow}>
    <h3 style={styles.chartTitle}>📞 Telecaller-wise Leads & Deals</h3>
    <div style={styles.inlineFilters}>
      <select
        style={styles.inlineSelect}
        value={teleFilter}
        onChange={(e) => handleTeleFilterChange(e.target.value)}
      >
        <option value="today">Today</option>
        <option value="month">This Month</option>
        <option value="custom">Custom</option>
      </select>
      {teleFilter === "custom" && (
        <>
          <input
            type="date"
            value={teleCustomFrom}
            onChange={(e) => setTeleCustomFrom(e.target.value)}
            style={styles.inlineDate}
          />
          <input
            type="date"
            value={teleCustomTo}
            onChange={(e) => setTeleCustomTo(e.target.value)}
            style={styles.inlineDate}
          />
          <button style={styles.inlineApplyBtn} onClick={handleApplyTeleCustom}>
            Apply
          </button>
        </>
      )}
    </div>
  </div>

  <div style={styles.chartInnerArea}>
    {insightsLoading ? (
      <p style={styles.emptyText}>Loading graph...</p>
    ) : teleFilter === "custom" && !(teleAppliedFrom && teleAppliedTo) ? (
      <p style={styles.emptyText}>Select custom dates and click Apply.</p>
    ) : teleLeadsDealsData.length === 0 ? (
      <p style={styles.emptyText}>No telecaller data for selected filter.</p>
    ) : (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={teleLeadsDealsData} margin={{ top: 20, right: 20, left: 10, bottom: 30 }}>
          <XAxis
            dataKey="name"
            angle={-18}
            textAnchor="end"
            height={78}
            interval={0}
            tickMargin={8}
            tick={{ fontSize: 10 }}
          />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="leads" name="Leads" fill="#800000" radius={[8, 8, 0, 0]} />
          <Bar dataKey="deals" name="Deals" fill="#b42626" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )}
  </div>
</div>

{/* Consultant-wise Site Visit Completed */}
<div style={styles.insightChartBox}>
  <div style={styles.chartHeaderRow}>
    <h3 style={styles.chartTitle}>🏁 Consultant-wise Site Visit Completed Deals</h3>
    <div style={styles.inlineFilters}>
      <select
        style={styles.inlineSelect}
        value={visitFilter}
        onChange={(e) => handleVisitFilterChange(e.target.value)}
      >
        <option value="today">Today</option>
        <option value="month">This Month</option>
        <option value="custom">Custom</option>
      </select>
      {visitFilter === "custom" && (
        <>
          <input
            type="date"
            value={visitCustomFrom}
            onChange={(e) => setVisitCustomFrom(e.target.value)}
            style={styles.inlineDate}
          />
          <input
            type="date"
            value={visitCustomTo}
            onChange={(e) => setVisitCustomTo(e.target.value)}
            style={styles.inlineDate}
          />
          <button style={styles.inlineApplyBtn} onClick={handleApplyVisitCustom}>
            Apply
          </button>
        </>
      )}
    </div>
  </div>

  <div style={styles.chartInnerArea}>
    {insightsLoading ? (
      <p style={styles.emptyText}>Loading graph...</p>
    ) : visitFilter === "custom" && !(visitAppliedFrom && visitAppliedTo) ? (
      <p style={styles.emptyText}>Select custom dates and click Apply.</p>
    ) : consultantSiteVisitData.length === 0 ? (
      <p style={styles.emptyText}>No completed site visit data for selected filter.</p>
    ) : (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={consultantSiteVisitData} margin={{ top: 20, right: 20, left: 10, bottom: 30 }}>
          <XAxis
            dataKey="name"
            angle={-18}
            textAnchor="end"
            height={78}
            interval={0}
            tickMargin={8}
            tick={{ fontSize: 10 }}
          />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar
            dataKey="completedDeals"
            name="Completed Deals"
            fill="url(#siteVisitGradient)"
            radius={[10, 10, 0, 0]}
          />
          <defs>
            <linearGradient id="siteVisitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#800000" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#cf4a4a" stopOpacity={0.9} />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    )}
  </div>
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
    width: "100%",
    minHeight: "100%",
    backgroundColor: "#fff5f5",
    paddingBottom: 24,
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
  insightsStack: {
    display: "flex",
    flexDirection: "column",
    gap: 28,
    padding: "0 35px 35px",
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
insightChartBox: {
  border: "2px solid #800000",
  borderRadius: "14px",
  height: "380px",
  background: "linear-gradient(180deg, #fff 0%, #fff8f8 100%)",
  display: "flex",
  flexDirection: "column",
  padding: "12px 14px 10px",
  boxShadow: "0 8px 18px rgba(128,0,0,0.08)",
},
chartHeaderRow: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 8,
},
chartTitle: {
  margin: 0,
  color: "#800000",
  fontSize: "15px",
  fontWeight: 800,
},
inlineFilters: {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
},
inlineSelect: {
  border: "1px solid #800000",
  borderRadius: 8,
  color: "#800000",
  background: "#fff",
  padding: "6px 8px",
  fontSize: 12,
  fontWeight: 700,
},
inlineDate: {
  border: "1px solid #800000",
  borderRadius: 8,
  color: "#800000",
  background: "#fff",
  padding: "5px 8px",
  fontSize: 12,
},
inlineApplyBtn: {
  border: "1px solid #800000",
  borderRadius: 8,
  background: "#800000",
  color: "#fff",
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
},
chartInnerArea: {
  flex: 1,
  minHeight: 0,
},
emptyText: {
  margin: 0,
  height: "100%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  color: "#800000",
  fontWeight: 600,
  opacity: 0.8,
},
  /* FOOTER */
  footer: {
    backgroundColor: "#800000",
    color: "white",
    textAlign: "center",
    padding: "12px",
    position: "relative",
    marginTop: 8,
    zIndex: 2000,
  },

  footerText: { margin: 0 },
};
