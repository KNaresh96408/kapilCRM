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

export default function ZoneWiseChart() {
  const [rawOrders, setRawOrders] = useState([]);
  const [data, setData] = useState([]);
  const user = JSON.parse(localStorage.getItem("kp-user") || "{}");

  const [sortBy, setSortBy] = useState("orders");
  const [sortOrder, setSortOrder] = useState("desc");

  const { filters } = useDashboardFilters();

  useEffect(() => {
    loadZoneData();
  }, []);

  useEffect(() => {
    buildChartData();
  }, [rawOrders, filters, sortBy, sortOrder]);

  const loadZoneData = async () => {
    const q = await getScopedQuery("salesOrders");
    const snap = await getDocs(q);
    let arr = [];
    snap.forEach(doc => arr.push(doc.data()));
    setRawOrders(arr);
  };

  const buildChartData = () => {
    let zones = {};

    rawOrders.forEach(d => {
      const zone = (d.sales_zone || d.zone || "Unknown").trim();
      const created = d.createdAt ? new Date(d.createdAt.toDate()) : null;

      if (filters.zone !== "All" && zone !== filters.zone) return;

      if (!isDateInFilter(d.createdAt, filters)) return;

      if (!zones[zone]) {
        zones[zone] = { zone, orders: 0, capacity: 0, revenue: 0, salesValue: 0 };
      }

      zones[zone].orders++;
      zones[zone].capacity += Number(d.capacity || 0);
      zones[zone].salesValue += Number(d.invoiceAmount || 0);

      // --- Revenue Correct Logic ---
      if (isDateInFilter(d.firstPaymentDate, filters))
        zones[zone].revenue += Number(d.firstPayment || 0);

      if (isDateInFilter(d.secondPaymentDate, filters))
        zones[zone].revenue += Number(d.secondPayment || 0);

      if (isDateInFilter(d.thirdPaymentDate, filters))
        zones[zone].revenue += Number(d.thirdPayment || 0);

      if (isDateInFilter(d.fourthPaymentDate, filters))
        zones[zone].revenue += Number(d.fourthPayment || 0);
    });

    let result = Object.values(zones);

    result.sort((a, b) =>
      sortOrder === "asc" ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy]
    );

    setData(result);
  };

  return (
    <div style={{ width: "100%", height: 300 }}>
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
          <XAxis dataKey="zone" />
          <YAxis />
          <Tooltip />
          <Legend />

          <Bar dataKey="capacity" fill="#11998e" name="Capacity (KW)" />
          <Bar dataKey="orders" fill="#6a11cb" name="Orders" />
          <Bar dataKey="revenue" fill="#ff6a00" name="Revenue ₹" />
          <Bar dataKey="salesValue" fill="#4A90E2" name="Sales Value ₹" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
