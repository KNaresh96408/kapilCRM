import React from "react";
import { DashboardFilterProvider } from "../../context/DashboardFilterContext";



import FilterBar from "./components/FilterBar";
import KpiCards from "./components/KpiCards";
import SectionCard from "./components/SectionCard";
import APvsTSChart from "./components/APvsTSChart";
import ZoneWiseChart from "./components/ZoneWiseChart";

export default function SalesDashboard() {
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
        <FilterBar title="Sales Dashboard" />

        {/* KPI CARDS */}
        <KpiCards />

        {/* SECTION - State Wise */}
        <SectionCard title="State Wise Comparison – Orders | Capacity | Revenue | Sales Value">
          <APvsTSChart />
        </SectionCard>

        {/* SECTION - Zone Wise */}
        <SectionCard title="Zone Wise Comparison – Orders | Capacity | Revenue | Sales Value">
          <ZoneWiseChart />
        </SectionCard>
      </div>
    </DashboardFilterProvider>
  );
}
