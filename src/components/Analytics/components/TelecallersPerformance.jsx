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

export default function TelecallersPerformance() {

  const { filters } = useDashboardFilters();
  const [data, setData] = useState([]);
  const user = JSON.parse(localStorage.getItem("kp-user") || "{}");

  const [leadSort, setLeadSort] = useState({ by: "leads", order: "desc" });
  const [revenueSort, setRevenueSort] = useState({ by: "revenue", order: "desc" });
  const [costSort, setCostSort] = useState({ by: "projectCost", order: "desc" });
  const [capacitySort, setCapacitySort] = useState({ by: "orders", order: "desc" });

  useEffect(() => {
    loadData();
  }, [filters]);


  const loadData = async () => {
    let map = {};

    // ---------- LEADS ----------
    const q = await getScopedQuery("leads");
const leadsSnap = await getDocs(q);

    leadsSnap.forEach(doc => {
      const l = doc.data();

      if (filters.zone !== "All" && (l.sales_zone || "") !== filters.zone) return;
      if (!isDateInFilter(l.createdAt, filters)) return;

      const t = l.teleSale || "Unknown";

      if (!map[t]) map[t] = initTele(t);
      map[t].leads++;
    });

    // ---------- SALES ORDERS ----------
    const soQuery = await getScopedQuery("salesOrders");
    const soSnap = await getDocs(soQuery);
    soSnap.forEach(doc => {
      const s = doc.data();

      if (filters.zone !== "All" && (s.sales_zone || "") !== filters.zone) return;
      if (!isDateInFilter(s.createdAt, filters)) return;

      const t = s.teleSale || "Unknown";

      if (!map[t]) map[t] = initTele(t);

      map[t].orders++;
      map[t].capacity += Number(s.capacity || 0);
      map[t].projectCost += Number(s.invoiceAmount || 0);
      map[t].pending += Number(s.pendingPayment || 0);

      if (isDateInFilter(s.firstPaymentDate, filters))
        map[t].revenue += Number(s.firstPayment || 0);

      if (isDateInFilter(s.secondPaymentDate, filters))
        map[t].revenue += Number(s.secondPayment || 0);

      if (isDateInFilter(s.thirdPaymentDate, filters))
        map[t].revenue += Number(s.thirdPayment || 0);

      if (isDateInFilter(s.fourthPaymentDate, filters))
        map[t].revenue += Number(s.fourthPayment || 0);
    });

    setData(Object.values(map));
  };


  const initTele = (name) => ({
    tele: name,
    leads: 0,
    orders: 0,
    revenue: 0,
    projectCost: 0,
    pending: 0,
    capacity: 0,
  });

  const sortData = (arr, key, order) =>
    [...arr].sort((a, b) =>
      order === "asc" ? a[key] - b[key] : b[key] - a[key]
    );


  return (
    <div style={{ width: "100%", marginTop: 20 }}>
      <h2>Tele-Caller Performance</h2>


      {/* ---------- LEADS ---------- */}
      <ChartCard
        title="Leads Count - Telecaller Wise"
        sort={leadSort}
        setSort={setLeadSort}
        options={[{ key: "leads", label: "Leads" }]}
        data={sortData(data, leadSort.by, leadSort.order)}
        bars={[
          { key: "leads", color: "#6a11cb", label: "Leads" },
        ]}
      />


      {/* ---------- REVENUE ---------- */}
      <ChartCard
        title="Collected Revenue - Telecaller Wise"
        sort={revenueSort}
        setSort={setRevenueSort}
        options={[{ key: "revenue", label: "Revenue" }]}
        data={sortData(data, revenueSort.by, revenueSort.order)}
        bars={[
          { key: "revenue", color: "#F7971E", label: "Revenue ₹" },
        ]}
      />


      {/* ---------- PROJECT COST vs PENDING ---------- */}
      <ChartCard
        title="Project Cost vs Pending Revenue - Telecaller Wise"
        sort={costSort}
        setSort={setCostSort}
        options={[
          { key: "projectCost", label: "Project Cost" },
          { key: "pending", label: "Pending Revenue" },
        ]}
        data={sortData(data, costSort.by, costSort.order)}
        bars={[
          { key: "projectCost", color: "#4A148C", label: "Project Cost ₹" },
          { key: "pending", color: "#9C27B0", label: "Pending Revenue ₹" },
        ]}
      />


      {/* ---------- ORDERS vs CAPACITY ---------- */}
      <ChartCard
        title="Sales Orders vs Capacity - Telecaller Wise"
        sort={capacitySort}
        setSort={setCapacitySort}
        options={[
          { key: "orders", label: "Sales Orders" },
          { key: "capacity", label: "Capacity" },
        ]}
        data={sortData(data, capacitySort.by, capacitySort.order)}
        bars={[
          { key: "orders", color: "#6a11cb", label: "Sales Orders" },
          { key: "capacity", color: "#11998e", label: "Capacity (kW)" },
        ]}
      />

    </div>
  );
}


// ---------- Chart Wrapper ----------
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
            <option key={o.key} value={o.key}>{o.label}</option>
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
          <XAxis dataKey="tele" />
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
