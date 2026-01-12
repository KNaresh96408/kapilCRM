import React from "react";
import { DashboardFilterProvider } from "../../context/DashboardFilterContext";
import OperationsDashboard from "./OperationsDashboard";

const OperationsAnalytics = () => {
  return (
    <DashboardFilterProvider>
      <div style={{ padding: 30 }}>
        <h1 style={{ marginBottom: 10 }}>Operations Dashboard</h1>

        {/* DIRECT DASHBOARD */}
        <OperationsDashboard />
      </div>
    </DashboardFilterProvider>
  );
};

export default OperationsAnalytics;
