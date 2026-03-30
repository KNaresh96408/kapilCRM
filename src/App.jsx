// Books (ERP Sales)
import BooksLayout from "./modules/books/BooksLayout";
import CustomerDetails from "./modules/books/sales/CustomerDetails";
import DeliveryChallans from "./modules/books/sales/DeliveryChallans";
import Invoices from "./modules/books/sales/Invoices";
import CreditNotes from "./modules/books/sales/CreditNotes";
import PaymentReceivables from "./modules/books/sales/PaymentReceivables";
import React, { useEffect } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
  Outlet,
  useParams
} from "react-router-dom";

import { useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

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
import BooksHome from './modules/books/BooksHome'; // Importing BooksHome for routing
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
import OrganizationPage from "./pages/Organization/OrganizationPage";
import NotificationsPage from "./pages/NotificationsPage";
import MailSetupPage from "./pages/MailSetupPage";
import MeetingsPage from "./pages/MeetingsPage";
import WebNotificationListener from "./components/WebNotificationListener";
import AttachmentsPage from "./modules/attachments/pages/AttachmentsPage";
import { BRAND_MAROON_PURPLE_GRADIENT } from "./styles/brandTheme";
import KapilChatWidget from "./components/KapilChatWidget";


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

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const isServiceEngineerRole = (role) => {
  const r = normalizeRole(role);
  return r === "service_engineer" || r === "service_enginner";
};

const SERVICE_ENGINEER_ALLOWED_MODULES = new Set([
  "attendance",
  "notifications",
  "mail",
  "meetings",
]);

function RoleModuleGate({ moduleKey = "", children }) {
  const { user, roleData } = useAuth();

  let sessionRole = "";
  try {
    const stored = localStorage.getItem("kp-user");
    const parsed = stored ? JSON.parse(stored) : null;
    sessionRole = parsed?.role || parsed?.Role || parsed?.profile?.role || parsed?.profile?.Role || "";
  } catch {
    sessionRole = "";
  }

  const role =
    user?.role ||
    user?.Role ||
    roleData?.role ||
    roleData?.Role ||
    sessionRole ||
    "";

  if (!isServiceEngineerRole(role)) return <>{children}</>;
  if (SERVICE_ENGINEER_ALLOWED_MODULES.has(String(moduleKey || "").trim().toLowerCase())) {
    return <>{children}</>;
  }

  return <Navigate to="/apps" replace />;
}


// ------------------------------------------------------
// CRM Layout
// ------------------------------------------------------
function CRMLayout() {
  const location = useLocation();
  const hideNavbar =
    location.pathname.startsWith("/crm/attachments") ||
    location.pathname.startsWith("/crm/meetings");
  const isAnalyticsRoute = location.pathname.startsWith("/crm/analytics");
  const normalizedCrmPath = String(location.pathname || "").replace(/\/+$/, "");
  const showHomeScrollbar = normalizedCrmPath === "/crm/home";

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {!hideNavbar && <TopNavbar />}

      <div
        className={`main-scroll${showHomeScrollbar ? " home-vertical-scroll" : ""}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: showHomeScrollbar ? "scroll" : "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
          paddingTop: 0,
          background: isAnalyticsRoute ? "#ffffff" : BRAND_MAROON_PURPLE_GRADIENT,
          paddingLeft: 10,
          paddingRight: 10,
          paddingBottom: 12,
        }}
      >
        <Outlet />
      </div>
    </div>
  );
}



// ------------------------------------------------------
// Main Layout
// ------------------------------------------------------
function Layout() {
  const location = useLocation();
  console.log("🧭 Layout render | pathname:", location.pathname);
console.log("🌍 ROUTER LOCATION:", window.location.href);
  const hideNavbar =
  location.pathname === "/" ||
  location.pathname === "/apps" ||
  location.pathname === "/notifications" ||
  location.pathname.startsWith("/mail") ||
  location.pathname === "/forgot-password" ||
  location.pathname === "/verify-otp" ||
  location.pathname.startsWith("/reset-password") ||
  location.pathname.startsWith("/attendance") ||
  location.pathname.startsWith("/organization") ||
  location.pathname.startsWith("/site-survey") ||
  location.pathname.startsWith("/survey-report");

  return (
    <>
      <WebNotificationListener />
      {!hideNavbar && !location.pathname.startsWith("/crm") && !location.pathname.startsWith("/books") && <TopNavbar />}

      <Routes>
        {/* BOOKS ERP SALES ROUTES */}
        {/* Books module uses its own layout, no CRM navbar */}
        <Route
          path="/books/*"
          element={
            <RoleModuleGate moduleKey="books">
              <BooksLayout />
            </RoleModuleGate>
          }
        >
          <Route index element={<BooksHome />} />
          {/* Sales subroutes */}
          <Route path="sales/customer-details" element={<CustomerDetails />} />
          <Route path="sales/delivery-challans" element={<DeliveryChallans />} />
          <Route path="sales/invoices" element={<Invoices />} />
          <Route path="sales/credit-notes" element={<CreditNotes />} />
          <Route path="sales/payment-receivables" element={<PaymentReceivables />} />
          {/* Default sales route */}
          <Route path="sales" element={<Navigate to="sales/customer-details" replace />} />
          {/* TODO: Add purchase and inventory subroutes here */}
        </Route>
        {/* Public Routes */}
        <Route path="/" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOTP />} />
        <Route path="/reset-password-final" element={<ResetPassword />} />
        <Route
  path="/apps"
  element={
    <ProtectedRoute>
      <AppSelect />
    </ProtectedRoute>
  }
/>

        {/* 🔐 PROTECTED ROUTES BELOW */}

        {/* Home */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="crm">
                <Home />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        {/* Settings */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="settings">
                <SettingsPage />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/create-module"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="settings">
                <CreateModule />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/module/:moduleName"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="settings">
                <EditModule />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/module/:moduleName/permissions"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="settings">
                <ModulePermissionWrapper />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings/edit-layout"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="settings">
                <EditLayoutPage />
              </RoleModuleGate>
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
          <Route
            path="home"
            element={
              <RoleModuleGate moduleKey="crm">
                <Home />
              </RoleModuleGate>
            }
          />

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

          <Route
            path="attachments"
            element={
              <PermissionGate moduleName="attachments">
                <AttachmentsPage />
              </PermissionGate>
            }
          />

          <Route
            path="meetings"
            element={
              <RoleModuleGate moduleKey="meetings">
                <MeetingsPage />
              </RoleModuleGate>
            }
          />
          {/*  ANALYTICS ROOT PAGE  */}
<Route
  path="analytics"
  element={
    <RoleModuleGate moduleKey="analytics">
      <AnalyticsHome />
    </RoleModuleGate>
  }
/>

{/*  INDIVIDUAL DASHBOARDS  */}
<Route
  path="analytics/sales"
  element={
    <RoleModuleGate moduleKey="analytics">
      <SalesDashboard />
    </RoleModuleGate>
  }
/>
<Route
  path="analytics/performance"
  element={
    <RoleModuleGate moduleKey="analytics">
      <DashboardFilterProvider>
        <PerformanceDashboard />
      </DashboardFilterProvider>
    </RoleModuleGate>
  }
/>
<Route
  path="analytics/payment-tracker"
  element={
    <RoleModuleGate moduleKey="analytics">
      <DashboardFilterProvider>
        <PaymentTracker />
      </DashboardFilterProvider>
    </RoleModuleGate>
  }
/>

<Route
  path="analytics/operations"
  element={
    <RoleModuleGate moduleKey="analytics">
      <OperationsAnalytics />
    </RoleModuleGate>
  }
/>

          <Route
            path="quotationsDashboard"
            element={
              <RoleModuleGate moduleKey="crm">
                <QuotationsDashboard />
              </RoleModuleGate>
            }
          />

          {/* Dynamic modules */}
          <Route
            path="modules/:module/list"
            element={
              <RoleModuleGate moduleKey="crm">
                <DynamicListWrapper />
              </RoleModuleGate>
            }
          />
          <Route
            path="modules/:module/create"
            element={
              <RoleModuleGate moduleKey="crm">
                <DynamicCreateWrapper />
              </RoleModuleGate>
            }
          />
          <Route
            path="modules/:module/view/:id"
            element={
              <RoleModuleGate moduleKey="crm">
                <DynamicDetailWrapper />
              </RoleModuleGate>
            }
          />
          <Route
            path="modules/:module/edit/:id"
            element={
              <RoleModuleGate moduleKey="crm">
                <DynamicEditWrapper />
              </RoleModuleGate>
            }
          />
        </Route>

        {/* Attendance */}
        <Route
  path="/attendance"
  element={
    <ProtectedRoute>
      <RoleModuleGate moduleKey="attendance">
        <Attendance />
      </RoleModuleGate>
    </ProtectedRoute>
  }
/>

        <Route
          path="/organization/*"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="organization">
                <OrganizationPage />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="notifications">
                <NotificationsPage />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/mail"
          element={
            <ProtectedRoute>
              <RoleModuleGate moduleKey="mail">
                <MailSetupPage />
              </RoleModuleGate>
            </ProtectedRoute>
          }
        />

        <Route path="/site-survey/start/:dealId/:token" element={<SurveyStart />} />
<Route path="/site-survey/form/:dealId/:token" element={<SurveyForm />} />
<Route path="/site-survey/completed" element={<SurveySubmitted />} />
<Route path="/survey-report/:dealId" element={<SurveyReportView />} />


        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>

      <KapilChatWidget />
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

function LegacyDeepLinkRedirector() {
  useEffect(() => {
    const { origin, pathname, search, hash } = window.location;
    if (hash && hash.startsWith("#/")) return;

    const deepPrefixes = ["/site-survey/", "/survey-report/"];
    if (!deepPrefixes.some((prefix) => pathname.startsWith(prefix))) return;

    const next = `${origin}/#${pathname}${search || ""}`;
    window.location.replace(next);
  }, []);

  return null;
}


// ------------------------------------------------------
// MAIN APP EXPORT
// ------------------------------------------------------
export default function App() {
  return (
    <Router>
      <LegacyDeepLinkRedirector />
      <ResetListener />
      <Layout />
    </Router>
  );
}
