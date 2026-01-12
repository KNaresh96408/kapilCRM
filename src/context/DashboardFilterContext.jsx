import { createContext, useContext, useState } from "react";

const DashboardFilterContext = createContext();

export const DashboardFilterProvider = ({ children }) => {
  const [filters, setFilters] = useState({
    zone: "All",
    year: "All",
    month: "All",
    startDate: null,
    endDate: null,
    sixtyFilter: "All",
  });

  return (
    <DashboardFilterContext.Provider value={{ filters, setFilters }}>
      {children}
    </DashboardFilterContext.Provider>
  );
};

export const useDashboardFilters = () => useContext(DashboardFilterContext);
