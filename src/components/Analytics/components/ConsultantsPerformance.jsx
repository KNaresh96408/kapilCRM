import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../firebase/firebaseConfig";
import { useDashboardFilters } from "../../../context/DashboardFilterContext";
import { isDateInFilter } from "../../utils/isDateInFilter";
import { getScopedQuery } from "../../../helpers/getScopedQuery";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

export default function ConsultantsPerformance() {

  const { filters } = useDashboardFilters();
  const [consultants, setConsultants] = useState([]);
   const user = JSON.parse(localStorage.getItem("kp-user") || "{}");

  // ---------- Sorting states ----------
  const [dealSort, setDealSort] = useState({ by: "deals", order: "desc" });
  const [revenueSort, setRevenueSort] = useState({ by: "revenue", order: "desc" });
  const [costSort, setCostSort] = useState({ by: "projectCost", order: "desc" });
  const [capacitySort, setCapacitySort] = useState({ by: "orders", order: "desc" });

  useEffect(() => {
    loadData();
  }, [filters]);

  // ---------- Fetch + Build Consultant Performance ----------
  const loadData = async () => {
    let map = {};

    // ---------------- DEALS ----------------
    const q = await getScopedQuery("deals");
const dealsSnap = await getDocs(q);
    let uniqueDeals = new Set();

dealsSnap.forEach(doc => {
  const d = doc.data();

  if (filters.zone !== "All" && (d.sales_zone || "") !== filters.zone) return;
  if (!isDateInFilter(d.createdAt, filters)) return;

  // Unique key (choose any stable identifier)
  const key = d.kpiId || d.autoId || d.id;

  if (uniqueDeals.has(key)) return;
  uniqueDeals.add(key);

  const name = d.consultantName || "Unknown";

  if (!map[name]) map[name] = initConsultant(name);
  map[name].deals++;
});

    // ---------------- SALES ORDERS ----------------
   const soQuery = await getScopedQuery("salesOrders");
const soSnap = await getDocs(soQuery);

    soSnap.forEach(doc => {
      const s = doc.data();

      if (filters.zone !== "All" && (s.sales_zone || "") !== filters.zone) return;
      if (!isDateInFilter(s.createdAt, filters)) return;

      const name = s.consultantName || "Unknown";

      if (!map[name]) map[name] = initConsultant(name);

      map[name].orders++;
      map[name].capacity += Number(s.capacity || 0);
      map[name].projectCost += Number(s.invoiceAmount || 0);
      map[name].pending += Number(s.pendingPayment || 0);

      // ---------- Revenue Logic (Date Based like APvsTS) ----------
      if (isDateInFilter(s.firstPaymentDate, filters))
        map[name].revenue += Number(s.firstPayment || 0);

      if (isDateInFilter(s.secondPaymentDate, filters))
        map[name].revenue += Number(s.secondPayment || 0);

      if (isDateInFilter(s.thirdPaymentDate, filters))
        map[name].revenue += Number(s.thirdPayment || 0);

      if (isDateInFilter(s.fourthPaymentDate, filters))
        map[name].revenue += Number(s.fourthPayment || 0);
    });

    setConsultants(Object.values(map));
  };

  const initConsultant = (name) => ({
    consultant: name,
    deals: 0,
    orders: 0,
    revenue: 0,
    projectCost: 0,
    pending: 0,
    capacity: 0,
  });

  const sortData = (data, key, order) =>
    [...data].sort((a, b) =>
      order === "asc" ? a[key] - b[key] : b[key] - a[key]
    );

  return (
    <div style={{ width: "100%", marginTop: 20 }}>
      <h2 style={{ marginBottom: 10 }}>Consultant Performance</h2>

      {/* ================= DEALS vs SALES ORDERS ================= */}
      <ChartCard
        title="Deals vs Sales Orders - Consultant Wise"
        sort={dealSort}
        setSort={setDealSort}
        options={[
          { key: "deals", label: "Deals" },
          { key: "orders", label: "Sales Orders" },
        ]}
        data={sortData(consultants, dealSort.by, dealSort.order)}
        bars={[
          { key: "deals", color: "#6a11cb", label: "Deals" },
          { key: "orders", color: "#11998e", label: "Sales Orders" },
        ]}
      />

      {/* ================= REVENUE ================= */}
      <ChartCard
        title="Collected Revenue - Consultant Wise"
        sort={revenueSort}
        setSort={setRevenueSort}
        options={[
          { key: "revenue", label: "Revenue" },
        ]}
        data={sortData(consultants, revenueSort.by, revenueSort.order)}
        bars={[
          { key: "revenue", color: "#F7971E", label: "Revenue ₹" },
        ]}
      />

      {/* ================= PROJECT COST VS PENDING ================= */}
      <ChartCard
        title="Total Project Cost vs Pending Revenue - Consultant Wise"
        sort={costSort}
        setSort={setCostSort}
        options={[
          { key: "projectCost", label: "Project Cost" },
          { key: "pending", label: "Pending Revenue" },
        ]}
        data={sortData(consultants, costSort.by, costSort.order)}
        bars={[
          { key: "projectCost", color: "#4A148C", label: "Project Cost ₹" },
          { key: "pending", color: "#9C27B0", label: "Pending Revenue ₹" },
        ]}
      />

      {/* ================= ORDERS vs CAPACITY ================= */}
      <ChartCard
        title="Sales Orders vs Capacity - Consultant Wise"
        sort={capacitySort}
        setSort={setCapacitySort}
        options={[
          { key: "orders", label: "Sales Orders" },
          { key: "capacity", label: "Capacity" },
        ]}
        data={sortData(consultants, capacitySort.by, capacitySort.order)}
        bars={[
          { key: "orders", color: "#6a11cb", label: "Sales Orders" },
          { key: "capacity", color: "#11998e", label: "Capacity (kW)" },
        ]}
      />

    </div>
  );
}


// ---------- Reusable Chart Wrapper ----------
function ChartCard({ title, sort, setSort, options, data, bars }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <h3>{title}</h3>

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <select
          className="dashSelect"
          value={sort.by}
          onChange={e => setSort({ ...sort, by: e.target.value })}
        >
          {options.map(o => (
            <option value={o.key} key={o.key}>{o.label}</option>
          ))}
        </select>

        <select
          className="dashSelect"
          value={sort.order}
          onChange={e => setSort({ ...sort, order: e.target.value })}
        >
          <option value="desc">DESC</option>
          <option value="asc">ASC</option>
        </select>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="consultant" />
          <YAxis />
          <Tooltip />
          <Legend />

          {bars.map(b => (
            <Bar
              key={b.key}
              dataKey={b.key}
              fill={b.color}
              name={b.label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
