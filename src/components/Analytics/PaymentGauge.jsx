import React from "react";
import { PieChart, Pie, Cell } from "recharts";

export default function PaymentGauge({ received, target }) {
  const percentage = target > 0 ? Math.min((received / target) * 100, 100) : 0;

  const data = [
    { value: percentage },
    { value: 100 - percentage },
  ];

  const COLORS = ["#6a11cb", "#e6e6e6"];

  return (
    <div
      style={{
        background: "white",
        borderRadius: 20,
        border: "1px solid #ddd",
        padding: 30,
        marginBottom: 30,
      }}
    >
      <h2 style={{ marginBottom: 5 }}>Payment Achievement</h2>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <PieChart width={650} height={330}>
          <Pie
            data={data}
            cx="50%"
            cy="95%"
            startAngle={180}
            endAngle={0}
            innerRadius={140}
            outerRadius={190}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={COLORS[index]} />
            ))}
          </Pie>
        </PieChart>
      </div>

      <h1 style={{ textAlign: "center", marginTop: -130 }}>
        {percentage.toFixed(1)}%
      </h1>

      <p style={{ textAlign: "center", color: "#444", fontSize: 18 }}>
        ₹{received.toLocaleString()} / ₹{target.toLocaleString()}
      </p>
    </div>
  );
}
