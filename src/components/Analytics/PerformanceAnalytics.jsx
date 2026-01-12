import React from "react";
import FilterBar from "./FilterBar";

import ConsultantsPerformance from "./ConsultantsPerformance";
import TelecallersPerformance from "./TelecallersPerformance";

export default function PerformanceAnalytics() {
  return (
    <div style={{ padding: 30 }}>
      <h1>Performance Dashboard</h1>

      {/* ------ Filters ------ */}
      <FilterBar />

      <div style={{ marginTop: 20 }}>
        {/* ------ Consultant Performance Section ------ */}
        <ConsultantsPerformance />

        {/* ------ Telecaller Performance Section ------ */}
        <TelecallersPerformance />
      </div>
    </div>
  );
}
