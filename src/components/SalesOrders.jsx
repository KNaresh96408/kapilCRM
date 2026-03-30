// src/components/SalesOrders.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { query, orderBy, doc, onSnapshot, collection, where, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as XLSX from "xlsx";
import SalesOrderDrawer from "./SalesOrderDrawer";
import { usePermission } from "../hooks/usePermission";
// add these imports
import { useLocation, useNavigate } from "react-router-dom";
import { getScopedQuery } from "../helpers/getScopedQuery";
import { fetchCollectionDocs, getDocsWithFallback, fetchPagedDocs } from "../helpers/firestoreFetch";
import MassUpdateDialog from "./Universal/MassUpdateDialog";
import {
  getUserNameByEmailMap,
  importRowsToCollection,
  isAdminSessionUser,
  parseExcelRows,
} from "../helpers/bulkImport";

/**
 * SalesOrders.jsx
 *
 * - Table + sidebar UI modeled after LeadsDashboard (same look & behavior)
 * - Column menu opens at right side of screen and aligns vertically with clicked header
 * - Manage columns, pin/unpin columns, filter by column, sort asc/desc
 * - Export Excel (selected vs all; filtered vs all)
 * - Clicking a table row opens SalesOrderDrawer (edit only for admin)
 *
 * Columns (default):
 * KPI ID, Customer, Phone, Address, Capacity, Invoice Amount,
 * Payment Received, Pending, Payment %, Status, Created At
 *
 * Note: This component intentionally follows the same UX patterns as LeadsDashboard.
 */
const DEFAULT_COLUMNS = [
  { key: "kpiId", label: "KPI ID" },
  { key: "name", label: "Customer" },
  { key: "phone", label: "Phone" },
  { key: "state", label: "State" },
  { key: "sales_zone", label: "Sales Zone" },
  { key: "sales_area", label: "Sales Area" },
  { key: "zonal_manager", label: "Zonal Manager" },
{ key: "teleSale", label: "Tele-Sales" },
{ key: "consultantName", label: "Consultant Name" },
{ key: "assignedConsultant", label: "Assigned Consultant (Email)" },
{ key: "projectType", label: "Project Type" },
{ key: "lead_source", label: "Lead Source" },
  { key: "address", label: "Address" },
  { key: "capacity", label: "Capacity" },
  { key: "invoiceAmount", label: "Invoice Amount" },
  { key: "paymentReceived", label: "Payment Received" },
  { key: "pendingPayment", label: "Pending" },
  { key: "paymentPercentage", label: "Payment %" },
  { key: "paymentMode", label: "Payment Mode" },
  { key: "sixtyPercentReceived", label: "60% Received" },
{ key: "sixtyPercentDelayDays", label: "60% Delay Days" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created At" },
  { key: "updatedAt", label: "Updated At" },
  { key: "updatedBy", label: "Updated By" },
];

const MASS_UPDATE_FIELDS = DEFAULT_COLUMNS.filter(
  (c) => !["kpiId", "createdAt", "updatedAt", "updatedBy"].includes(c.key)
);

const isMobile = window.innerWidth <= 768;

const normalizeDocId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  return parts[parts.length - 1] || raw;
};

const normalizeScopeValue = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

const pickScopedDisplay = (rawValue, labelValue) => {
  const raw = String(rawValue || "").trim();
  const label = String(labelValue || "").trim();
  if (!label) return raw;
  if (!raw) return label;
  return normalizeScopeValue(raw) === normalizeScopeValue(label) ? label : raw;
};

const sanitizeLegacyUserDisplay = (value) => {
  const raw = String(value || "").trim();
  if (!raw || !raw.includes("|")) return raw;
  const parts = raw
    .split("|")
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (!parts.length) return raw;
  return parts.find((p) => !p.includes("@")) || parts[0];
};

const SIXTY_PERCENT_THRESHOLD = 59.5;
const PRE_SALES_THRESHOLD = 40;
const DAY_MS = 1000 * 60 * 60 * 24;
const NUMERIC_OPERATORS = ["<", ">", "=", "!="];
const USER_FILTER_KEYS = new Set([
  "consultantName",
  "teleSale",
  "assignedConsultant",
  "projectType",
  "state",
  "sales_zone",
  "sales_area",
  "zonal_manager",
]);
const SCOPE_FILTER_KEYS = new Set(["state", "sales_zone", "sales_area", "zonal_manager"]);
const NUMERIC_FILTER_KEYS = new Set([
  "paymentPercentage",
  "invoiceAmount",
  "paymentReceived",
  "pendingPayment",
  "capacity",
  "sixtyPercentDelayDays",
]);

const parseNumericFilterToken = (token) => {
  const raw = String(token || "").trim();
  if (!raw.startsWith("__num__:")) return null;
  const [, op = "", value = ""] = raw.split(":");
  if (!NUMERIC_OPERATORS.includes(op)) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return { op, value: num };
};

const runNumericFilter = (actualValue, parsedFilter) => {
  const num = Number(actualValue);
  if (!Number.isFinite(num) || !parsedFilter) return false;
  if (parsedFilter.op === "<") return num < parsedFilter.value;
  if (parsedFilter.op === ">") return num > parsedFilter.value;
  if (parsedFilter.op === "=") return num === parsedFilter.value;
  if (parsedFilter.op === "!=") return num !== parsedFilter.value;
  return false;
};

const formatScopeOptionLabel = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const normalizeFilterComparable = (value, key) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (SCOPE_FILTER_KEYS.has(key)) {
    return raw
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "");
  }
  return raw.toLowerCase();
};

const parsePaymentDate = (value) => {
  const parsed = toJSDate(value);
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;

  if (typeof value === "string") {
    const raw = value.trim();
    const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
      const day = Number(dmy[1]);
      const month = Number(dmy[2]);
      const year = Number(dmy[3]);
      const fallback = new Date(year, month - 1, day);
      if (!Number.isNaN(fallback.getTime())) return fallback;
    }
  }

  return null;
};

const atStartOfDay = (value) => {
  const d = parsePaymentDate(value);
  if (!d) return null;
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
};

const computeSixtyDelayMeta = ({ data, invoiceAmount, totalReceived, paymentPercentage }) => {
  const reachedByPercent = Number(paymentPercentage || 0) >= SIXTY_PERCENT_THRESHOLD;
  const reachedByAmount =
    Number(invoiceAmount || 0) > 0 && Number(totalReceived || 0) >= Number(invoiceAmount || 0) * 0.595;
  const storedStatus = String(data?.sixtyPercentReceived || "").trim().toUpperCase() === "YES";
  const sixtyPercentReceived = reachedByPercent || reachedByAmount || storedStatus ? "YES" : "NO";

  const candidates = [
    { amount: Number(data?.firstPayment || 0), date: data?.firstPaymentDate },
    { amount: Number(data?.secondPayment || 0), date: data?.secondPaymentDate },
    { amount: Number(data?.thirdPayment || 0), date: data?.thirdPaymentDate },
    { amount: Number(data?.fourthPayment || 0), date: data?.fourthPaymentDate },
  ];

  if (Number(data?.firstPayment || 0) <= 0 && Number(data?.tokenPayment || 0) > 0) {
    candidates.push({
      amount: Number(data?.tokenPayment || 0),
      date: data?.tokenPaymentDate || data?.firstPaymentDate || data?.createdAt,
    });
  }

  const paidDates = candidates
    .filter((c) => c.amount > 0)
    .map((c) => atStartOfDay(c.date))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  let startDate = paidDates[0] || null;
  if (!startDate && Number(totalReceived || 0) > 0) {
    startDate = atStartOfDay(data?.createdAt);
  }
  if (!startDate) {
    return { sixtyPercentReceived, sixtyPercentDelayDays: null };
  }

  const endSeed =
    sixtyPercentReceived === "YES"
      ? data?.sixtyPercentReceivedDate || data?.sixtyPercentReachedDate || new Date()
      : new Date();

  const endDate = atStartOfDay(endSeed) || atStartOfDay(new Date());
  const days = Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS);
  const sixtyPercentDelayDays = Number.isFinite(days) && days >= 0 ? days : 0;

  return { sixtyPercentReceived, sixtyPercentDelayDays };
};

export default function SalesOrders() {
  const perm = usePermission("sales-orders");

  if (perm.loading) {
    return (
      <p style={{ padding: 20, color: "#800000" }}>
        Checking permissions...
      </p>
    );
  }

  if (!perm.read) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "#800000" }}>
        <h2>🚫 Access Denied</h2>
        <p>You do not have permission to view Sales Orders.</p>
      </div>
    );
  }

  return <SalesOrdersInner perm={perm} />;
}

function SalesOrdersInner({ perm }) {
  const location = useLocation();
  const navigate = useNavigate();
  const canOpenDrawer = !!perm.update;

  const [salesOrders, setSalesOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  // table control state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [orderStageView, setOrderStageView] = useState("sales"); // sales | pre
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  // column visibility/pinning/filtering/menu
  const [visibleColumns, setVisibleColumns] = useState(
  DEFAULT_COLUMNS
    .map((c) => c.key)
    .filter(
      (k) =>
        ![
          "updatedAt",
          "updatedBy",
          "lead_source",
          "assignedConsultant", // 🔥 hide email column by default
        ].includes(k)
    )
);
  const [pinnedColumns, setPinnedColumns] = useState([]);
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 120, left: 40 });
  const [columnFilters, setColumnFilters] = useState({});
  const menuRef = useRef(null);
  const manageRef = useRef(null);
  const [showManageCols, setShowManageCols] = useState(false);

  // dynamic fields (from /crm_fields/salesOrders)
  const [fieldsDef, setFieldsDef] = useState([]); // array of { name, label, type, options, default, required }
  const [dynamicCols, setDynamicCols] = useState([]); // array of { key, label }

  // export dialog
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    fieldType: "selected", // 'selected' or 'all'
    dataType: "filtered", // 'filtered' or 'all'
  });

  // drawer state
  const [selectedSO, setSelectedSO] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef(null);
  const [selectedSoIds, setSelectedSoIds] = useState([]);
  const [isMassUpdating, setIsMassUpdating] = useState(false);
  const [showMassUpdate, setShowMassUpdate] = useState(false);
  const [massField, setMassField] = useState("assignedConsultant");
  const [massValue, setMassValue] = useState("");
  const [massInput, setMassInput] = useState("");
  const [massUserOptions, setMassUserOptions] = useState([]);
  const MAX_ROWS = 1000;
  const fetchInFlightRef = useRef(false);
  const PAGE_SIZE = 200;
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const preSalesCount = salesOrders.filter((row) => Number(row?.paymentPercentage || 0) < PRE_SALES_THRESHOLD).length;
  const salesCount = Math.max(0, salesOrders.length - preSalesCount);

  // Admin check (local storage "kp-user")
  const isAdmin = isAdminSessionUser();

  // Fetch Sales Orders
  const fetchSalesOrders = async (reset = false) => {
  if (fetchInFlightRef.current) return;
  fetchInFlightRef.current = true;
  setLoading(true);
  try {
    // 🔥 0️⃣ LOAD USERS (email → name map)
const usersSnap = await fetchCollectionDocs("Users", 2500, 30000, MAX_ROWS);
const usersMap = {};

usersSnap.forEach((user) => {
  if (!user?.email) return;

  const emailKey = String(user.email).trim().toLowerCase();
  usersMap[emailKey] = user.Name || user.name || "";
});

    
    // 1️⃣ Get ALL DEALS first
const dealsSnap = await fetchCollectionDocs("deals", 2500, 30000, MAX_ROWS);
const dealsMap = {};

dealsSnap.forEach((deal) => {

  const rawKey =
  deal.kpiId ||
  deal.autoId ||
  deal.KPIID ||
  "";

const key = String(rawKey).trim().toUpperCase();



  if (!key) return;

dealsMap[key] = {
  teleSale: deal.teleSale || "",
  projectType: deal.projectType || "",

  consultantName: deal.consultantName || "",

  assignedConsultant: deal.assignedConsultant || "",
};
});
// 1️⃣.5️⃣ Get ALL PROJECTS (conversion truth)
const projectsSnap = await fetchCollectionDocs("projects", 2500, 30000, MAX_ROWS);
const projectsMap = {};

projectsSnap.forEach((proj) => {

  const rawKey =
    proj.kpiId ||
    proj.autoId ||
    proj.KPIID ||
    "";

  const key = String(rawKey).trim().toUpperCase();
  if (!key) return;

  projectsMap[key] = true; // existence = converted
});

    // 2️⃣ Load Sales Orders
    // 2️⃣ 🔐 ROLE-BASED SALES ORDERS QUERY (FIX)
// 2️⃣ 🔐 ROLE-BASED SALES ORDERS QUERY (FINAL)
// 🔐 ROLE-BASED SALES ORDERS QUERY — FINAL
// 2️⃣ 🔐 ROLE-BASED SALES ORDERS QUERY (FINAL FIX)
const scopedQuery = await getScopedQuery("salesOrders");

// add orderBy ONLY if not already a Query
let finalQuery = scopedQuery;

// Firestore Query objects have ._query internally
if (!scopedQuery._query) {
  finalQuery = query(scopedQuery, orderBy("createdAt", "desc"));
}

const { docs, lastDoc: nextLast } = await fetchPagedDocs(finalQuery, "salesOrders", {
  limitCount: PAGE_SIZE,
  startAfterDoc: reset ? null : lastDoc,
  cacheMs: 30000,
});
let rows = docs || [];

// 🔁 Consultant fallback for legacy mixed mapping (assignedConsultant vs consultantName)
if (!rows?.length) {
  try {
    const kpUser = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const role = String(kpUser?.role || kpUser?.Role || "").toLowerCase().replace(/[\s-]+/g, "_");
    const email = String(kpUser?.email || "").trim();
    const name = String(kpUser?.Name || kpUser?.name || "").trim();

    if (role === "consultant") {
      const assignedValues = [email, name].filter(Boolean).slice(0, 10);
      if (assignedValues.length) {
        const qAssigned =
          assignedValues.length === 1
            ? query(collection(db, "salesOrders"), where("assignedConsultant", "==", assignedValues[0]))
            : query(collection(db, "salesOrders"), where("assignedConsultant", "in", assignedValues));
        const assignedPage = await fetchPagedDocs(qAssigned, "salesOrders", {
          limitCount: PAGE_SIZE,
          startAfterDoc: reset ? null : lastDoc,
          cacheMs: 30000,
        });
        rows = assignedPage.docs || [];
      }

      if (!rows?.length) {
        const nameValues = [name, email].filter(Boolean).slice(0, 10);
        if (nameValues.length) {
          const qName =
            nameValues.length === 1
              ? query(collection(db, "salesOrders"), where("consultantName", "==", nameValues[0]))
              : query(collection(db, "salesOrders"), where("consultantName", "in", nameValues));
          const namePage = await fetchPagedDocs(qName, "salesOrders", {
            limitCount: PAGE_SIZE,
            startAfterDoc: reset ? null : lastDoc,
            cacheMs: 30000,
          });
          rows = namePage.docs || [];
        }
      }
    }
  } catch (fallbackErr) {
    console.warn("SalesOrders consultant fallback failed:", fallbackErr);
  }
}


    const list = rows.map((d) => {
      const data = d.data || d;
      const invoiceAmountValue =
        typeof data.invoiceAmount === "number"
          ? data.invoiceAmount
          : Number(data.invoiceAmount || data.totalCost || 0);

      const computedPaymentReceived =
        data.paymentReceived != null
          ? Number(data.paymentReceived || 0)
          : Number(data.firstPayment || 0) +
            Number(data.secondPayment || 0) +
            Number(data.thirdPayment || 0) +
            Number(data.fourthPayment || 0) +
            (Number(data.firstPayment || 0) > 0 ? 0 : Number(data.tokenPayment || 0));

      const computedPending =
        data.pendingPayment != null
          ? Number(data.pendingPayment || 0)
          : Math.max(0, invoiceAmountValue - computedPaymentReceived);

      const computedPaymentPercentage =
        data.paymentPercentage != null
          ? Number(data.paymentPercentage || 0)
          : invoiceAmountValue > 0
            ? Number(((computedPaymentReceived / invoiceAmountValue) * 100).toFixed(2))
            : 0;

      const sixtyMeta = computeSixtyDelayMeta({
        data,
        invoiceAmount: invoiceAmountValue,
        totalReceived: computedPaymentReceived,
        paymentPercentage: computedPaymentPercentage,
      });

      const sixtyPercentReceived = sixtyMeta.sixtyPercentReceived;
      const sixtyPercentDelayDays =
        sixtyPercentReceived === "NO"
          ? sixtyMeta.sixtyPercentDelayDays
          : typeof data.sixtyPercentDelayDays === "number"
            ? data.sixtyPercentDelayDays
            : sixtyMeta.sixtyPercentDelayDays;

const rawKey =
  data.kpiId ||
  data.autoId ||
  data.KPIID ||
  "";

const normalizedKey = String(rawKey).trim().toUpperCase();

const link = dealsMap[normalizedKey] || {};
// 🔑 Resolve assigned consultant EMAIL
const assignedEmail =
  data.assignedConsultant ||
  link.assignedConsultant ||
  "";

// 🔑 Resolve consultant NAME from Users collection
const resolvedConsultantName =
  usersMap[String(assignedEmail).trim().toLowerCase()] ||
  data.consultantName ||
  link.consultantName ||
  "";

const isConverted = projectsMap[normalizedKey] === true;

      return {
         ...data,
        id: normalizeDocId(d.id || d.docId || d.name || ""),

        kpiId: rawKey,
        autoId: data.autoId || "",
        KPIID: data.KPIID || "",

        name: data.name || data.customerName || data.customer_name || "",
        phone:
          data.phone ||
          data.customerPhone ||
          data.contactNumber ||
          data.contact_number ||
          "",
        address: data.address || data.location || "",

        teleSale: sanitizeLegacyUserDisplay(data.teleSale || link.teleSale || ""),
        projectType: data.projectType || link.projectType || "Residential",
        consultantName: sanitizeLegacyUserDisplay(resolvedConsultantName),
      assignedConsultant: sanitizeLegacyUserDisplay(assignedEmail),
        paymentMode: data.paymentMode || data.payment_mode || "",
        description: data.description || data.notes || "",

        lead_source: data.lead_source || "",

        // Prefer label values to preserve original text/casing from lead/deal
        state: pickScopedDisplay(data.state, data.state_label),
        sales_zone: pickScopedDisplay(data.sales_zone, data.sales_zone_label),
        sales_area: pickScopedDisplay(data.sales_area, data.sales_area_label),
        zonal_manager: data.zonal_manager || data.zonalManager || "",

        capacity: data.capacity || data.systemSize || 0,
        invoiceAmount: invoiceAmountValue,

        paymentReceived: computedPaymentReceived,
        pendingPayment: computedPending,
        paymentPercentage: computedPaymentPercentage,

        sixtyPercentReceived,
sixtyPercentDelayDays,
 status: isConverted ? "Converted" : "Not Converted",

        createdAt: data.createdAt || null,

       
      };
    });

    const uniqueById = new Map();
    list.forEach((r) => {
      if (r?.id) uniqueById.set(r.id, r);
    });

    setSalesOrders((prev) => {
      if (reset) {
        return Array.from(uniqueById.values()).slice(0, MAX_ROWS);
      }
      const merged = new Map();
      prev.forEach((r) => {
        if (r?.id) merged.set(r.id, r);
      });
      uniqueById.forEach((value, key) => {
        merged.set(key, value);
      });
      return Array.from(merged.values()).slice(0, MAX_ROWS);
    });
    setLastDoc(nextLast || null);
    setHasMore((rows || []).length === PAGE_SIZE);
  } catch (err) {
    console.error("Error fetching sales orders:", err);
    setSalesOrders([]);
  } finally {
    setLoading(false);
    fetchInFlightRef.current = false;
  }
};
  useEffect(() => {
    const isVisible = () => !document.hidden;
    if (isVisible()) fetchSalesOrders(true);

    const timer = setInterval(() => {
      if (isVisible()) fetchSalesOrders(true);
    }, 60 * 1000);

    const onVisible = () => {
      if (isVisible()) fetchSalesOrders(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  // ⭐ Auto-open drawer from universal search
// ⭐ Auto-open drawer when universal search navigates here
// ⭐ Auto-open drawer when universal search navigates here
  // Auto-open drawer when URL has ?open=<kpiId|docId>
// ⭐ Auto-open drawer when URL has ?open=<kpiId|docId>
// THIS VERSION WAITS FOR salesOrders TO LOAD
useEffect(() => {
  const params = new URLSearchParams(location.search);
  const openId = params.get("open");

  if (!canOpenDrawer) return;
  if (!openId) return;
  if (salesOrders.length === 0) return; // wait until data is loaded

  const openLower = openId.toLowerCase();

  const match = salesOrders.find((so) =>
    (so.kpiId && so.kpiId.toLowerCase() === openLower) ||
    (so.autoId && so.autoId.toLowerCase() === openLower) ||
    (so.KPIID && so.KPIID.toLowerCase() === openLower) ||
    so.id === openId
  );

  if (match) {
    setSelectedSO(match);
    setIsDrawerOpen(true);
  }
}, [location.search, salesOrders, canOpenDrawer]);

  // ---------------------------
  // Load crm_fields/salesOrders for dynamic columns (realtime)
  // ---------------------------
  useEffect(() => {
    let unsub = null;
    try {
      const ref = doc(db, "crm_fields", "salesOrders");
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            setFieldsDef([]);
            setDynamicCols([]);
            return;
          }
          const data = snap.data() || {};
          const defs = Array.isArray(data.fields) ? data.fields : [];

          const normalized = defs.map((f) =>
            typeof f === "string"
              ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [], default: "" }
              : { ...(f || {}), options: f.options || [], default: f.default ?? "" }
          );

          setFieldsDef(normalized);

          const dyn = normalized
            .map((fd) => ({ key: fd.name, label: fd.label || prettyLabel(fd.name) }))
            .filter((d) => d.key !== "id")
            .filter((d) => !DEFAULT_COLUMNS.some((c) => c.key === d.key));

          setDynamicCols(dyn);

          // append dynamic keys to visibleColumns by default (if missing) so they show below static columns
          setVisibleColumns((prev) => {
            const next = [...prev];
            dyn.forEach((d) => {
              if (!next.includes(d.key)) next.push(d.key);
            });
            return next;
          });
        },
        (err) => {
          console.error("crm_fields/salesOrders snapshot error:", err);
        }
      );
    } catch (err) {
      console.error("Failed to subscribe to crm_fields/salesOrders:", err);
    }

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    const handler = (e) => {
      const insideMenu = menuRef.current?.contains(e.target);
      const insideManage = manageRef.current?.contains(e.target);
      const typing = e.target.tagName === "INPUT" || e.target.tagName === "SELECT";
      if (insideMenu && typing) return;
      if (!insideMenu && !insideManage) {
        setOpenMenuFor(null);
        setShowManageCols(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filtering & Sorting & Pagination
  const filtered = salesOrders.filter((so) => {
    const paymentPct = Number(so?.paymentPercentage || 0);
    const stageMatch = orderStageView === "pre"
      ? paymentPct < PRE_SALES_THRESHOLD
      : paymentPct >= PRE_SALES_THRESHOLD;

    // search term across name, phone, kpiId
    const q = searchTerm.trim().toLowerCase();
    const searchMatch =
      !q ||
      (so.name || "").toLowerCase().includes(q) ||
      (so.phone || "").toString().includes(q) ||
      (so.kpiId || "").toString().trim().toLowerCase().includes(q);

    const statusMatch =
      statusFilter === "All" ||
      normalizeSalesOrderStatus(so.status) === normalizeSalesOrderStatus(statusFilter);

    const columnFilterMatch = Object.keys(columnFilters).every((key) => {
      const filterToken = (columnFilters[key] || "").toString().trim();
      if (!filterToken) return true;

      const parsedNumeric = parseNumericFilterToken(filterToken);
      if (parsedNumeric) {
        return runNumericFilter(so[key], parsedNumeric);
      }

      const target = normalizeFilterComparable(so[key], key);
      const token = normalizeFilterComparable(filterToken, key);
      return target.includes(token);
    });

    return stageMatch && searchMatch && statusMatch && columnFilterMatch;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];

    const getComparable = (v) => {
      if (v && typeof v.toDate === "function") return v.toDate().getTime();
      if (v instanceof Date) return v.getTime();
      if (typeof v === "number") return v;
      if (!v) return -Infinity;
      return v.toString().toLowerCase();
    };
    const A = getComparable(av);
    const B = getComparable(bv);

    if (A < B) return sort.dir === "asc" ? -1 : 1;
    if (A > B) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const startIdx = (page - 1) * perPage;
  const paged = sorted.slice(startIdx, startIdx + perPage);

  const toggleSelectSO = (id) => {
    const normalizedId = normalizeDocId(id);
    if (!normalizedId) return;
    setSelectedSoIds((prev) =>
      prev.includes(normalizedId)
        ? prev.filter((v) => v !== normalizedId)
        : [...prev, normalizedId]
    );
  };

  const toggleSelectAllPagedSO = () => {
    const ids = paged.map((r) => normalizeDocId(r.id)).filter(Boolean);
    if (!ids.length) return;

    setSelectedSoIds((prev) => {
      const allSelected = ids.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !ids.includes(id));
      return Array.from(new Set([...prev, ...ids]));
    });
  };

  const handleMassUpdateSO = async () => {
    if (!isAdmin) return;
    if (!selectedSoIds.length) {
      alert("Select at least one sales order.");
      return;
    }

    setShowMassUpdate(true);
  };

  const getInputOptionsForField = (field) => {
    if (field === "assignedConsultant") {
      return massUserOptions.map((u) => ({ label: `${u.name} <${u.email}>`, value: u.email }));
    }
    if (field === "consultantName") {
      return massUserOptions.map((u) => ({ label: `${u.name} <${u.email}>`, value: u.name }));
    }
    if (field === "teleSale") {
      return massUserOptions.map((u) => ({ label: `${u.name} <${u.email}>`, value: u.name }));
    }
    return [];
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;

    (async () => {
      try {
        const users = await fetchCollectionDocs("Users");
        const opts = users
          .map((u) => ({
            name: String(u?.Name || u?.name || "").trim(),
            email: String(u?.email || "").trim().toLowerCase(),
          }))
          .filter((u) => u.email);
        if (!active) return;
        setMassUserOptions(opts);
      } catch (e) {
        console.warn("Failed loading users for SO mass update", e?.message || e);
      }
    })();

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const applyMassUpdateSO = async () => {
    if (!isAdmin) {
      alert("Only admin can perform mass update.");
      return;
    }

    const fieldName = String(massField || "").trim();
    const fieldValue = String(massValue || "").trim();
    if (!fieldName) return alert("Select a field.");
    if (!fieldValue) return alert("Enter value.");

    const validIds = new Set(salesOrders.map((r) => normalizeDocId(r.id)).filter(Boolean));
    const idsToUpdate = selectedSoIds
      .map((id) => normalizeDocId(id))
      .filter((id) => id && validIds.has(id));

    if (!idsToUpdate.length) {
      alert("No valid sales orders selected.");
      return;
    }

    setIsMassUpdating(true);
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : {};

      const batch = writeBatch(db);
      idsToUpdate.forEach((id) => {
        batch.update(doc(db, "salesOrders", id), {
          [fieldName]: fieldValue,
          updatedAt: serverTimestamp(),
          updatedBy: parsed?.email || "admin",
        });
      });

      await batch.commit();
      await fetchSalesOrders(true);
      setSelectedSoIds([]);
      setShowMassUpdate(false);
      alert(`✅ Updated ${idsToUpdate.length} sales order record(s).`);
    } catch (e) {
      console.error("Mass update sales orders failed", e);
      alert("Mass update failed.");
    } finally {
      setIsMassUpdating(false);
    }
  };

  // visible order of columns (pinned first)
// ⭐ FINAL VISIBLE COLUMNS ORDER:
// 1️⃣ Static columns (pinned first → unpinned)
// 2️⃣ Dynamic columns (only visible ones)
const visibleCols = [
  // pinned static
  ...pinnedColumns
    .filter((k) => visibleColumns.includes(k))
    .map((key) => DEFAULT_COLUMNS.find((c) => c.key === key))
    .filter(Boolean),

  // unpinned static
  ...DEFAULT_COLUMNS
    .filter((c) => visibleColumns.includes(c.key) && !pinnedColumns.includes(c.key)),

  // dynamic columns (always after static)
  ...dynamicCols.filter((d) => visibleColumns.includes(d.key)),
];

const scopeLastKeys = ["sales_area", "sales_zone", "state", "zonal_manager"];
const staticVisibleOrdered = DEFAULT_COLUMNS.filter(
  (c) => visibleColumns.includes(c.key) && !scopeLastKeys.includes(c.key)
);
const staticScopeTail = DEFAULT_COLUMNS.filter(
  (c) => visibleColumns.includes(c.key) && scopeLastKeys.includes(c.key)
);
const dynamicVisibleOrdered = dynamicCols.filter((c) => visibleColumns.includes(c.key));
const orderedTableCols = [...staticVisibleOrdered, ...dynamicVisibleOrdered, ...staticScopeTail];

  // Column Menu component (right-side)
  const ColumnMenu = ({ columnKey }) => {
    const curFilter = String(columnFilters[columnKey] || "");
    const parsedActiveNumeric = parseNumericFilterToken(curFilter);
    const activeFilterText = parsedActiveNumeric
      ? `${parsedActiveNumeric.op} ${parsedActiveNumeric.value}`
      : curFilter;
    const isPinned = pinnedColumns.includes(columnKey);
    const isUserFilterColumn = USER_FILTER_KEYS.has(columnKey);
    const isNumericFilterColumn = NUMERIC_FILTER_KEYS.has(columnKey);
    const [draftFilter, setDraftFilter] = useState(curFilter.startsWith("__num__:") ? "" : curFilter);
    const [draftOp, setDraftOp] = useState("<");
    const [draftNum, setDraftNum] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);

    const userOptions = (() => {
      const rawValues = salesOrders
        .map((row) => String(row?.[columnKey] || "").trim())
        .filter(Boolean);

      if (!SCOPE_FILTER_KEYS.has(columnKey)) {
        return Array.from(new Set(rawValues)).sort((a, b) => a.localeCompare(b));
      }

      const scopeMap = new Map();
      rawValues.forEach((raw) => {
        const normalized = normalizeScopeValue(raw);
        if (!normalized) return;
        if (!scopeMap.has(normalized)) {
          scopeMap.set(normalized, formatScopeOptionLabel(raw));
        }
      });

      return Array.from(scopeMap.values()).sort((a, b) => a.localeCompare(b));
    })();

    const filteredSuggestions = !isUserFilterColumn
      ? []
      : userOptions
          .filter((opt) => opt.toLowerCase().includes(draftFilter.trim().toLowerCase()))
          .slice(0, 8);

    useEffect(() => {
      const parsed = parseNumericFilterToken(curFilter);
      if (parsed && isNumericFilterColumn) {
        setDraftOp(parsed.op);
        setDraftNum(String(parsed.value));
        setDraftFilter("");
      } else {
        setDraftFilter(curFilter);
        setDraftNum("");
      }
    }, [curFilter, columnKey]);

    const menuNode = (
      <div
        ref={menuRef}
        style={{
          ...styles.menu,
          position: "fixed",
          left: `${Math.max(8, Math.min(menuPos.left || 40, window.innerWidth - 236))}px`,
          top: `${Math.max(72, Math.min(menuPos.top || 120, window.innerHeight - 320))}px`,
        }}
      >
        <button
          style={styles.menuItem}
          onClick={() => {
            setSort({ key: columnKey, dir: "asc" });
            setOpenMenuFor(null);
          }}
        >
          ↑ Asc
        </button>

        <button
          style={styles.menuItem}
          onClick={() => {
            setSort({ key: columnKey, dir: "desc" });
            setOpenMenuFor(null);
          }}
        >
          ↓ Desc
        </button>

        <button
          style={styles.menuItem}
          onClick={() => {
            setPinnedColumns((prev) =>
              prev.includes(columnKey) ? prev.filter((p) => p !== columnKey) : [...prev, columnKey]
            );
            setOpenMenuFor(null);
          }}
        >
          {isPinned ? "📍 Unpin Column" : "📌 Pin Column"}
        </button>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>🔍 Filter by</label>
          {curFilter && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                background: "#fff5f5",
                border: "1px solid rgba(128,0,0,0.18)",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "#7a0011",
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={activeFilterText}
              >
                Active: {activeFilterText}
              </span>
              <button
                type="button"
                onClick={() => {
                  setColumnFilters((prev) => ({ ...prev, [columnKey]: "" }));
                  setDraftFilter("");
                  setDraftNum("");
                  setOpenMenuFor(null);
                }}
                style={{
                  border: "none",
                  background: "#fff",
                  color: "#800000",
                  fontWeight: 700,
                  fontSize: 12,
                  borderRadius: 6,
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          )}
          {isNumericFilterColumn ? (
            <div style={{ display: "flex", gap: 6, width: "100%" }}>
              <select
                value={draftOp}
                onChange={(e) => setDraftOp(e.target.value)}
                style={{ ...styles.filterInput, width: 74, flex: "0 0 74px" }}
              >
                {NUMERIC_OPERATORS.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
              <input
                type="number"
                autoFocus
                value={draftNum}
                onChange={(e) => setDraftNum(e.target.value)}
                placeholder="Value"
                style={{ ...styles.filterInput, flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = Number(draftNum);
                    setColumnFilters((prev) => ({
                      ...prev,
                      [columnKey]: Number.isFinite(n) ? `__num__:${draftOp}:${n}` : "",
                    }));
                    setOpenMenuFor(null);
                  }
                }}
              />
            </div>
          ) : (
            <div style={{ position: "relative", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minWidth: 0 }}>
                <input
                  type="text"
                  autoFocus
                  value={draftFilter}
                  onFocus={() => {
                    if (isUserFilterColumn) setShowSuggestions(true);
                  }}
                  onBlur={() => {
                    if (isUserFilterColumn) setShowSuggestions(false);
                  }}
                  onChange={(e) => {
                    setDraftFilter(e.target.value);
                    if (isUserFilterColumn) setShowSuggestions(true);
                  }}
                  placeholder={isUserFilterColumn ? "Type or pick value" : "Type filter"}
                  style={{ ...styles.filterInput, flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setColumnFilters((prev) => ({ ...prev, [columnKey]: draftFilter.trim() }));
                      setOpenMenuFor(null);
                    }
                  }}
                />
                {draftFilter && (
                  <button
                    onClick={() => setDraftFilter("")}
                    title="Clear Filter"
                    style={{
                      background: "none",
                      border: "none",
                      color: "#800000",
                      cursor: "pointer",
                      fontSize: 16,
                      padding: 0,
                    }}
                  >
                    ❌
                  </button>
                )}
              </div>

              {isUserFilterColumn && showSuggestions && filteredSuggestions.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid rgba(128,0,0,0.18)",
                    borderRadius: 10,
                    boxShadow: "0 12px 24px rgba(77,12,12,0.16)",
                    maxHeight: 170,
                    overflowY: "auto",
                    zIndex: 20,
                    padding: 4,
                  }}
                >
                  {filteredSuggestions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setDraftFilter(opt);
                        setColumnFilters((prev) => ({ ...prev, [columnKey]: opt }));
                        setOpenMenuFor(null);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        background: "#fff8f8",
                        color: "#6e0b0b",
                        fontWeight: 600,
                        fontSize: 13,
                        borderRadius: 8,
                        padding: "7px 9px",
                        cursor: "pointer",
                        marginBottom: 4,
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              style={{ ...styles.menuItem, flex: 1 }}
              onClick={() => {
                if (isNumericFilterColumn) {
                  const n = Number(draftNum);
                  setColumnFilters((prev) => ({
                    ...prev,
                    [columnKey]: Number.isFinite(n) ? `__num__:${draftOp}:${n}` : "",
                  }));
                } else {
                  setColumnFilters((prev) => ({ ...prev, [columnKey]: draftFilter.trim() }));
                }
                setOpenMenuFor(null);
              }}
            >
              Apply
            </button>
            <button
              style={{ ...styles.menuItem, flex: 1 }}
              onClick={() => {
                const parsed = parseNumericFilterToken(curFilter);
                if (parsed && isNumericFilterColumn) {
                  setDraftOp(parsed.op);
                  setDraftNum(String(parsed.value));
                } else {
                  setDraftFilter(curFilter);
                }
                setOpenMenuFor(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>

        <button
          style={{ ...styles.menuItem, borderTop: "1px solid #eee", marginTop: 6 }}
          onClick={() => {
            setVisibleColumns((prev) => prev.filter((c) => c !== columnKey));
            setPinnedColumns((prev) => prev.filter((p) => p !== columnKey));
            setOpenMenuFor(null);
          }}
        >
          🙈 Hide Column
        </button>
      </div>
    );

    if (typeof document === "undefined") return menuNode;
    return createPortal(menuNode, document.body);
  };

  // Export logic
  const handleExportExcel = () => {
    setShowExportDialog(false);
    const exportAllRows = exportOptions.dataType === "all";
    const exportAllFields = exportOptions.fieldType === "all";
    const dataRows = exportAllRows ? salesOrders : sorted;
    if (!dataRows || dataRows.length === 0) {
      alert("⚠️ No records to export");
      return;
    }

   const exportCols = exportAllFields
  ? [
      ...DEFAULT_COLUMNS,
      ...dynamicCols.map(c => ({ key: c.key, label: c.label })),

      { key: "firstPayment", label: "1st Payment Amount" },
      { key: "firstPaymentDate", label: "1st Payment Date" },

      { key: "secondPayment", label: "2nd Payment Amount" },
      { key: "secondPaymentDate", label: "2nd Payment Date" },

      { key: "thirdPayment", label: "3rd Payment Amount" },
      { key: "thirdPaymentDate", label: "3rd Payment Date" },

      { key: "fourthPayment", label: "4th Payment Amount" },
      { key: "fourthPaymentDate", label: "4th Payment Date" },
    ]
  : [
      ...visibleCols,
      ...dynamicCols.filter(d => visibleColumns.includes(d.key)),

      { key: "firstPayment", label: "1st Payment Amount" },
      { key: "firstPaymentDate", label: "1st Payment Date" },

      { key: "secondPayment", label: "2nd Payment Amount" },
      { key: "secondPaymentDate", label: "2nd Payment Date" },

      { key: "thirdPayment", label: "3rd Payment Amount" },
      { key: "thirdPaymentDate", label: "3rd Payment Date" },

      { key: "fourthPayment", label: "4th Payment Amount" },
      { key: "fourthPaymentDate", label: "4th Payment Date" },
    ];

const exportData = dataRows.map((r) => {
  const row = {};

  // 🔒 LOCAL date formatter (no global dependency)
  const formatExportDate = (v) => {
    if (!v) return "";
    if (v?.seconds && typeof v.toDate === "function") {
      return v.toDate().toLocaleDateString("en-GB");
    }
    if (v instanceof Date) {
      return v.toLocaleDateString("en-GB");
    }
    return "";
  };

  exportCols.forEach((c) => {
    let val = r[c.key];

    // Dates (created / updated / payments)
    if (
      c.key === "createdAt" ||
      c.key === "updatedAt" ||
      c.key === "firstPaymentDate" ||
      c.key === "secondPaymentDate" ||
      c.key === "thirdPaymentDate" ||
      c.key === "fourthPaymentDate"
    ) {
      val = formatExportDate(val);
    }

    row[c.label] = val ?? "";
  });

  return row;
});

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "SalesOrders");
    const today = new Date().toISOString().split("T")[0];
    XLSX.writeFile(workbook, `SalesOrders_Export_${today}.xlsx`);
  };

  const ExportDialog = () => (
    <div style={styles.dialogOverlay}>
      <div style={styles.dialogBox}>
        <h3 style={{ color: "#800000" }}>📤 Export Sales Orders</h3>

        <div style={{ marginTop: 10 }}>
          <b>Fields to Export</b>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="fieldType"
              value="selected"
              checked={exportOptions.fieldType === "selected"}
              onChange={(e) => setExportOptions({ ...exportOptions, fieldType: e.target.value })}
            />{" "}
            Selected Fields (Visible Columns)
          </label>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="fieldType"
              value="all"
              checked={exportOptions.fieldType === "all"}
              onChange={(e) => setExportOptions({ ...exportOptions, fieldType: e.target.value })}
            />{" "}
            All Fields
          </label>
        </div>

        <div style={{ marginTop: 10 }}>
          <b>Records to Export</b>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="dataType"
              value="filtered"
              checked={exportOptions.dataType === "filtered"}
              onChange={(e) => setExportOptions({ ...exportOptions, dataType: e.target.value })}
            />{" "}
            Current (Filtered)
          </label>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="dataType"
              value="all"
              checked={exportOptions.dataType === "all"}
              onChange={(e) => setExportOptions({ ...exportOptions, dataType: e.target.value })}
            />{" "}
            All Records
          </label>
        </div>

        <div style={styles.dialogButtons}>
          <button style={styles.addBtn} onClick={handleExportExcel}>
            Export Now
          </button>
          <button style={styles.cancelBtn} onClick={() => setShowExportDialog(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  const handleImportExcel = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (!isAdmin) {
      alert("Only admin can import data.");
      e.target.value = "";
      return;
    }

    setIsImporting(true);
    try {
      const rows = await parseExcelRows(file);
      if (!rows.length) {
        alert("No valid rows found in file.");
        return;
      }

      const emailNameMap = await getUserNameByEmailMap();
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : {};

      const result = await importRowsToCollection({
        collectionName: "salesOrders",
        rows,
        preferDocIdKeys: ["kpiId", "autoId", "id"],
        userMeta: {
          uid: parsed?.uid || parsed?.id || "",
          email: parsed?.email || "",
        },
        transformRow: (row) => {
          const assignedEmail = String(row.assignedConsultant || "").trim().toLowerCase();
          return {
            ...row,
            kpiId: row.kpiId || row.autoId || "",
            name: row.name || row.customerName || "",
            consultantName: row.consultantName || emailNameMap[assignedEmail] || "",
          };
        },
      });

      await fetchSalesOrders(true);
      alert(`✅ Imported ${result.imported} sales order records.`);
    } catch (err) {
      console.error("Sales order import failed", err);
      alert("Import failed. Please check file format.");
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

  // UI helpers
  const openColumnMenu = (e, key) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const MENU_ESTIMATED_HEIGHT = 340;
    const DESKTOP_MIN_TOP = 72;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900;

    const maxLeft = Math.max(8, viewportWidth - 236);
    const maxTop = Math.max(DESKTOP_MIN_TOP, viewportHeight - MENU_ESTIMATED_HEIGHT - 12);
    const nextTop = Math.max(DESKTOP_MIN_TOP, Math.min(rect.bottom + 6, maxTop));
    const nextLeft = Math.max(8, Math.min(rect.left, maxLeft));

    setMenuPos({ top: nextTop, left: nextLeft });
    setOpenMenuFor(openMenuFor === key ? null : key);
  };

  // small helper for pretty label
  function prettyLabel(name) {
    if (!name) return "";
    return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

return (
  <div
    style={{
      ...styles.container,
      flexDirection: isMobile ? "column" : "row",
      width: "100%",
    }}
  >
      {/* Sidebar */}
      <div
  style={{
    ...styles.sidebar,
    width: isMobile ? "100%" : "230px",
    minWidth: isMobile ? "100%" : "230px",
    maxWidth: isMobile ? "100%" : "230px",
  }}
>
        <h3 style={styles.sidebarTitle}>Filter Sales Orders</h3>

        <input
          placeholder="Search by name, phone, KPI..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          style={styles.searchInput}
        />

        <label style={styles.label}>Status</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={styles.dropdown}>
          <option>All</option>
          <option>New</option>
          <option>Not Converted</option>
          <option>Converted</option>
          <option>Won</option>
          <option>Lost</option>
        </select>

        <div style={{ marginTop: "auto", color: "#fff", fontSize: 12 }}>
          Tip: Click any row to open and view the Sales Order. Editing allowed for admin only.
        </div>
      </div>

      {/* Main */}
      <div style={styles.mainContent}>
        <div style={styles.headerCard}>
          <div style={styles.headerRow}>
            <div>
              <h2 style={styles.header}>Sales Orders Pipeline</h2>
              <div style={styles.headerSub}>Track early vs confirmed orders with payment milestones</div>
            <div style={styles.stageSwitchWrap}>
              <button
                type="button"
                onClick={() => {
                  setOrderStageView("pre");
                  setPage(1);
                }}
                style={{
                  ...styles.stageBtn,
                  ...(orderStageView === "pre" ? styles.stageBtnActive : null),
                }}
              >
                Pre-Salesorders ({preSalesCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrderStageView("sales");
                  setPage(1);
                }}
                style={{
                  ...styles.stageBtn,
                  borderRight: "none",
                  ...(orderStageView === "sales" ? styles.stageBtnActive : null),
                }}
              >
                Salesorders ({salesCount})
              </button>
            </div>
            <div style={styles.stageHint}>
              {orderStageView === "pre"
                ? "Showing orders with payment received below 40%"
                : "Showing orders with payment received 40% and above"}
            </div>
          </div>

            <div style={styles.toolbarWrap}>
            {isAdmin && (
              <button
                style={styles.exportBtn}
                onClick={handleMassUpdateSO}
                disabled={isMassUpdating}
              >
                🛠 Mass Update
              </button>
            )}

            {isAdmin && !isMobile && (
              <>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={handleImportExcel}
                />
                <button
                  style={styles.exportBtn}
                  onClick={() => importInputRef.current?.click()}
                  disabled={isImporting}
                >
                  {isImporting ? "Importing..." : "⬆ Import Excel"}
                </button>
              </>
            )}

            <button style={styles.exportBtn} onClick={() => setShowExportDialog(true)}>
              📤 Export Excel
            </button>

            <div style={{ position: "relative" }}>
              <button
                style={styles.manageBtn}
                onClick={() => setShowManageCols((s) => !s)}
                aria-haspopup="true"
                aria-expanded={showManageCols}
              >
                ⚙ Manage Columns
              </button>

              {showManageCols && (
                <div ref={manageRef} style={styles.manageMenu}>
                  <div style={styles.manageHeaderWrap}>
                    <div style={styles.manageTitle}>Show / Hide Columns</div>
                    <div style={styles.manageSubtitle}>Choose what appears in your table</div>
                  </div>

                  <div style={styles.manageList}>
                    <div style={styles.manageSectionTitle}>Core Fields</div>
                    {DEFAULT_COLUMNS.map((col) => (
                      <label key={col.key} style={styles.manageItem}>
                        <input
                          type="checkbox"
                          style={styles.manageCheck}
                          checked={visibleColumns.includes(col.key)}
                          onChange={(e) =>
                            e.target.checked
                              ? setVisibleColumns((prev) => [...prev, col.key])
                              : setVisibleColumns((prev) => prev.filter((k) => k !== col.key))
                          }
                        />
                        <span>{col.label}</span>
                      </label>
                    ))}

                    {/* dynamic fields will not be removed from table by default in case admin wants them visible,
                        but they are listed here for admin control as well */}
                    {dynamicCols.length > 0 && (
                      <>
                        <div style={styles.manageSectionTitle}>Additional Fields</div>
                        {dynamicCols.map((col) => (
                          <label key={col.key} style={styles.manageItem}>
                            <input
                              type="checkbox"
                              style={styles.manageCheck}
                              checked={visibleColumns.includes(col.key)}
                              onChange={(e) =>
                                e.target.checked
                                  ? setVisibleColumns((prev) => [...prev, col.key])
                                  : setVisibleColumns((prev) => prev.filter((k) => k !== col.key))
                              }
                            />
                            <span>{col.label}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>

                  <div style={styles.manageActions}>
                    <button
                      style={{ ...styles.addBtn, flex: 1, borderRadius: 10 }}
                      onClick={() => setVisibleColumns(DEFAULT_COLUMNS.map((c) => c.key).concat(dynamicCols.map((d) => d.key)))}
                    >
                      Unhide All
                    </button>
                    <button style={{ ...styles.cancelBtn, flex: 1, borderRadius: 10 }} onClick={() => setShowManageCols(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* TABLE */}
        {/* TABLE */}
{loading ? (
  <p style={{ color: "#800000" }}>Loading sales orders...</p>
) : (
  <div style={{ width: "100%", minWidth: 0 }}>
    <div style={styles.tableWrapper}>
      <table style={styles.table}>
        <thead>
          <tr>
            {isAdmin && (
              <th style={styles.selectColTh}>
                <input
                  type="checkbox"
                  checked={paged.length > 0 && paged.every((r) => selectedSoIds.includes(normalizeDocId(r.id)))}
                  onChange={toggleSelectAllPagedSO}
                />
              </th>
            )}
    {orderedTableCols.map((col) => (
      <th key={col.key} style={styles.th}>
        <div style={styles.headerCell}>
          <span>{col.label}</span>
          <button
            title="Column options"
            onClick={(e) => {
              e.stopPropagation();
              openColumnMenu(e, col.key);
            }}
            style={styles.iconButton}
          >
            ≡
          </button>

          {openMenuFor === col.key && <ColumnMenu columnKey={col.key} />}
        </div>
      </th>
    ))}
  </tr>
</thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td style={{ ...styles.td, padding: 24 }} colSpan={orderedTableCols.length + (isAdmin ? 1 : 0)}>
                        <div style={styles.emptyStateCard}>
                          <div style={styles.emptyStateTitle}>No Sales Orders Found</div>
                          <div style={styles.emptyStateText}>
                            Try switching between Pre-Salesorders/Salesorders or relax a filter.
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paged.map((so, idx) => (
                     <tr
  key={normalizeDocId(so.id) || so.kpiId || so.autoId || so.KPIID || idx}
  style={{
    ...styles.tr,
    background: idx % 2 === 0 ? "#fff" : "#fff8f8",
    cursor: canOpenDrawer ? "pointer" : "default",
  }}
  onClick={() => {
    if (!canOpenDrawer) return;
    setSelectedSO(so);
    setIsDrawerOpen(true);
  }}
>
  {isAdmin && (
    <td style={styles.selectColTd} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={selectedSoIds.includes(normalizeDocId(so.id))}
        onChange={() => toggleSelectSO(so.id)}
      />
    </td>
  )}
  {orderedTableCols.map((col) => (
    <td key={col.key} style={styles.td}>
      {renderCellValue(so[col.key], col.key)}
    </td>
  ))}
</tr>
                    ))
                  )}
                </tbody>
              </table>
          </div>

            {/* Pagination */}
            <div style={styles.pagination}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span>
                  {startIdx + 1}–{Math.min(startIdx + perPage, sorted.length)} of {sorted.length}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Records per page</span>
                  <select
                    value={perPage}
                    onChange={(e) => {
                      setPerPage(Number(e.target.value));
                      setPage(1);
                    }}
                    style={{ ...styles.dropdown, padding: "6px 8px", border: "1px solid #800000", color: "#800000" }}
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={styles.pageBtn}>
                  Prev
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={styles.pageBtn}>
                  Next
                </button>
                {hasMore && page >= totalPages && (
                  <button onClick={() => fetchSalesOrders(false)} style={styles.pageBtn}>
                    Load more
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drawer */}
      {isDrawerOpen && selectedSO && (
        <SalesOrderDrawer
  so={selectedSO}
  perm={perm}      // <-- ADD THIS
  onClose={() => {
    setIsDrawerOpen(false);
    setSelectedSO(null);
    fetchSalesOrders(true);
  }}
  fieldsDef={fieldsDef}
  />
)}
      <MassUpdateDialog
        open={showMassUpdate}
        rowCount={selectedSoIds.length}
        fields={MASS_UPDATE_FIELDS}
        selectedField={massField}
        onFieldChange={(v) => {
          setMassField(v);
          setMassInput("");
          setMassValue("");
        }}
        inputOptions={getInputOptionsForField(massField)}
        selectedInput={massInput}
        onInputChange={(v) => {
          setMassInput(v);
          if (v) setMassValue(v);
        }}
        value={massValue}
        onValueChange={setMassValue}
        onApply={applyMassUpdateSO}
        onClose={() => setShowMassUpdate(false)}
        loading={isMassUpdating}
      />
    </div>
  );
}

// ===============================
// 🔥 EXPORT DATE HELPERS (ADD HERE)
// ===============================
const toJSDate = (v) => {
  if (!v) return null;

  // Firestore Timestamp
  if (typeof v?.toDate === "function") return v.toDate();

  // Timestamp-like
  if (v?.seconds) return new Date(v.seconds * 1000);

  // ISO / string
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  // JS Date
  if (v instanceof Date) return v;

  return null;
};

const formatDate = (d) =>
  d ? d.toLocaleDateString("en-GB") : "";

const normalizeSalesOrderStatus = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (["deal won", "closed won", "won"].includes(normalized)) return "Won";
  if (["lost", "closed lost", "lost to competition"].includes(normalized)) return "Lost";
  if (normalized === "converted") return "Converted";
  if (normalized === "not converted") return "Not Converted";
  if (normalized === "new") return "New";
  if (normalized === "qualification") return "Qualification";

  return value || "-";
};

const getSalesOrderStatusStyle = (status) => {
  const canonical = normalizeSalesOrderStatus(status);
  if (canonical === "Won" || canonical === "Converted") {
    return { background: "#e7f8ee", color: "#166534", border: "1px solid #86efac" };
  }
  if (canonical === "Lost") {
    return { background: "#feecec", color: "#991b1b", border: "1px solid #fca5a5" };
  }
  if (canonical === "Qualification" || canonical === "New" || canonical === "Not Converted") {
    return { background: "#fff7e6", color: "#92400e", border: "1px solid #fcd34d" };
  }
  return { background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" };
};

const getPaymentModeStyle = (mode) => {
  const key = String(mode || "").trim().toLowerCase();
  if (key === "baja" || key === "bajaj") return { background: "#e7f8ee", color: "#166534", border: "1px solid #86efac" };
  if (key === "cash") return { background: "#fff7e6", color: "#92400e", border: "1px solid #fcd34d" };
  if (key === "ecofy") return { background: "#ecfeff", color: "#155e75", border: "1px solid #67e8f9" };
  if (key === "npl") return { background: "#feecec", color: "#991b1b", border: "1px solid #fca5a5" };
  if (key === "solfin") return { background: "#f3e8ff", color: "#6b21a8", border: "1px solid #d8b4fe" };
  return { background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" };
};

// helper used in dynamic cell render
function renderCellValue(value, colKey) {
  if (colKey === "status") {
    const canonical = normalizeSalesOrderStatus(value);
    const badgeStyle = getSalesOrderStatusStyle(canonical);
    return (
      <span
        style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 999,
          fontWeight: 700,
          fontSize: 12,
          ...badgeStyle,
        }}
      >
        {canonical}
      </span>
    );
  }
  if (colKey === "paymentMode") {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase();
    const text = key === "baja" ? "Bajaj" : raw || "-";
    const badgeStyle = getPaymentModeStyle(text);
    return (
      <span
        style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 999,
          fontWeight: 700,
          fontSize: 12,
          ...badgeStyle,
        }}
      >
        {text}
      </span>
    );
  }
  // Firestore Timestamp
  if (value?.seconds && value?.nanoseconds && typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString("en-GB");
  }

  // Currency
  if (
    colKey === "invoiceAmount" ||
    colKey === "paymentReceived" ||
    colKey === "pendingPayment"
  ) {
    return `₹${Number(value || 0).toLocaleString()}`;
  }

  // Percentage (🔥 FIX)
  if (colKey === "paymentPercentage") {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  // Capacity
  if (colKey === "capacity") {
    return `${Number(value || 0)} kW`;
  }

  // Arrays
  if (Array.isArray(value)) return value.join(", ");

  // Objects
  if (typeof value === "object" && value !== null) {
    if (value.name) return value.name;
    if (value.label) return value.label;
    return "";
  }

  return value ?? "";
}

/* styles (same visual language as LeadsDashboard) */
const styles = {
container: {
  display: "flex",
  width: "100%",
  minHeight: "100vh",     // ✅ KEY FIX
  overflowX: "hidden",
  fontFamily: "Poppins, sans-serif",
  backgroundColor: "#fff",
},
sidebar: {
  backgroundColor: "#800000",
  color: "#fff",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  boxSizing: "border-box",
},
  sidebarTitle: { fontWeight: "bold", fontSize: 18 },
  searchInput: { padding: 8, borderRadius: 6, border: "none" },
  label: { marginTop: 10, fontSize: 14, color: "#fff" },
  dropdown: { padding: 8, borderRadius: 6, border: "none" },
mainContent: {
  flex: 1,
  minWidth: 0,
  padding: isMobile ? 12 : 28,
  overflowY: "hidden",
  overflowX: "hidden",
  minHeight: 0,
  boxSizing: "border-box",
},
  headerCard: {
    padding: isMobile ? 12 : 16,
    borderRadius: 14,
    border: "1px solid rgba(128,0,0,0.12)",
    background: "linear-gradient(135deg, #fff 0%, #fff8f9 50%, #fff4f6 100%)",
    boxShadow: "0 10px 24px rgba(128,0,0,0.08)",
    marginBottom: 14,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    flexWrap: "wrap",
    zIndex: 2,
  },
  header: { color: "#800000", fontSize: 24, fontWeight: "bold", margin: 0 },
  headerSub: {
    marginTop: 4,
    marginBottom: 10,
    color: "#9a3a3a",
    fontSize: 12,
    fontWeight: 600,
  },
  toolbarWrap: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  stageSwitchWrap: {
    display: "inline-flex",
    border: "1px solid rgba(128,0,0,0.22)",
    borderRadius: 999,
    overflow: "hidden",
    background: "#fff",
    boxShadow: "0 8px 16px rgba(128,0,0,0.08)",
  },
  stageBtn: {
    background: "#fff",
    color: "#800000",
    border: "none",
    borderRight: "1px solid rgba(128,0,0,0.2)",
    padding: "9px 16px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  stageBtnActive: {
    background: "linear-gradient(135deg, #800000, #a11212)",
    color: "#fff",
  },
  stageHint: {
    marginTop: 6,
    fontSize: 12,
    color: "#7f1d1d",
    fontWeight: 600,
  },
  exportBtn: {
    background: "#fff",
    color: "#800000",
    border: "1px solid rgba(128,0,0,0.35)",
    borderRadius: 10,
    padding: "6px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 0.2,
    boxShadow: "0 4px 10px rgba(128,0,0,0.08)",
  },
  manageBtn: {
    background: "linear-gradient(135deg, #8b0000, #a11212)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "6px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 0.2,
    boxShadow: "0 6px 12px rgba(128,0,0,0.18)",
  },
  manageMenu: {
    position: "absolute",
    right: 0,
    top: "42px",
    background: "linear-gradient(180deg, #ffffff 0%, #fff9f9 100%)",
    border: "1px solid rgba(128,0,0,0.16)",
    boxShadow: "0 14px 30px rgba(77, 12, 12, 0.18)",
    borderRadius: 14,
    padding: 12,
    zIndex: 10000,
    minWidth: 280,
    width: 320,
  },
  manageHeaderWrap: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: "1px solid rgba(128,0,0,0.12)",
  },
  manageTitle: {
    fontWeight: 800,
    color: "#7a0011",
    fontSize: 18,
    lineHeight: 1.2,
  },
  manageSubtitle: {
    color: "#9a3a3a",
    fontSize: 12,
    marginTop: 2,
  },
  manageList: {
    maxHeight: "52vh",
    overflowY: "auto",
    paddingRight: 4,
  },
  manageSectionTitle: {
    marginTop: 8,
    marginBottom: 6,
    fontWeight: 800,
    color: "#800000",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  manageItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    color: "#800000",
    fontSize: 14,
    border: "1px solid rgba(128,0,0,0.12)",
    borderRadius: 10,
    background: "#fff",
    marginBottom: 6,
  },
  manageCheck: {
    accentColor: "#800000",
    width: 16,
    height: 16,
    cursor: "pointer",
  },
  manageActions: {
    display: "flex",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(128,0,0,0.12)",
  },
tableWrapper: {
  width: "100%",
  maxWidth: "100%",
  borderRadius: 12,
  border: "1px solid rgba(128,0,0,0.12)",
  boxShadow: "0 8px 20px rgba(128,0,0,0.06)",
  position: "relative",
  zIndex: 1,
  overflowX: "auto",
  overflowY: "auto",
  maxHeight: "65vh",
  WebkitOverflowScrolling: "touch",
},
  table: {
  width: "max-content",
  minWidth: "100%",
  borderCollapse: "collapse",
  tableLayout: "auto",
},
th: {
  background: "linear-gradient(135deg, #8b0000, #a11212)",
  color: "#fff",
  padding: "12px 10px",
  position: "sticky",
  top: 0,
  zIndex: 10,
  whiteSpace: "nowrap",
},
selectColTh: {
  backgroundColor: "#800000",
  color: "#fff",
  padding: "8px 6px",
  width: 34,
  minWidth: 34,
  maxWidth: 34,
  textAlign: "center",
  position: "sticky",
  top: 0,
  zIndex: 10,
},
td: {
  padding: "12px 10px",
  fontSize: 14,
  color: "#333",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 140,       // ⭐ IMPORTANT
},
selectColTd: {
  padding: "8px 6px",
  width: 34,
  minWidth: 34,
  maxWidth: 34,
  textAlign: "center",
  whiteSpace: "nowrap",
},
  tr: { borderBottom: "1px solid #eee" },
  headerCell: { display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" },
  iconButton: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.25)",
    color: "#fff",
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
  },
  menu: {
    background: "#fff",
    border: "1px solid rgba(128,0,0,0.15)",
    boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
    width: 220,
    borderRadius: 10,
    zIndex: 2147483000,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
    maxHeight: "70vh",
    overflowY: "auto",
  },
  menuItem: {
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "7px 9px",
    cursor: "pointer",
    color: "#800000",
    fontWeight: 700,
    borderRadius: 6,
    fontSize: 13,
  },
  filterGroup: { display: "flex", flexDirection: "column", gap: 6, padding: "6px 0" },
  filterLabel: { fontSize: 12, color: "#800000", opacity: 0.9 },
  filterInput: {
    border: "1px solid rgba(128,0,0,0.2)",
    borderRadius: 6,
    padding: 7,
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    minWidth: 0,
  },
  pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, color: "#800000" },
  pageBtn: {
    background: "#fff",
    border: "1px solid #800000",
    color: "#800000",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  emptyStateCard: {
    border: "1px dashed rgba(128,0,0,0.35)",
    borderRadius: 12,
    padding: "20px 14px",
    textAlign: "center",
    background: "linear-gradient(135deg, #fff, #fff9f9)",
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "#7f1d1d",
  },
  emptyStateText: {
    marginTop: 6,
    fontSize: 12,
    color: "#9a3a3a",
  },

  /* Export dialog */
  dialogOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 11000,
  },
  dialogBox: {
    background: "#fff",
    padding: 20,
    borderRadius: 8,
    width: 360,
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  },
  radioLabel: { display: "block", marginTop: 6, color: "#333", fontSize: 14 },
  dialogButtons: {
    marginTop: 16,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  addBtn: { flex: 1, backgroundColor: "#800000", color: "#fff", border: "none", padding: "8px", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  cancelBtn: { flex: 1, backgroundColor: "#fff", color: "#800000", border: "1px solid #800000", padding: "8px", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
};
