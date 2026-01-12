import React from "react";
import { DashboardFilterProvider } from "../../context/DashboardFilterContext";

import FilterBar from "./components/FilterBar";

// ***** ADD THIS *****
import KpiCards from "./components/KpiCards";

import SectionCard from "./components/SectionCard";
import ConsultantsPerformance from "./components/ConsultantsPerformance";
import TelecallersPerformance from "./components/TelecallersPerformance";

export default function PerformanceDashboard() {
  return (
    <DashboardFilterProvider>
      <div
        style={{
          padding: "25px",
          background: "#f4f6fb",
          minHeight: "100%",
        }}
      >
        {/* Header + Filters */}
        <FilterBar title="Performance Dashboard" />

        {/* ******** KPI CARDS HERE (Exactly like Sales Dashboard) ******** */}
        <KpiCards />

        {/* ******** SECTIONS ******** */}
        <SectionCard title="Consultants Performance">
          <ConsultantsPerformance />
        </SectionCard>

        <SectionCard title="Telecallers Performance">
          <TelecallersPerformance />
        </SectionCard>
      </div>
    </DashboardFilterProvider>
  );
}
