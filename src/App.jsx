import { App as CapacitorApp } from "@capacitor/app";
import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
  Outlet,
  useParams
} from "react-router-dom";

import { useNavigate } from "react-router-dom";

// 🔐 LOGIN PROTECTION
import ProtectedRoute from "./components/ProtectedRoute";

// Core
import Login from "./Login";

// CRM pages
import Home from "./components/Home";
import LeadsDashboard from "./components/LeadsDashboard";
import DealsDashboard from "./components/DealsDashboard";
import QuotationsDashboard from "./components/QuotationsDashboard";
import SalesOrders from "./components/SalesOrders";
import Projects from "./components/Projects";
// Analytics Dashboards (Phase-1 Shell Pages)
import AnalyticsHome from "./components/Analytics/AnalyticsHome";
import SalesDashboard from "./components/Analytics/SalesDashboard";
import PerformanceDashboard from "./components/Analytics/PerformanceDashboard";
import PaymentTracker from "./components/Analytics/PaymentTracker";
import OperationsAnalytics from "./components/Analytics/OperationsAnalytics";
import SettingsPage from "./components/Settings/SettingsPage";
import { DashboardFilterProvider } from "./context/DashboardFilterContext";
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
import SurveyStart from "./pages/siteSurvey/SurveyStart";
import SurveyForm from "./pages/siteSurvey/SurveyForm";
import SurveySubmitted from "./pages/siteSurvey/SurveySubmitted";
import SurveyReportView from "./pages/siteSurvey/SurveyReportView";


// ------------------------------------------------------------------
// ANDROID BACK BUTTON HANDLER
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// ANDROID BACK BUTTON HANDLER (FINAL – Apps Page Logic)
// ------------------------------------------------------------------
function useAndroidBackHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // ✅ RUN ONLY ON ANDROID
    if (!window.Capacitor?.isNativePlatform?.()) return;

    let backPressedOnce = false;

    const handler = () => {
      const path = location.pathname;
      console.log("🔙 BACK:", path);

      // 1️⃣ CRM inner pages → go back
      if (path.startsWith("/crm") && path !== "/crm/home") {
        navigate(-1);
        return;
      }

      // 2️⃣ Home / CRM Home → Apps
      if (path === "/home" || path === "/crm/home") {
        navigate("/apps");
        return;
      }

      // 3️⃣ Apps → double back to exit
      if (path === "/apps") {
        if (backPressedOnce) {
          navigator.app?.exitApp?.();
          return;
        }

        backPressedOnce = true;
        alert("Press back again to exit");

        setTimeout(() => {
          backPressedOnce = false;
        }, 2000);

        return;
      }

      // 4️⃣ Fallback
      navigate(-1);
    };

    document.addEventListener("backbutton", handler);

    return () => {
      document.removeEventListener("backbutton", handler);
    };
  }, [location.pathname, navigate]);
}

export function BackHandlerWrapper() {
  useAndroidBackHandler();
  return null;
}

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

      <div className="main-scroll">
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
  location.pathname.startsWith("/attendance") ||
  location.pathname.startsWith("/site-survey") ||
  location.pathname.startsWith("/survey-report");



  const [open, setOpen] = useState(false);

  return (
    <>
      {!hideNavbar && !location.pathname.startsWith("/crm") && <TopNavbar />}

      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOTP />} />
        <Route path="/reset-password-final" element={<ResetPassword />} />
        <Route path="/apps" element={<AppSelect />} />

        {/* 🔐 PROTECTED ROUTES BELOW */}

        {/* Home */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />

        {/* Settings */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/create-module"
          element={
            <ProtectedRoute>
              <CreateModule />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/module/:moduleName"
          element={
            <ProtectedRoute>
              <EditModule />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/module/:moduleName/permissions"
          element={
            <ProtectedRoute>
              <ModulePermissionWrapper />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/edit-layout"
          element={
            <ProtectedRoute>
              <EditLayoutPage />
            </ProtectedRoute>
          }
        />

        {/* CRM Protected */}
        <Route
          path="/crm"
          element={
            <ProtectedRoute>
              <CRMLayout />
            </ProtectedRoute>
          }
        >
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
              <PermissionGate moduleName="sales-orders">
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
          {/*  ANALYTICS ROOT PAGE  */}
<Route path="analytics" element={<AnalyticsHome />} />

{/*  INDIVIDUAL DASHBOARDS  */}
<Route path="analytics/sales" element={<SalesDashboard />} />
<Route
  path="analytics/performance"
  element={
    <DashboardFilterProvider>
      <PerformanceDashboard />
    </DashboardFilterProvider>
  }
/>
<Route
  path="analytics/payment-tracker"
  element={
    <DashboardFilterProvider>
      <PaymentTracker />
    </DashboardFilterProvider>
  }
/>

<Route
  path="analytics/operations"
  element={
    <ProtectedRoute>
      <OperationsAnalytics />
    </ProtectedRoute>
  }
/>

          <Route path="quotationsDashboard" element={<QuotationsDashboard />} />

          {/* Dynamic modules */}
          <Route path="modules/:module/list" element={<DynamicListWrapper />} />
          <Route path="modules/:module/create" element={<DynamicCreateWrapper />} />
          <Route path="modules/:module/view/:id" element={<DynamicDetailWrapper />} />
          <Route path="modules/:module/edit/:id" element={<DynamicEditWrapper />} />
        </Route>

        {/* Attendance */}
        <Route
          path="/attendance"
          element={
            <ProtectedRoute>
              <Attendance />
            </ProtectedRoute>
          }
        />
        <Route path="/site-survey/start/:dealId/:token" element={<SurveyStart />} />
<Route path="/site-survey/form/:dealId/:token" element={<SurveyForm />} />
<Route path="/site-survey/completed" element={<SurveySubmitted />} />
<Route path="/survey-report/:dealId" element={<SurveyReportView />} />


        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </>
  );
}


// ------------------------------------------------------
// RESET PASSWORD LISTENER
// ------------------------------------------------------
function ResetListener() {
  const location = useLocation();

  useEffect(() => {
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
// MAIN APP EXPORT
// ------------------------------------------------------
export default function App() {
  return (
    <Router>
      <BackHandlerWrapper />
      <ResetListener />
      <Layout />
    </Router>
  );
}
