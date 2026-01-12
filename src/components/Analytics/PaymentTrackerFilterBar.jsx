import React, { useState } from "react";
import { useDashboardFilters } from "../../context/DashboardFilterContext";

export default function FilterBar({ title }) {
  const { filters, setFilters } = useDashboardFilters();

  const [showDate, setShowDate] = useState(false);
  const [tempStart, setTempStart] = useState("");
  const [tempEnd, setTempEnd] = useState("");

  const months = [
    "All","January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  const zones = [
    "All",
    "Warangal",
    "Hyd",
    "Vijayawada",
    "Vizag",
    "Kadapa"
  ];

  const applyDates = () => {
    if (!tempStart || !tempEnd) return;

    setFilters(prev => ({
      ...prev,
      startDate: new Date(tempStart),
      endDate: new Date(tempEnd),
    }));

    setShowDate(false);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <h2>{title}</h2>

      {/* Filters Row */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>

        {/* 🟢 ZONE FILTER */}
        <select
          value={filters.zone}
          onChange={e =>
            setFilters(prev => ({ ...prev, zone: e.target.value }))
          }
        >
          {zones.map(z => <option key={z}>{z}</option>)}
        </select>

        <select
  value={filters.year}
  onChange={(e) =>
    setFilters(prev => ({ ...prev, year: e.target.value }))
  }
>
  <option>All</option>
  <option>2024</option>
  <option>2025</option>
  <option>2026</option>
  <option>2027</option>
</select>


        {/* 🟢 MONTH FILTER */}
        <select
          value={filters.month}
          onChange={e =>
            setFilters(prev => ({ ...prev, month: e.target.value }))
          }
        >
          {months.map(m => <option key={m}>{m}</option>)}
        </select>
        {/* 🟣 60% RECEIVED FILTER */}
<select
  value={filters.sixtyFilter || "All"}
  onChange={e =>
    setFilters(prev => ({ ...prev, sixtyFilter: e.target.value }))
  }
>
  <option value="All">60% All</option>
  <option value="YES">60% Received</option>
  <option value="NO">60% Not Received</option>
</select>

        {/* 🟢 CUSTOM DATE BUTTON */}
        <button onClick={() => setShowDate(!showDate)}>
          Custom Date
        </button>

        {showDate && (
          <>
            <input
              type="date"
              value={tempStart}
              onChange={e => setTempStart(e.target.value)}
            />

            <input
              type="date"
              value={tempEnd}
              onChange={e => setTempEnd(e.target.value)}
            />

            <button onClick={applyDates}>Apply</button>
          </>
        )}
      </div>
    </div>
  );
}
