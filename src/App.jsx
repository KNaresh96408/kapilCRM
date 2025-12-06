import React, { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
  Outlet,
  useParams
} from "react-router-dom";

// Core
import Login from "./Login";

// CRM pages
import Home from "./components/Home";
import LeadsDashboard from "./components/LeadsDashboard";
import DealsDashboard from "./components/DealsDashboard";
import QuotationsDashboard from "./components/QuotationsDashboard";
import SalesOrders from "./components/SalesOrders";
import Projects from "./components/Projects";
import SettingsPage from "./components/Settings/SettingsPage";
import CreateModule from "./components/Settings/CreateModule";
import EditModule from "./components/Settings/EditModule";
import EditLayoutPage from "./components/Settings/EditLayoutPage";
import ForgotPassword from "./pages/ForgotPassword";
import VerifyOTP from "./pages/VerifyOTP";
import ResetPassword from "./pages/ResetPassword";
import PermissionGate from "./components/PermissionGate";


// Quotation pages
import QuotationDrawer from "./components/QuotationDrawer";
import QuotationPreview from "./components/QuotationPreview";

// New pages
import AppSelect from "./components/AppSelect";
import Attendance from "./components/Attendance";

// CRM Navbar
import TopNavbar from "./components/TopNavbar";
import AttendancePage from "./components/AttendancePage";

// Dynamic Modules
import DynamicListWrapper from "./components/Dynamic/Wrappers/DynamicListWrapper";
import DynamicCreateWrapper from "./components/Dynamic/Wrappers/DynamicCreateWrapper";
import DynamicDetailWrapper from "./components/Dynamic/Wrappers/DynamicDetailWrapper";
import DynamicEditWrapper from "./components/Dynamic/Wrappers/DynamicEditWrapper";

// Module Permission Page
import ModulePermission from "./components/Settings/ModulePermission";

// ------------------------------------------------------
// Module Permission Wrapper
// ------------------------------------------------------
const ModulePermissionWrapper = () => {
  const { moduleName } = useParams();
  return <ModulePermission moduleName={moduleName} />;
};

// ------------------------------------------------------
// CRM Layout
// ------------------------------------------------------
function CRMLayout() {
  const location = useLocation();
  const hideNavbar = location.pathname === "/crm/home";

  return (
    <>
      {!hideNavbar && <TopNavbar />}
      <div style={{ marginTop: "0px" }}>
        <Outlet />
      </div>
    </>
  );
}

// ------------------------------------------------------
// Main Layout
// ------------------------------------------------------
function Layout() {
  const location = useLocation();

  const hideNavbar =
    location.pathname === "/" ||
    location.pathname === "/apps" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/verify-otp" ||
    location.pathname.startsWith("/reset-password") ||
    location.pathname.startsWith("/attendance");

  const [open, setOpen] = useState(false);

  const testDeal = { id: "D001", kpiId: "KPI-101" };
  const testQuotation = { customerName: "John Doe" };

  return (
    <>
      {!hideNavbar && !location.pathname.startsWith("/crm") && <TopNavbar />}

      <Routes>
        <Route path="/" element={<Login />} />

        {/* Reset Password */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOTP />} />
        <Route path="/reset-password-final" element={<ResetPassword />} />

        {/* Applications */}
        <Route path="/apps" element={<AppSelect />} />

        {/* Home */}
        <Route path="/home" element={<Home />} />

        {/* Settings */}
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/create-module" element={<CreateModule />} />
        <Route path="/settings/module/:moduleName" element={<EditModule />} />

        {/* ⭐ Correct Route for Module Permission */}
        <Route
          path="/settings/module/:moduleName/permissions"
          element={<ModulePermissionWrapper />}
        />

        <Route path="/settings/edit-layout" element={<EditLayoutPage />} />

        {/* Backward compatibility */}
        <Route
          path="/settings/module/:moduleName/layout"
          element={<EditLayoutPage />}
        />

        {/* CRM */}
        <Route path="/crm" element={<CRMLayout />}>
          <Route path="home" element={<Home />} />
          <Route
  path="leads"
  element={
    <PermissionGate moduleName="leads">
      <LeadsDashboard />
    </PermissionGate>
  }
/>
          <Route
  path="deals"
  element={
    <PermissionGate moduleName="deals">
      <DealsDashboard />
    </PermissionGate>
  }
/>
          
<Route
  path="salesOrders"
  element={
    <PermissionGate moduleName="salesOrders">
      <SalesOrders />
    </PermissionGate>
  }
/>
          <Route
  path="projects"
  element={
    <PermissionGate moduleName="projects">
      <Projects />
    </PermissionGate>
  }
/>
          <Route path="quotationsDashboard" element={<QuotationsDashboard />} />

          {/* Dynamic Modules */}
          <Route path="modules/:module/list" element={<DynamicListWrapper />} />
          <Route path="modules/:module/create" element={<DynamicCreateWrapper />} />
          <Route path="modules/:module/view/:id" element={<DynamicDetailWrapper />} />
          <Route path="modules/:module/edit/:id" element={<DynamicEditWrapper />} />

          {/* ❌ Removed WRONG route here */}
        </Route>

        {/* Attendance */}
        <Route path="/attendance" element={<Attendance />} />

        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </>
  );
}

// ------------------------------------------------------
// Reset Listener
// ------------------------------------------------------
function ResetListener() {
  const location = useLocation();

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mode = params.get("mode");
    const oob = params.get("oobCode");

    if (mode === "resetPassword" && oob) {
      window.location.href = `/reset-password?mode=${mode}&oobCode=${oob}`;
    }
  }, [location.search]);

  return null;
}

// ------------------------------------------------------
// Main Export
// ------------------------------------------------------
export default function App() {
  return (
    <Router>
      <ResetListener />
      <Layout />
    </Router>
  );
}
