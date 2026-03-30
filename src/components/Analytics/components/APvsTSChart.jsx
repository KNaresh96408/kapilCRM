import React, { useEffect, useState } from "react";
import { getDocsWithFallback } from "../../../helpers/firestoreFetch";
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
  Legend
} from "recharts";

export default function APvsTSChart() {
  const { filters } = useDashboardFilters();
  const [data, setData] = useState([]);

  const [sortBy, setSortBy] = useState("orders");
  const [sortOrder, setSortOrder] = useState("desc");
  const user = JSON.parse(localStorage.getItem("kp-user") || "{}");


  useEffect(() => {
    loadData();
  }, [filters, sortBy, sortOrder]);

  const loadData = async () => {
    const q = await getScopedQuery("salesOrders");
    const rows = await getDocsWithFallback(q, "salesOrders", null);

    let ap = { state: "Andhra Pradesh", orders: 0, capacity: 0, revenue: 0, salesValue: 0 };
    let ts = { state: "Telangana", orders: 0, capacity: 0, revenue: 0, salesValue: 0 };

    rows.forEach((row) => {
      const d = row.data || row;

      if (filters.zone !== "All" && (d.sales_zone || "") !== filters.zone)
        return;

      if (!isDateInFilter(d.createdAt, filters)) return;

      const st = (d.state || "").toLowerCase();
      let target = null;

      if (st.includes("andhra")) target = ap;
      if (st.includes("telangana") || st === "ts") target = ts;
      if (!target) return;

      target.orders++;
      target.capacity += Number(d.capacity || 0);
      target.salesValue += Number(d.invoiceAmount || 0);

      if (isDateInFilter(d.firstPaymentDate, filters))
        target.revenue += Number(d.firstPayment || 0);

      if (isDateInFilter(d.secondPaymentDate, filters))
        target.revenue += Number(d.secondPayment || 0);

      if (isDateInFilter(d.thirdPaymentDate, filters))
        target.revenue += Number(d.thirdPayment || 0);

      if (isDateInFilter(d.fourthPaymentDate, filters))
        target.revenue += Number(d.fourthPayment || 0);
    });

    let result = [ap, ts];

    // Sorting Logic
    result.sort((a, b) =>
      sortOrder === "asc" ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy]
    );

    setData(result);
  };

  return (
    <div style={{ width: "100%", height: 260 }}>
      
      {/* Sorting Dropdowns */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <select className="dashSelect" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="orders">Orders</option>
          <option value="capacity">Capacity</option>
          <option value="revenue">Revenue</option>
          <option value="salesValue">Sales Value</option>
        </select>

        <select className="dashSelect" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
          <option value="desc">DESC</option>
          <option value="asc">ASC</option>
        </select>
      </div>

      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="state" />
          <YAxis />
          <Tooltip />
          <Legend />

          <Bar dataKey="capacity" fill="#11998e" name="Capacity" />
          <Bar dataKey="orders" fill="#6a11cb" name="Orders" />
          <Bar dataKey="revenue" fill="#F7971E" name="Revenue ₹" />
          <Bar dataKey="salesValue" fill="#4A90E2" name="Sales Value ₹" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
