import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../firebase/firebaseConfig";
import { useDashboardFilters } from "../../../context/DashboardFilterContext";
import { isDateInFilter } from "../../utils/isDateInFilter";
import { getScopedQuery } from "../../../helpers/getScopedQuery";

export default function KpiCards() {
  const { filters } = useDashboardFilters();
  const user = JSON.parse(localStorage.getItem("kp-user") || "{}");

  const [orders, setOrders] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [salesValue, setSalesValue] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    loadData();
  }, [filters]);

  const loadData = async () => {
    const q = await getScopedQuery("salesOrders");
const snap = await getDocs(q);

    let o = 0, c = 0, sv = 0, r = 0, p = 0;

    snap.forEach(doc => {
      const d = doc.data();

      if (filters.zone !== "All" && (d.sales_zone || d.salesArea) !== filters.zone)
        return;

      if (!isDateInFilter(d.createdAt, filters)) return;

      o++;
      c += Number(d.capacity || 0);
      sv += Number(d.invoiceAmount || 0);

      if (isDateInFilter(d.firstPaymentDate, filters))
        r += Number(d.firstPayment || 0);

      if (isDateInFilter(d.secondPaymentDate, filters))
        r += Number(d.secondPayment || 0);

      if (isDateInFilter(d.thirdPaymentDate, filters))
        r += Number(d.thirdPayment || 0);

      if (isDateInFilter(d.fourthPaymentDate, filters))
        r += Number(d.fourthPayment || 0);

      p += Number(d.invoiceAmount || 0) - Number(d.paymentReceived || 0);
    });

    setOrders(o);
    setCapacity(c);
    setSalesValue(sv);
    setRevenue(r);
    setPending(p);
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
      gap: "12px",
    }}>
      <Card color="linear-gradient(135deg,#6a11cb,#2575fc)" title="Sales Orders" value={orders} />
      <Card color="linear-gradient(135deg,#6a00ff,#8b00c9)" title="Overall Sales Value" value={`₹${salesValue.toLocaleString()}`} />
      <Card color="linear-gradient(135deg,#6200ff,#7f00ff)" title="Revenue" value={`₹${revenue.toLocaleString()}`} />
      <Card color="linear-gradient(135deg,#ffb000,#ff8800)" title="Pending" value={`₹${pending.toLocaleString()}`} />
      <Card color="linear-gradient(135deg,#00c98d,#27ff7a)" title="Capacity" value={`${capacity} KW`} />
    </div>
  );
}

const Card = ({ color, title, value }) => (
  <div style={{
    padding: "16px",
    borderRadius: "18px",
    background: color,
    color: "white",
    minHeight: "90px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  }}>
    <p>{title}</p>
    <h2>{value}</h2>
  </div>
);
