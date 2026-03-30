// ✅ src/components/DealsDashboard.jsx (WITH DYNAMIC COLUMNS ADDED - B1 / All support)
// NOTE: Additive-only changes — your existing logic is untouched.

import React, { useEffect, useRef, useState } from "react";
import { db, storage } from "../firebaseConfig";
import {
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  where,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import * as XLSX from "xlsx";
import { useLocation, useNavigate } from "react-router-dom";

import DealDrawer from "./DealDrawer";
import QuotationDrawer from "./QuotationDrawer";
import QuotationPreview from "./QuotationPreview";
import { usePermission } from "../hooks/usePermission";
import { getScopedQuery } from "../helpers/getScopedQuery";
import { fetchCollectionDocs, getDocsWithFallback, fetchPagedDocs } from "../helpers/firestoreFetch";
import MassUpdateDialog from "./Universal/MassUpdateDialog";
import {
  getUserNameByEmailMap,
  importRowsToCollection,
  isAdminSessionUser,
  parseExcelRows,
} from "../helpers/bulkImport";
import { buildQuoteNo, getKpiIdFromRecord, resolveQuoteNo } from "../helpers/quotationNumber";


/* ---------------------------
   DEFAULT COLUMNS (order matters)
   --------------------------- */
const DEFAULT_COLUMNS = [
  { key: "autoId", label: "KPI ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "teleSale", label: "Tele-Sales" },
  { key: "consultantName", label: "Consultant Name" }, 
  { key: "projectType", label: "Project Type" },

  // KEEP ONLY ONE CONSULTANT FIELD
  { key: "assignedConsultant", label: "Assigned Consultant" },
  { key: "siteVisitArrangedDate", label: "Site Visit Arranged Date" },
  { key: "siteVisitCompletedDate", label: "Site Visit Completed Date" },
  { key: "siteSurveyLink", label: "Site Survey Link" },

  { key: "capacity", label: "Capacity (kW)" },
  { key: "expectedRevenue", label: "Expected Revenue (₹)" },
  { key: "stage", label: "Stage" },
  { key: "createdAt", label: "Created At" },
  { key: "sales_area", label: "Sales Area" },
  { key: "sales_zone", label: "Sales Zone" },
  { key: "state", label: "State" },
  { key: "zonal_manager", label: "Zonal Manager" },

  // HIDDEN BY DEFAULT (but still available to Manage Columns)
  { key: "status", label: "Status" },
  { key: "leadRef", label: "Lead Ref" },
  { key: "lead_source", label: "Lead Source" },
  { key: "locationLink", label: "Location Link" },
  { key: "email", label: "Email" },
  { key: "movedFrom", label: "Moved From" },
    { key: "updatedAt", label: "Updated At" },
  { key: "updatedBy", label: "Updated By" },
];

const MASS_UPDATE_FIELDS = DEFAULT_COLUMNS.filter(
  (c) => !["autoId", "createdAt", "updatedAt", "updatedBy"].includes(c.key)
);

const isMobile = window.innerWidth <= 768;
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
const NUMERIC_FILTER_KEYS = new Set(["expectedRevenue", "capacity", "invoiceAmount", "paymentReceived", "pendingPayment", "paymentPercentage"]);

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

export default function DealsDashboard() {

  const perm = usePermission("deals");

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
        <p>You do not have permission to view Deals.</p>
      </div>
    );
  }

  return <DealsDashboardInner perm={perm} />;   // ⭐ END HERE
}

function DealsDashboardInner({ perm }) {

  const location = useLocation();
  const navigate = useNavigate();
  const canOpenDrawer = !!perm.update;
  const isAdmin = isAdminSessionUser() || !!perm?.delete;
  const importInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState([]);
  const [isMassUpdating, setIsMassUpdating] = useState(false);
  const [showMassUpdate, setShowMassUpdate] = useState(false);
  const [massField, setMassField] = useState("assignedConsultant");
  const [massValue, setMassValue] = useState("");
  const [massInput, setMassInput] = useState("");
  const [massUserOptions, setMassUserOptions] = useState([]);

  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [columnFilters, setColumnFilters] = useState({});

  const DEFAULT_HIDDEN = [
    "status",
    "leadRef",
    "lead_source",
    "locationLink",
    "email",
    "movedFrom",
    "assignedConsultant",
     "updatedAt",
  "updatedBy",
  ];

const [visibleColumns, setVisibleColumns] = useState(
  DEFAULT_COLUMNS
    .filter((c) => !DEFAULT_HIDDEN.includes(c.key))
    .map((c) => c.key)
);
console.log("deal row keys:", Object.keys(deals[0] || {}));
  const [showManageCols, setShowManageCols] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    fieldType: "selected",
    dataType: "filtered",
  });
  const [pinnedColumns, setPinnedColumns] = useState([]);
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  const normalizeDealsColumnKey = (key) => {
    const normalized = String(key || "").trim();
    if (!normalized) return "";
    if (normalized === "designlink" || normalized === "designLink") return "siteSurveyLink";
    return normalized;
  };

  const normalizeDealsColumnLabel = (key, label) => {
    const normalizedKey = normalizeDealsColumnKey(key);
    if (normalizedKey === "siteSurveyLink") return "Site Survey Link";
    return label;
  };

  // dynamic fields & layout defs (from /crm_fields/deals)
  const [fieldsDef, setFieldsDef] = useState([]); // admin-managed field defs
  const [layoutDef, setLayoutDef] = useState([]); // not used for table but kept
  const [dynamicCols, setDynamicCols] = useState([]); // computed dynamic {key,label} array

  // drawer / attachments / quotation UI
  const [drawerDeal, setDrawerDeal] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [showAttachments, setShowAttachments] = useState(false);

  // Quotation states
  const [quotationDeal, setQuotationDeal] = useState(null);
  const [showQuotationDrawer, setShowQuotationDrawer] = useState(false);
  const [previewQuotationData, setPreviewQuotationData] = useState(null);

  // column menu
  const [activeColumnMenu, setActiveColumnMenu] = useState(null);
  const columnMenuRef = useRef(null);
  const MAX_ROWS = 1000;
  const fetchInFlightRef = useRef(false);
  const PAGE_SIZE = 200;
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  /* ---------------------------
     Helpers
     --------------------------- */
  const formatCurrency = (v) =>
    typeof v === "number" ? `₹ ${v.toLocaleString()}` : v;

  const normalizeDealStage = (value) => {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");

    if (["deal won", "closed won", "won"].includes(normalized)) return "Won";
    if (["lost", "closed lost", "lost to competition"].includes(normalized)) return "Lost";
    if (normalized === "qualification") return "Qualification";
    if (normalized === "proposal") return "Proposal";
    if (normalized === "negotiation") return "Negotiation";
    if (normalized === "hold") return "Hold";
    if (normalized === "potential customer") return "Potential Customer";

    return value || "";
  };

  const normalizeDocId = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parts = raw.split("/").filter(Boolean);
    return parts[parts.length - 1] || raw;
  };

  const isCapacityFieldKey = (key) => {
    const normalized = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    return normalized === "capacity" || normalized === "capacitykw";
  };

  const parsePositiveCapacityValue = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
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

  const getStageBadgeStyle = (stage) => {
    const canonical = normalizeDealStage(stage);
    if (canonical === "Won") {
      return { background: "#e7f8ee", color: "#166534", border: "1px solid #86efac" };
    }
    if (canonical === "Lost") {
      return { background: "#feecec", color: "#991b1b", border: "1px solid #fca5a5" };
    }
    if (canonical === "Qualification") {
      return { background: "#fff7e6", color: "#92400e", border: "1px solid #fcd34d" };
    }
    return { background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" };
  };

  const isLikelyDateString = (value) =>
    typeof value === "string" &&
    /\d{4}-\d{2}-\d{2}/.test(value);

  const normalizeKeyLoose = (key) =>
    String(key || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "")
      .replace(/[^a-z0-9]/g, "");

  const DEAL_KEY_ALIASES = {
    siteSurveyLink: ["designLink", "designlink", "site_survey_link"],
    siteVisitArrangedDate: [
      "site_visit_arranged_date",
      "siteVisitDate",
      "site_visit_date",
      "siteVisitArranged",
      "site_visit_arranged",
      "siteVisitArrangedOn",
      "site_visit_arranged_on",
      "siteVisitDateArranged",
      "site_visit_date_arranged",
    ],
    siteVisitCompletedDate: ["site_visit_completed_date", "siteVisitCompleted", "site_visit_completed"],
    assignedConsultant: ["assigned_consultant"],
    consultantName: ["consultant_name"],
    teleSale: ["tele_sale", "telecaller"],
    sales_area: ["salesArea", "sales_area_label", "salesAreaLabel"],
    sales_zone: ["salesZone", "sales_zone_label", "salesZoneLabel"],
    state: ["state_label", "stateLabel"],
    zonal_manager: ["zonalManager"],
    lead_source: ["leadSource", "source"],
    location: ["address"],
  };

  const getDealValueByKey = (row = {}, colKey = "") => {
    if (!row || !colKey) return "";

    if (Object.prototype.hasOwnProperty.call(row, colKey) && row[colKey] !== undefined) {
      return row[colKey];
    }

    const aliases = DEAL_KEY_ALIASES[colKey] || [];
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== undefined) {
        return row[alias];
      }
    }

    const target = normalizeKeyLoose(colKey);
    const keys = Object.keys(row || {});
    const looseMatch = keys.find((k) => normalizeKeyLoose(k) === target);
    if (looseMatch) return row[looseMatch];

    return "";
  };

  // Safe cell renderer for dynamic columns (timestamps, arrays, objects)
  const renderCellValue = (value, colKey) => {
    // 🔗 Site Survey Link (clickable, read-only)
if ((colKey === "siteSurveyLink" || colKey === "designLink" || colKey === "designlink") && value) {
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: "#800000",
        fontWeight: 600,
        textDecoration: "underline",
        cursor: "pointer",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      Open Site Survey
    </a>
  );
}
    if (colKey === "stage") {
      const canonical = normalizeDealStage(value);
      const badgeStyle = getStageBadgeStyle(canonical);
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
          {canonical || "-"}
        </span>
      );
    }
    if (value?.seconds && value?.nanoseconds && typeof value.toDate === "function") {
      return value.toDate().toLocaleDateString("en-GB");
    }
    if (value instanceof Date) {
      return value.toLocaleDateString("en-GB");
    }
    if (isLikelyDateString(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("en-GB");
      }
    }
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object" && value !== null) {
      // If object contains display-friendly fields, try to show them concisely
      if (value.name) return value.name;
      if (value.label) return value.label;
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }
    if (colKey === "expectedRevenue" && (value !== undefined && value !== null && value !== "")) {
      // maintain two decimals display
      return `₹ ${Number(value).toFixed(2)}`;
    }
    return value ?? "";
  };

  /* ---------------------------
     Fetch deals (fixed dedupe)
     --------------------------- */
const fetchDeals = async (reset = false) => {
  if (fetchInFlightRef.current) return;
  fetchInFlightRef.current = true;
  setLoading(true);
  try {

    // 1️⃣ FETCH USERS (KEEP AS IS)
    const usersSnap = await fetchCollectionDocs("Users");
    const userMap = {};
    usersSnap.forEach((d) => {
      const emailKey = String(d?.email || "").trim().toLowerCase();
      const nameVal = d?.Name || d?.name || "";
      if (emailKey && nameVal) {
        userMap[emailKey] = nameVal;
      }
    });

    // 1.5️⃣ FETCH LEADS (fallback source for mandatory scope fields)
    const leadsSnap = await fetchCollectionDocs("leads", 2500, 30000, MAX_ROWS);
    const leadsByKpi = new Map();
    const leadsByPhone = new Map();

    (leadsSnap || []).forEach((lead) => {
      const kpiRaw = String(
        lead?.autoId || lead?.kpiId || lead?.kpi_id || ""
      )
        .trim()
        .toUpperCase();
      const phoneRaw = String(lead?.phone || "")
        .replace(/\D+/g, "")
        .trim();

      if (kpiRaw) leadsByKpi.set(kpiRaw, lead);
      if (phoneRaw) leadsByPhone.set(phoneRaw, lead);
    });

    // 2️⃣ FETCH DEALS (ROLE BASED 🔥)
    const q = await getScopedQuery("deals");
    const baseQuery = q?._query ? q : query(q, orderBy("createdAt", "desc"));
    const { docs, lastDoc: nextLast } = await fetchPagedDocs(baseQuery, "deals", {
      limitCount: PAGE_SIZE,
      startAfterDoc: reset ? null : lastDoc,
      cacheMs: 30000,
    });
    const rows = docs || [];

    const data = rows.map((d) => {
      const raw = d.data || d;
      const dealKpi = String(raw.autoId || raw.kpiId || "")
        .trim()
        .toUpperCase();
      const dealPhone = String(raw.phone || "")
        .replace(/\D+/g, "")
        .trim();
      const linkedLead =
        leadsByKpi.get(dealKpi) ||
        leadsByPhone.get(dealPhone) ||
        null;

      // ✅ inherit missing deal fields from lead without overriding existing deal values
      const mergedRow = {
        ...(linkedLead || {}),
        ...raw,
      };

      const assignedEmail = String(
        mergedRow.assignedConsultant || mergedRow.assigned_consultant || ""
      )
        .trim()
        .toLowerCase();

      const resolvedConsultantName =
        (assignedEmail && userMap[assignedEmail]) ||
        mergedRow.consultantName ||
        mergedRow.consultant_name ||
        "";

      return {
        ...mergedRow,
        id: normalizeDocId(d.id || d.docId || d.name || ""),

        autoId: mergedRow.autoId || mergedRow.kpiId || "",
        siteSurveyLink: mergedRow.siteSurveyLink || mergedRow.designLink || mergedRow.designlink || "",
        designLink: mergedRow.siteSurveyLink || mergedRow.designLink || mergedRow.designlink || "",
        siteVisitArrangedDate:
          mergedRow.siteVisitArrangedDate ||
          mergedRow.site_visit_arranged_date ||
          mergedRow.siteVisitDate ||
          mergedRow.site_visit_date ||
          mergedRow.siteVisitArrangedOn ||
          mergedRow.site_visit_arranged_on ||
          "",
        siteVisitCompletedDate:
          mergedRow.siteVisitCompletedDate ||
          mergedRow.site_visit_completed_date ||
          mergedRow.siteVisitCompleted ||
          mergedRow.site_visit_completed ||
          "",

        // ⭐ Consultant name resolved safely
        consultantName: sanitizeLegacyUserDisplay(resolvedConsultantName),
        assignedConsultant: sanitizeLegacyUserDisplay(
          mergedRow.assignedConsultant || mergedRow.assigned_consultant || ""
        ),
        teleSale: sanitizeLegacyUserDisplay(
          mergedRow.teleSale || mergedRow.tele_sale || mergedRow.telecaller || ""
        ),
        projectType: mergedRow.projectType || "Residential",

        // Prefer display labels so casing stays exactly as entered in Lead
        state: pickScopedDisplay(
          mergedRow.state || mergedRow.stateLabel || mergedRow.state_label || linkedLead?.state || linkedLead?.state_label,
          mergedRow.state_label || mergedRow.stateLabel || linkedLead?.state_label
        ),
        sales_zone: pickScopedDisplay(
          mergedRow.sales_zone || mergedRow.salesZone || mergedRow.sales_zone_label || linkedLead?.sales_zone || linkedLead?.sales_zone_label,
          mergedRow.sales_zone_label || mergedRow.salesZoneLabel || linkedLead?.sales_zone_label
        ),
        sales_area: pickScopedDisplay(
          mergedRow.sales_area || mergedRow.salesArea || mergedRow.sales_area_label || linkedLead?.sales_area || linkedLead?.sales_area_label,
          mergedRow.sales_area_label || mergedRow.salesAreaLabel || linkedLead?.sales_area_label
        ),
        zonal_manager: mergedRow.zonal_manager || mergedRow.zonalManager || "",

        capacity:
          mergedRow.capacity !== undefined && mergedRow.capacity !== null
            ? mergedRow.capacity
            : "",

        expectedRevenue:
          mergedRow.expectedRevenue !== undefined &&
          mergedRow.expectedRevenue !== null
            ? mergedRow.expectedRevenue
            : "",
      };
    });

    const uniqueByDocId = new Map();
    data.forEach((d) => {
      if (d?.id) uniqueByDocId.set(d.id, d);
    });

    setDeals((prev) => {
      if (reset) {
        return Array.from(uniqueByDocId.values()).slice(0, MAX_ROWS);
      }
      const merged = new Map();
      prev.forEach((d) => {
        if (d?.id) merged.set(d.id, d);
      });
      uniqueByDocId.forEach((value, key) => {
        merged.set(key, value);
      });
      return Array.from(merged.values()).slice(0, MAX_ROWS);
    });
    setLastDoc(nextLast || null);
    setHasMore((docs || []).length === PAGE_SIZE);
  } catch (err) {
    console.error("❌ Error fetching deals:", err);
    setDeals([]);
  } finally {
    setLoading(false);
    fetchInFlightRef.current = false;
  }
};

  useEffect(() => {
    const isVisible = () => !document.hidden;
    if (isVisible()) fetchDeals(true);

    const timer = setInterval(() => {
      if (isVisible()) fetchDeals(true);
    }, 60 * 1000);

    const onVisible = () => {
      if (isVisible()) fetchDeals(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => fetchDeals(true);
    window.addEventListener("deal-updated", handler);
    window.addEventListener("refresh-deals", handler);
    return () => {
      window.removeEventListener("deal-updated", handler);
      window.removeEventListener("refresh-deals", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ⭐ AUTO-OPEN DEAL DRAWER WHEN ?open=ID COMES FROM UNIVERSAL SEARCH
// ⭐ AUTO-OPEN DEAL DRAWER WHEN ?open=ID COMES FROM UNIVERSAL SEARCH
useEffect(() => {
  if (!location.pathname.includes("/deals")) return;
  if (!canOpenDrawer) return;

  const params = new URLSearchParams(location.search);
  const openId = params.get("open");
  if (!openId) return;

  if (deals.length === 0) return;

  const match = deals.find((d) => d.id === openId || d.autoId === openId);
  if (match) {
    setDrawerDeal(match);

    // clean url
    params.delete("open");
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : ""
    }, { replace: true });
  }
}, [location.pathname, location.search, deals, canOpenDrawer]);

  /* ---------------------------
     Watch crm_fields/deals for admin-driven layout & fields (realtime)
     --------------------------- */
  useEffect(() => {
    let unsub = null;
    try {
      const ref = doc(db, "crm_fields", "deals");
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            setFieldsDef([]);
            setLayoutDef([]);
            setDynamicCols([]);
            return;
          }
          const data = snap.data() || {};
          const defs = Array.isArray(data.fields) ? data.fields : [];

          const normalized = defs.map((f) =>
            typeof f === "string"
              ? {
                  name: f,
                  label: prettyLabel(f),
                  type: "text",
                  required: false,
                  options: [],
                  default: "",
                }
              : { ...(f || {}), options: f.options || [], default: f.default ?? "" }
          );

          setFieldsDef(normalized);
          setLayoutDef(Array.isArray(data.layout) ? data.layout : []);

          // Derive dynamicCols from fieldsDef but exclude any keys present in DEFAULT_COLUMNS
          const defaultKeySet = new Set(DEFAULT_COLUMNS.map((c) => c.key));
          const dynRaw = normalized
            .map((fd) => {
              const rawKey = fd.name;
              const key = normalizeDealsColumnKey(rawKey);
              const baseLabel = fd.label || prettyLabel(rawKey);
              const label = normalizeDealsColumnLabel(rawKey, baseLabel);
              return { key, label };
            })
            .filter((dc) => !defaultKeySet.has(dc.key) && dc.key !== "id");

          const seenDyn = new Set();
          const dyn = dynRaw.filter((dc) => {
            if (!dc?.key || seenDyn.has(dc.key)) return false;
            seenDyn.add(dc.key);
            return true;
          });
          setDynamicCols(dyn);

          // Ensure dynamic columns are visible by default (append to visibleColumns if missing)
          // Also migrate any legacy "designlink/designLink" visibility key to "siteSurveyLink".
          setVisibleColumns((prev) => {
            const next = Array.from(new Set(prev.map((key) => normalizeDealsColumnKey(key)).filter(Boolean)));
            dyn.forEach((d) => {
              if (!next.includes(d.key)) next.push(d.key);
            });
            return next;
          });
        },
        (err) => {
          console.error("crm_fields/deals snapshot error:", err);
        }
      );
    } catch (err) {
      console.error("Failed to subscribe to crm_fields/deals:", err);
    }

    return () => {
      if (typeof unsub === "function") unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------
     Attachments loader (firebase storage)
     --------------------------- */
  const fetchAttachments = async (dealId) => {
    try {
      const listRef = ref(storage, `deal_attachments/${dealId}`);
      const res = await listAll(listRef);
      const urls = await Promise.all(
        res.items.map(async (item) => {
          const url = await getDownloadURL(item);
          return { name: item.name, url };
        })
      );
      setAttachments(urls);
      setShowAttachments(true);
    } catch (err) {
      console.error("⚠️ Error loading attachments:", err);
      setAttachments([]);
      setShowAttachments(true);
    }
  };

  /* ---------------------------
     Filter + Search
     --------------------------- */
  const filteredDeals = deals.filter((d) => {
    const sTerm = (searchTerm || "").toString().toLowerCase();
    const matchSearch =
      (d.name || "").toLowerCase().includes(sTerm) ||
      (d.phone || "").includes(searchTerm || "") ||
      (d.autoId || "").toLowerCase().includes(sTerm);
    const matchStage =
      stageFilter === "all" ||
      normalizeDealStage(d.stage) === normalizeDealStage(stageFilter);
    const matchColumnFilters = Object.keys(columnFilters).every((key) => {
      const filterToken = String(columnFilters[key] || "").trim();
      if (!filterToken) return true;

      const parsedNumeric = parseNumericFilterToken(filterToken);
      if (parsedNumeric) {
        const rawNumeric = getDealValueByKey(d, key);
        return runNumericFilter(rawNumeric, parsedNumeric);
      }

      let value = getDealValueByKey(d, key);
      if (value?.seconds && value?.nanoseconds && typeof value.toDate === "function") {
        value = value.toDate().toLocaleDateString("en-GB");
      } else if (value instanceof Date) {
        value = value.toLocaleDateString("en-GB");
      } else if (isLikelyDateString(value)) {
        const parsed = new Date(value);
        value = !Number.isNaN(parsed.getTime())
          ? parsed.toLocaleDateString("en-GB")
          : value;
      } else if (Array.isArray(value)) {
        value = value.join(", ");
      } else if (typeof value === "object" && value !== null) {
        try {
          value = JSON.stringify(value);
        } catch {
          value = "";
        }
      }

      const target = normalizeFilterComparable(value, key);
      const token = normalizeFilterComparable(filterToken, key);
      return target.includes(token);
    });

    return matchSearch && matchStage && matchColumnFilters;
  });

  /* ---------------------------
     Sorting
     --------------------------- */
  const sortedDeals = [...filteredDeals].sort((a, b) => {
    const getVal = (obj, key) => {
      const v = getDealValueByKey(obj, key);
      if (v && typeof v.toDate === "function") return v.toDate().getTime();
      if (typeof v === "string") return v.toLowerCase();
      return v ?? "";
    };
    const av = getVal(a, sort.key);
    const bv = getVal(b, sort.key);
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sortedDeals.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedDeals = sortedDeals.slice(startIdx, startIdx + perPage);

  const toggleSelectDeal = (id) => {
    const normalizedId = normalizeDocId(id);
    if (!normalizedId) return;
    setSelectedDealIds((prev) =>
      prev.includes(normalizedId) ? prev.filter((v) => v !== normalizedId) : [...prev, normalizedId]
    );
  };

  const toggleSelectAllPagedDeals = () => {
    const ids = pagedDeals.map((d) => normalizeDocId(d.id)).filter(Boolean);
    if (!ids.length) return;
    setSelectedDealIds((prev) => {
      const allSelected = ids.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !ids.includes(id));
      return Array.from(new Set([...prev, ...ids]));
    });
  };

  const handleMassUpdateDeals = async () => {
    if (!isAdmin) return;
    if (!selectedDealIds.length) {
      alert("Select at least one deal.");
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
        console.warn("Failed loading users for mass update", e?.message || e);
      }
    })();

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const applyMassUpdateDeals = async () => {
    if (!isAdmin) {
      alert("Only admin can perform mass update.");
      return;
    }

    const fieldName = String(massField || "").trim();
    const fieldValue = String(massValue || "").trim();
    if (!fieldName) return alert("Select a field.");
    if (!fieldValue) return alert("Enter value.");

    const isCapacityField = isCapacityFieldKey(fieldName);
    const normalizedFieldValue = isCapacityField
      ? parsePositiveCapacityValue(fieldValue)
      : fieldValue;

    if (isCapacityField && normalizedFieldValue === null) {
      alert("Capacity must be a positive number.");
      return;
    }

    const validIds = new Set(deals.map((d) => normalizeDocId(d.id)).filter(Boolean));
    const idsToUpdate = selectedDealIds
      .map((id) => normalizeDocId(id))
      .filter((id) => id && validIds.has(id));

    if (!idsToUpdate.length) {
      alert("No valid deals selected.");
      return;
    }

    setIsMassUpdating(true);
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : {};

      const existingChecks = await Promise.all(
        idsToUpdate.map(async (id) => {
          const ref = doc(db, "deals", id);
          const snap = await getDoc(ref);
          return snap.exists() ? id : null;
        })
      );
      const existingIds = existingChecks.filter(Boolean);

      if (!existingIds.length) {
        alert("Selected deals were not found. Please refresh and try again.");
        return;
      }

      const batch = writeBatch(db);
      existingIds.forEach((id) => {
        batch.update(doc(db, "deals", id), {
          [fieldName]: normalizedFieldValue,
          updatedAt: serverTimestamp(),
          updatedBy: parsed?.email || "admin",
        });
      });

      await batch.commit();
      await fetchDeals(true);
      setSelectedDealIds([]);
      setShowMassUpdate(false);
      alert(`✅ Updated ${existingIds.length} deal record(s).`);
    } catch (e) {
      console.error("Mass update deals failed", e);
      alert("Mass update failed.");
    } finally {
      setIsMassUpdating(false);
    }
  };

  /* ---------------------------
     Export Excel
     --------------------------- */
  const handleExportExcel = () => {
    const exportAll = exportOptions.dataType === "all";
    const useAllFields = exportOptions.fieldType === "all";
    const dataToExport = exportAll ? deals : filteredDeals;

    if (!dataToExport || dataToExport.length === 0) {
      alert("⚠️ No data to export!");
      return;
    }

    // If user asked for all fields, include dynamic columns too
    const exportCols = useAllFields
      ? [
          ...DEFAULT_COLUMNS,
          ...dynamicCols.map((c) => ({ key: c.key, label: c.label })),
        ]
      : DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key));

    const exportData = dataToExport.map((item) => {
      const row = {};
      exportCols.forEach((col) => {
        let val = getDealValueByKey(item, col.key);
        if (col.key === "createdAt" && item.createdAt?.toDate) {
          val = item.createdAt.toDate().toLocaleDateString("en-GB");
        }
        if (
          col.key === "expectedRevenue" &&
          val !== undefined &&
          val !== null &&
          val !== ""
        ) {
          val = `₹ ${Number(val).toFixed(2)}`;
        }
        row[col.label] = val ?? "";
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Deals");
    const filename = `Deals_Export_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  /* ---------------------------
     Manage columns helper
     --------------------------- */
  const toggleColumn = (key) => {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const unhideAllColumns = () =>
    setVisibleColumns(
      [
        ...DEFAULT_COLUMNS.map((c) => c.key),
        ...dynamicCols.map((c) => c.key),
      ].filter(Boolean)
    );

  /* ---------------------------
     Column menu (positioned popup)
     --------------------------- */
  const openColumnMenu = (e, colKey) => {
    e.stopPropagation();
    setActiveColumnMenu({ key: colKey, x: e.clientX, y: e.clientY });
  };

  const closeColumnMenu = () => setActiveColumnMenu(null);

  const ColumnQuickFilterInput = ({
    colKey,
    columnFilters: activeFilters,
    setColumnFilters: applyFilters,
    closeColumnMenu: closeMenu,
  }) => {
    const curFilter = String(activeFilters[colKey] ?? "");
    const parsedActiveNumeric = parseNumericFilterToken(curFilter);
    const activeFilterText = parsedActiveNumeric
      ? `${parsedActiveNumeric.op} ${parsedActiveNumeric.value}`
      : curFilter;
    const isUserFilterColumn = USER_FILTER_KEYS.has(colKey);
    const isNumericFilterColumn = NUMERIC_FILTER_KEYS.has(colKey);
    const [draft, setDraft] = useState(curFilter.startsWith("__num__:") ? "" : curFilter);
    const [draftOp, setDraftOp] = useState("<");
    const [draftNum, setDraftNum] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);

    const userOptions = (() => {
      const rawValues = deals
        .map((row) => String(getDealValueByKey(row, colKey) || "").trim())
        .filter(Boolean);

      if (!SCOPE_FILTER_KEYS.has(colKey)) {
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
          .filter((opt) => opt.toLowerCase().includes(draft.trim().toLowerCase()))
          .slice(0, 8);

    useEffect(() => {
      const parsed = parseNumericFilterToken(curFilter);
      if (parsed && isNumericFilterColumn) {
        setDraftOp(parsed.op);
        setDraftNum(String(parsed.value));
        setDraft("");
      } else {
        setDraft(curFilter);
        setDraftNum("");
      }
    }, [curFilter, colKey]);

    return (
      <div style={{ width: "100%", minWidth: 0 }}>
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
              marginBottom: 8,
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
                applyFilters((prev) => ({ ...prev, [colKey]: "" }));
                setDraft("");
                setDraftNum("");
                closeMenu();
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
              style={{
                width: 74,
                flex: "0 0 74px",
                boxSizing: "border-box",
                padding: 7,
                borderRadius: 6,
                border: "1px solid #ddd",
                fontSize: 13,
              }}
            >
              {NUMERIC_OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input
              placeholder="Value"
              type="number"
              style={{
                width: "100%",
                maxWidth: "100%",
                boxSizing: "border-box",
                display: "block",
                padding: 7,
                borderRadius: 6,
                border: "1px solid #ddd",
                outline: "none",
                fontSize: 13,
              }}
              value={draftNum}
              onChange={(e) => setDraftNum(e.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  const n = Number(draftNum);
                  applyFilters((prev) => ({
                    ...prev,
                    [colKey]: Number.isFinite(n) ? `__num__:${draftOp}:${n}` : "",
                  }));
                  closeMenu();
                }
              }}
            />
          </div>
        ) : (
          <>
            <div style={{ position: "relative" }}>
              <input
                placeholder={isUserFilterColumn ? "Type or pick value" : "Type filter"}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  display: "block",
                  padding: 7,
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  outline: "none",
                  fontSize: 13,
                }}
                value={draft}
                onFocus={() => {
                  if (isUserFilterColumn) setShowSuggestions(true);
                }}
                onBlur={() => {
                  if (isUserFilterColumn) setShowSuggestions(false);
                }}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (isUserFilterColumn) setShowSuggestions(true);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    applyFilters((prev) => ({ ...prev, [colKey]: draft.trim() }));
                    closeMenu();
                  }
                }}
              />

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
                        setDraft(opt);
                        applyFilters((prev) => ({ ...prev, [colKey]: opt }));
                        closeMenu();
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
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            style={{ ...styles.menuBtn, flex: 1 }}
            onClick={() => {
              if (isNumericFilterColumn) {
                const n = Number(draftNum);
                applyFilters((prev) => ({
                  ...prev,
                  [colKey]: Number.isFinite(n) ? `__num__:${draftOp}:${n}` : "",
                }));
              } else {
                applyFilters((prev) => ({ ...prev, [colKey]: draft.trim() }));
              }
              closeMenu();
            }}
          >
            Apply
          </button>
          <button
            style={{ ...styles.menuBtn, flex: 1 }}
            onClick={() => {
              const parsed = parseNumericFilterToken(curFilter);
              if (parsed && isNumericFilterColumn) {
                setDraftOp(parsed.op);
                setDraftNum(String(parsed.value));
              } else {
                setDraft(curFilter);
              }
              closeMenu();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const onDocClick = (ev) => {
      if (!columnMenuRef.current) return;
      if (!columnMenuRef.current.contains(ev.target)) {
        setActiveColumnMenu(null);
      }
    };
    if (activeColumnMenu) {
      window.addEventListener("click", onDocClick);
      window.addEventListener("resize", closeColumnMenu);
    }
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("resize", closeColumnMenu);
    };
  }, [activeColumnMenu]);

  // ColumnMenu now supports dynamic columns as well
  const ColumnMenu = ({ colKey, posX, posY }) => {
      const isPinned = pinnedColumns.includes(colKey);

    const col =
      DEFAULT_COLUMNS.find((c) => c.key === colKey) ||
      dynamicCols.find((c) => c.key === colKey) ||
      { key: colKey, label: colKey };
    const menuWidth = 220;
    const menuHeightEstimate = 320;
    const left = Math.max(8, Math.min(posX + 8, window.innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(posY + 6, window.innerHeight - menuHeightEstimate - 8));

    const menuStyle = {
      position: "fixed",
      top,
      left,
      width: menuWidth,
      maxWidth: "calc(100vw - 16px)",
      zIndex: 12000,
      background: "linear-gradient(180deg, #ffffff 0%, #fff8f8 100%)",
      border: "1px solid rgba(128,0,0,0.18)",
      borderRadius: 12,
      padding: 10,
      boxShadow: "0 16px 28px rgba(77,12,12,0.18)",
      overflow: "hidden",
      maxHeight: "70vh",
      overflowY: "auto",
    };

    return (
      <div
        ref={columnMenuRef}
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 800, color: "#7a0011", fontSize: 16, marginBottom: 2 }}>
          {col.label}
        </div>
        <div style={{ fontSize: 12, color: "#9a3a3a", marginBottom: 8 }}>Column actions</div>

        <div style={{ marginBottom: 8 }}>
          <button
            style={{ ...styles.menuBtn }}
            onClick={() => {
              setSort({ key: colKey, dir: "asc" });
              closeColumnMenu();
            }}
          >
            ↑ Asc
          </button>
          <button
            style={{ ...styles.menuBtn, marginLeft: 8 }}
            onClick={() => {
              setSort({ key: colKey, dir: "desc" });
              closeColumnMenu();
            }}
          >
            ↓ Desc
          </button>
        </div>

        <div style={{ marginBottom: 8 }}>
          <button
            style={styles.menuAction}
            onClick={() => {
              setPinnedColumns((prev) =>
                prev.includes(colKey)
                  ? prev.filter((k) => k !== colKey)
                  : [...prev, colKey]
              );
              closeColumnMenu();
            }}
          >
            {isPinned ? "📍 Unpin Column" : "📌 Pin Column"}
          </button>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#800000", marginBottom: 6, fontWeight: 700 }}>🔎 Quick filter</div>
          <ColumnQuickFilterInput
            colKey={colKey}
            columnFilters={columnFilters}
            setColumnFilters={setColumnFilters}
            closeColumnMenu={closeColumnMenu}
          />
        </div>

        <div style={{ marginTop: 6 }}>
          <button
            style={styles.menuAction}
            onClick={() => {
              toggleColumn(colKey);
              setPinnedColumns((prev) => prev.filter((k) => k !== colKey));
              closeColumnMenu();
            }}
          >
            {visibleColumns.includes(colKey) ? "🙈 Hide Column" : "👁 Show Column"}
          </button>
        </div>
      </div>
    );
  };

  /* ---------------------------
     Quotation helpers & persistence (UNCHANGED)
     --------------------------- */
  const createQuotationFromDeal = (deal) => {
    const dealCapacity = Number(deal.capacity || 0) || 1;
    const kpiId = getKpiIdFromRecord(deal);
    const quoteNo = buildQuoteNo(kpiId);
    return {
      quotationId: quoteNo || `QTN-${String(new Date().getTime()).slice(-6)}`,
      quoteNo,
      kpiId,
      projectType: deal.projectType || "Residential",
      customerName: deal.name || "",
      customerPhone: deal.phone || "",
      capacity: dealCapacity,
      systemQty: Number(deal.systemQty || dealCapacity || 1),
      structureQty: Number(deal.structureQty || 0),
      templateType: deal.templateType || "Residential-OnGrid",
      panelBrand: deal.panelBrand || "Premier Solar",
      panelWatt: deal.panelWatt || "545 Wp",
      panelType: deal.panelType || "Topcon",
      inverterBrand: deal.inverterBrand || "Polycab",
      inverterSize: deal.inverterSize || "10kW",
      systemCost: deal.systemCost || 70000,
      gst: deal.gst || 8.9,
      subsidy: deal.subsidy || 0,
      createdFromDeal: deal.id || null,
      createdAt: new Date(),
    };
  };

  const openQuotationDrawer = (dealRow) => {
    setQuotationDeal(dealRow);
    setShowQuotationDrawer(true);
  };

  const closeQuotationDrawer = () => {
    setShowQuotationDrawer(false);
    setQuotationDeal(null);
  };

  const openQuotationPreview = async (dealRow) => {
    try {
      const docId = dealRow.id || dealRow.autoId;
      if (docId) {
        const refDoc = doc(db, "deals", docId);
        const snap = await getDoc(refDoc);
        if (snap.exists()) {
          const data = snap.data();
          if (data.quotation) {
            const mergedQuotation = {
              ...data.quotation,
              dealId: data.id || dealRow.id,
              kpiId:
                data.quotation.kpiId ||
                data.autoId ||
                data.kpiId ||
                dealRow.autoId ||
                dealRow.kpiId ||
                dealRow.id ||
                "",
            };
            const preview = {
              ...mergedQuotation,
              quoteNo: resolveQuoteNo(mergedQuotation),
              isSaved: true,
              capacity: Number(data.capacity || dealRow.capacity || mergedQuotation.capacity || 1),
              systemQty: Number(mergedQuotation.systemQty || data.capacity || dealRow.capacity || mergedQuotation.capacity || 1),
              structureQty:
                Number(mergedQuotation.structureRate || 0) > 0
                  ? Number(mergedQuotation.structureQty || 0)
                  : 0,
              customerName: mergedQuotation.customerName || data.name || "",
              customerPhone: mergedQuotation.customerPhone || data.phone || "",
              address: mergedQuotation.address || "",
            };
            setPreviewQuotationData(preview);
            return;
          }
        }
      }
    } catch (err) {
      console.warn("No saved quotation inside deal doc:", err);
    }

    const q = createQuotationFromDeal(dealRow);
    setPreviewQuotationData({ ...q, quoteNo: resolveQuoteNo(q), isSaved: false });
  };

  const closeQuotationPreview = () => setPreviewQuotationData(null);

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
        collectionName: "deals",
        rows,
        preferDocIdKeys: ["kpiId", "autoId", "id"],
        userMeta: {
          uid: parsed?.uid || parsed?.id || "",
          email: parsed?.email || "",
        },
        transformRow: (row) => {
          const assignedEmail = String(row.assignedConsultant || "").trim().toLowerCase();
          const docKpi = String(row.kpiId || row.autoId || "").trim();
          const rawCapacity =
            row.capacity ??
            row["Capacity (kW)"] ??
            row["capacity (kw)"] ??
            row.capacityKw ??
            row.capacityKW;
          const hasCapacityInput = String(rawCapacity ?? "").trim() !== "";
          const parsedCapacity = hasCapacityInput
            ? parsePositiveCapacityValue(rawCapacity)
            : null;

          if (hasCapacityInput && parsedCapacity === null) {
            throw new Error(
              `Invalid capacity value for row ${docKpi || row.id || row.autoId || row.name || ""}. Capacity must be a positive number.`
            );
          }

          const transformedRow = {
            ...row,
            kpiId: docKpi || row.kpiId || "",
            autoId: row.autoId || docKpi || "",
            name: row.name || row.customerName || "",
            consultantName: row.consultantName || emailNameMap[assignedEmail] || "",
          };

          if (hasCapacityInput) {
            transformedRow.capacity = parsedCapacity;
          }

          return transformedRow;
        },
      });

      await fetchDeals(true);
      alert(`✅ Imported ${result.imported} deal records.`);
    } catch (err) {
      console.error("Deal import failed", err);
      alert("Import failed. Please check file format.");
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

  const saveQuotationToFirestore = async (quotationObj) => {
    try {
      if (!quotationObj) throw new Error("No quotation object provided.");
      const kpiOrAuto =
        quotationObj.kpiId ||
        quotationObj.autoId ||
        quotationObj.dealId ||
        quotationObj.createdFromDeal ||
        "";

      let docId = quotationObj.dealId || quotationObj.createdFromDeal || "";
      if (docId) {
        const directRef = doc(db, "deals", docId);
        const directSnap = await getDoc(directRef);
        if (!directSnap.exists()) docId = "";
      }

      if (!docId && kpiOrAuto) {
        const byKpi = await getDocs(query(collection(db, "deals"), where("kpiId", "==", kpiOrAuto)));
        if (!byKpi.empty) docId = byKpi.docs[0].id;
      }

      if (!docId && kpiOrAuto) {
        const byAuto = await getDocs(query(collection(db, "deals"), where("autoId", "==", kpiOrAuto)));
        if (!byAuto.empty) docId = byAuto.docs[0].id;
      }

      if (!docId) throw new Error("Unable to determine deal document id.");

      const dealRef = doc(db, "deals", docId);
      const existingSnap = await getDoc(dealRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : {};

      const quoteEntry = {
        ...quotationObj,
        dealId: docId,
        quoteNo: resolveQuoteNo(quotationObj),
        quotationId: resolveQuoteNo(quotationObj),
        createdAt: quotationObj.createdAt || Timestamp.now(),
        savedAt: new Date().toISOString(),
      };

      const prevList = Array.isArray(existingData?.quotations)
        ? existingData.quotations
        : existingData?.quotation
        ? [existingData.quotation]
        : [];

      const quoteKey = String(quoteEntry.quoteNo || quoteEntry.quotationId || "").trim();
      const nextList = quoteKey
        ? [
            quoteEntry,
            ...prevList.filter((q) => {
              const key = String(q?.quoteNo || q?.quotationId || "").trim();
              return key !== quoteKey;
            }),
          ]
        : [quoteEntry, ...prevList];

      const updatePayload = {
        panelBrand: quotationObj.panelBrand,
        panelWatt: quotationObj.panelWatt,
        panelType: quotationObj.panelType,
        inverterBrand: quotationObj.inverterBrand,
        inverterSize: quotationObj.inverterSize,
        systemCost: quotationObj.systemCost,
        gst: quotationObj.gst,
        subsidy: quotationObj.subsidy,
        capacity:
          quotationObj.capacity !== "" && quotationObj.capacity !== null
            ? Number(quotationObj.capacity)
            : "",

        quotation: {
          ...quoteEntry,
        },
        quotations: nextList,

        updatedAt: serverTimestamp(),
      };

      await setDoc(dealRef, updatePayload, { merge: true });

      await fetchDeals(true);

      alert("✅ Quotation saved inside deal document.");
      return quoteEntry;
    } catch (err) {
      console.error("❌ Error saving quotation to Firestore:", err);
      alert("Error saving quotation: " + (err.message || err));
      throw err;
    }
  };

  /* ---------------------------
     Render UI
     --------------------------- */
  return (
  <div
    style={{
      ...styles.container,
      flexDirection: isMobile ? "column" : "row",
      width: "100%",
    }}
  >
      <style>{`
        .kp-scroll-hide {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .kp-scroll-hide::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
      `}</style>

      {/* Sidebar */}
      <div
  style={{
    ...styles.sidebar,
    width: isMobile ? "100%" : "230px",
    minWidth: isMobile ? "100%" : "230px",
    maxWidth: isMobile ? "100%" : "230px",
  }}
>
        <h3 style={styles.sidebarTitle}>Filter Deals</h3>

        <input
          type="text"
          placeholder="Search name, phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        <label style={styles.label}>Stage</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            style={{ ...styles.dropdown, flex: "1 1 130px", minWidth: 0 }}
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="Qualification">Qualification</option>
            <option value="Proposal">Proposal</option>
            <option value="Negotiation">Negotiation</option>
            <option value="Won">Won</option>
            <option value="Lost">Lost</option>
            <option value="Hold">Hold</option>
            <option value="Potential Customer">Potential Customer</option>
          </select>
          <button
            style={{
              ...styles.cancelBtn,
              flex: "0 0 auto",
              padding: "6px 8px",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
            onClick={() => setStageFilter("all")}
            title="Clear stage"
          >
            Clear
          </button>
        </div>

      </div>

      {/* Main */}
      <div style={styles.main}>
        <div style={styles.headerCard}>
          <div style={styles.headerRow}>
            <div>
              <h2 style={styles.header}>Deals Pipeline</h2>
              <div style={styles.headerSub}>Track stage progress, quotations, and ownership updates</div>
            </div>

            <div style={styles.toolbarWrap}>
              {isAdmin && (
                <button
                  style={styles.exportBtn}
                  onClick={handleMassUpdateDeals}
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
                  title="Manage visible columns"
                >
                  ⚙ Manage Columns
                </button>

                {showManageCols && (
                  <div style={styles.dropdownMenu}>
                    <div style={styles.dropdownHeaderWrap}>
                      <div style={styles.dropdownTitle}>Show / Hide Columns</div>
                      <div style={styles.dropdownSubtitle}>Choose what appears in your table</div>
                    </div>

                    <div style={styles.dropdownList}>
                      <div style={styles.dropdownSectionTitle}>Core Fields</div>

                      {DEFAULT_COLUMNS.map((col) => (
                        <label key={col.key} style={styles.dropdownItem}>
                          <input
                            type="checkbox"
                            style={styles.dropdownCheck}
                            checked={visibleColumns.includes(col.key)}
                            onChange={() => toggleColumn(col.key)}
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}

                      {dynamicCols.length > 0 && (
                        <>
                          <div style={styles.dropdownSectionTitle}>Additional Fields</div>
                          {dynamicCols.map((col) => (
                            <label key={col.key} style={styles.dropdownItem}>
                              <input
                                type="checkbox"
                                style={styles.dropdownCheck}
                                checked={visibleColumns.includes(col.key)}
                                onChange={() => toggleColumn(col.key)}
                              />
                              <span>{col.label}</span>
                            </label>
                          ))}
                        </>
                      )}
                    </div>

                    <div style={styles.dropdownActions}>
                      <button style={{ ...styles.addBtn, flex: 1, borderRadius: 10 }} onClick={unhideAllColumns}>
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

        {/* Table */}
        {loading ? (
          <p style={{ color: "#800000" }}>Loading deals...</p>
        ) : pagedDeals.length === 0 ? (
          <div style={styles.emptyStateCard}>
            <div style={styles.emptyStateTitle}>No Deals Found</div>
            <div style={styles.emptyStateText}>Try updating filters or search text.</div>
          </div>
        ) : (
          <div>
            <div className="kp-scroll-hide" style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={styles.th}>
                        <input
                          type="checkbox"
                          checked={pagedDeals.length > 0 && pagedDeals.every((d) => selectedDealIds.includes(normalizeDocId(d.id)))}
                          onChange={toggleSelectAllPagedDeals}
                        />
                      </th>
                    )}
                    {[...DEFAULT_COLUMNS, ...dynamicCols]
                      .filter((c) => visibleColumns.includes(c.key))
                      .sort((a, b) => {
                        const scopeTailKeys = ["sales_area", "sales_zone", "state", "zonal_manager"];
                        const aTail = scopeTailKeys.includes(a.key) ? 1 : 0;
                        const bTail = scopeTailKeys.includes(b.key) ? 1 : 0;
                        if (aTail !== bTail) return aTail - bTail;
                        const aPinned = pinnedColumns.includes(a.key) ? 0 : 1;
                        const bPinned = pinnedColumns.includes(b.key) ? 0 : 1;
                        return aPinned - bPinned;
                      })
                      .map((col) => (
                        <th key={col.key} style={styles.th}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>{col.label}</span>
                            <button
                              onClick={(e) => openColumnMenu(e, col.key)}
                              style={styles.columnHeaderBtn}
                              title="Column menu"
                            >
                              ≡
                            </button>
                          </div>
                        </th>
                      ))}

                    <th style={styles.th}>Quotation</th>
                  </tr>
                </thead>

                <tbody>
                  {pagedDeals.map((dealRow) => (
                    <tr
                      key={dealRow.id}
                      style={styles.tr}
                      onClick={() => {
                        if (!canOpenDrawer) return;
                        setDrawerDeal(dealRow);
                      }}
                    >
                      {isAdmin && (
                        <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedDealIds.includes(normalizeDocId(dealRow.id))}
                            onChange={() => toggleSelectDeal(dealRow.id)}
                          />
                        </td>
                      )}
                      {[...DEFAULT_COLUMNS, ...dynamicCols]
                        .filter((c) => visibleColumns.includes(c.key))
                        .sort((a, b) => {
                          const scopeTailKeys = ["sales_area", "sales_zone", "state", "zonal_manager"];
                          const aTail = scopeTailKeys.includes(a.key) ? 1 : 0;
                          const bTail = scopeTailKeys.includes(b.key) ? 1 : 0;
                          if (aTail !== bTail) return aTail - bTail;
                          const aPinned = pinnedColumns.includes(a.key) ? 0 : 1;
                          const bPinned = pinnedColumns.includes(b.key) ? 0 : 1;
                          return aPinned - bPinned;
                        })
                        .map((col) => (
                          <td key={col.key} style={styles.td}>
                            {renderCellValue(getDealValueByKey(dealRow, col.key), col.key)}
                          </td>
                        ))}

                      <td style={styles.td}>
                        <button
                          style={styles.previewBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            openQuotationPreview(dealRow);
                          }}
                        >
                          🔍 Preview
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={styles.pagination}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span>
                  {sortedDeals.length === 0 ? 0 : startIdx + 1}–
                  {Math.min(startIdx + perPage, sortedDeals.length)} of {sortedDeals.length}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Records per page</span>
                  <select
                    style={{ ...styles.dropdown, padding: "6px 8px", border: "1px solid #800000", color: "#800000" }}
                    value={perPage}
                    onChange={(e) => {
                      setPerPage(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={styles.pageBtn}
                >
                  Prev
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={styles.pageBtn}
                >
                  Next
                </button>
                {hasMore && page >= totalPages && (
                  <button
                    onClick={() => fetchDeals(false)}
                    style={styles.pageBtn}
                  >
                    Load more
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Column menu popup */}
      {activeColumnMenu && (
        <ColumnMenu
          colKey={activeColumnMenu.key}
          posX={activeColumnMenu.x}
          posY={activeColumnMenu.y}
        />
      )}

      {/* Export dialog */}
      {showExportDialog && (
        <div style={styles.dialogOverlay}>
          <div style={styles.dialogBox}>
            <h3 style={{ color: "#800000" }}>📤 Export Deals</h3>

            <div style={{ marginTop: 10 }}>
              <b>Fields to Export</b>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="fieldType"
                  value="selected"
                  checked={exportOptions.fieldType === "selected"}
                  onChange={(e) =>
                    setExportOptions({ ...exportOptions, fieldType: e.target.value })
                  }
                />{" "}
                Selected Fields (Visible Columns)
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="fieldType"
                  value="all"
                  checked={exportOptions.fieldType === "all"}
                  onChange={(e) =>
                    setExportOptions({ ...exportOptions, fieldType: e.target.value })
                  }
                />{" "}
                All Fields (Includes dynamic fields)
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Deals to Export</b>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="dataType"
                  value="filtered"
                  checked={exportOptions.dataType === "filtered"}
                  onChange={(e) =>
                    setExportOptions({ ...exportOptions, dataType: e.target.value })
                  }
                />{" "}
                Current Deals (Filtered)
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="dataType"
                  value="all"
                  checked={exportOptions.dataType === "all"}
                  onChange={(e) =>
                    setExportOptions({ ...exportOptions, dataType: e.target.value })
                  }
                />{" "}
                All Deals
              </label>
            </div>

            <div style={styles.dialogButtons}>
              <button
                style={styles.addBtn}
                onClick={() => {
                  handleExportExcel();
                  setShowExportDialog(false);
                }}
              >
                Export Now
              </button>
              <button style={styles.cancelBtn} onClick={() => setShowExportDialog(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachments modal */}
      {showAttachments && (
        <div style={styles.dialogOverlay}>
          <div style={styles.dialogBox}>
            <h3 style={{ color: "#800000" }}>📎 Deal Attachments</h3>
            {attachments.length === 0 ? (
              <p>No files uploaded for this deal.</p>
            ) : (
              <ul>
                {attachments.map((a) => (
                  <li key={a.name}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: "#800000", textDecoration: "none" }}>
                      {a.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <button style={styles.cancelBtn} onClick={() => setShowAttachments(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Deal Drawer (create/edit) */}
     {drawerDeal && drawerDeal.autoId && (
    <DealDrawer
      existingDeal={drawerDeal}
      onClose={() => setDrawerDeal(null)}
      onDealSaved={() => fetchDeals(true)}
      refreshDeals={() => fetchDeals(true)} 
    />
)}

      {/* Quotation Drawer */}
      {showQuotationDrawer && quotationDeal && (
        <QuotationDrawer
          open={showQuotationDrawer}
          onClose={closeQuotationDrawer}
          deal={quotationDeal}
          onSave={async (quotationObj) => {
            await saveQuotationToFirestore(quotationObj);
            setShowQuotationDrawer(false);
            setQuotationDeal(null);
          }}
        />
      )}

      {/* Quotation Preview */}
      {previewQuotationData && (
        <div style={styles.dialogOverlay}>
          <div style={{ ...styles.dialogBox, width: "80%", maxWidth: 900 }}>
            <div style={{ marginTop: 10 }}>
              <QuotationPreview
                data={previewQuotationData}
                onClose={closeQuotationPreview}
                onSaveQuotation={saveQuotationToFirestore}
              />
            </div>
          </div>
        </div>
      )}

      <MassUpdateDialog
        open={showMassUpdate}
        rowCount={selectedDealIds.length}
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
        onApply={applyMassUpdateDeals}
        onClose={() => setShowMassUpdate(false)}
        loading={isMassUpdating}
      />
    </div>
  );
}

/* ---------------------------
   Styles (unchanged)
   --------------------------- */
const styles = {
container: {
  display: "flex",
  minHeight: "100vh",      // ✅ allow content to grow
  width: "100%",
  fontFamily: "Poppins, sans-serif",
  background: "#fff",
  overflowX: "hidden",     // prevent horizontal scroll
},
sidebar: {
  backgroundColor: "#800000",
  color: "#fff",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  boxSizing: "border-box",
},
  sidebarTitle: { fontWeight: "bold", fontSize: 18 },
  searchInput: { padding: 8, borderRadius: 6, border: "none", outline: "none" },
  label: { marginTop: 10 },
  dropdown: { padding: 8, borderRadius: 6 },
main: {
  flex: 1,
  padding: 16,
  minWidth: 0,
  overflowY: "auto",
  overflowX: "hidden",
  minHeight: 0,            // ⭐ ADD THIS (VERY IMPORTANT)
  WebkitOverflowScrolling: "touch",
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
  },
  header: { color: "#800000", fontSize: 24, fontWeight: "bold", margin: 0 },
  headerSub: {
    marginTop: 4,
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

  dropdownMenu: {
    position: "absolute",
    top: "120%",
    right: 0,
    background: "linear-gradient(180deg, #ffffff 0%, #fff9f9 100%)",
    border: "1px solid rgba(128,0,0,0.16)",
    boxShadow: "0 14px 30px rgba(77, 12, 12, 0.18)",
    borderRadius: 14,
    padding: 12,
    zIndex: 10000,
    minWidth: 280,
    width: 320,
  },
  dropdownHeaderWrap: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: "1px solid rgba(128,0,0,0.12)",
  },
  dropdownTitle: {
    fontWeight: 800,
    color: "#7a0011",
    fontSize: 18,
    lineHeight: 1.2,
  },
  dropdownSubtitle: {
    color: "#9a3a3a",
    fontSize: 12,
    marginTop: 2,
  },
  dropdownList: {
    maxHeight: "52vh",
    overflowY: "auto",
    paddingRight: 4,
  },
  dropdownSectionTitle: {
    marginTop: 8,
    marginBottom: 6,
    fontWeight: 800,
    color: "#800000",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  dropdownItem: {
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
  dropdownCheck: {
    accentColor: "#800000",
    width: 16,
    height: 16,
    cursor: "pointer",
  },
  dropdownActions: {
    display: "flex",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(128,0,0,0.12)",
  },

tableWrapper: {
  width: "100%",
  maxHeight: "60vh",        // ⭐ FIXED HEIGHT
  overflowY: "auto",        // ⭐ VERTICAL SCROLL HERE
  overflowX: "auto",
  borderRadius: 12,
  border: "1px solid rgba(128,0,0,0.12)",
  boxShadow: "0 8px 20px rgba(128,0,0,0.06)",
  position: "relative",
  zIndex: 1,
  WebkitOverflowScrolling: "touch",
},
  table: {
    width: "100%",
    minWidth: "1200px",
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
td: {
  padding: "12px 10px",
  fontSize: 13,
  color: "#333",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 180,
},

tr: {
  borderBottom: "1px solid #eee",
  height: 38,
  cursor: "pointer",
},

  attachBtn: {
    background: "#fff",
    border: "1px solid #800000",
    color: "#800000",
    borderRadius: 6,
    padding: "4px 8px",
    cursor: "pointer",
    fontWeight: 500,
  },

  quotationBtn: {
    background: "#800000",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
    fontWeight: 600,
    marginRight: 8,
  },

  previewBtn: {
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
    fontWeight: 600,
  },

pagination: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 20,
  paddingBottom: 20,   // ✅ ADD THIS
  color: "#800000",
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

  pageBtn: {
    background: "#fff",
    border: "1px solid #800000",
    color: "#800000",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    marginLeft: 6,
    fontWeight: 600,
  },

  columnHeaderBtn: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "#fff",
    borderRadius: 6,
    padding: "2px 6px",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  },

  menuBtn: {
    background: "#fff",
    border: "1px solid rgba(128,0,0,0.12)",
    color: "#800000",
    fontWeight: 700,
    cursor: "pointer",
    borderRadius: 8,
    padding: "7px 9px",
    fontSize: 13,
  },

  menuAction: {
    width: "100%",
    textAlign: "left",
    padding: "7px 9px",
    borderRadius: 8,
    border: "1px solid rgba(128,0,0,0.12)",
    background: "#fff",
    cursor: "pointer",
    color: "#800000",
    fontWeight: 700,
    fontSize: 13,
  },

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
    zIndex: 2000,
  },

  dialogBox: {
    background: "#fff",
    padding: 20,
    borderRadius: 8,
    width: 340,
    maxHeight: "80vh",
    overflowY: "auto",
    boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
  },

  radioLabel: { display: "block", marginTop: 6 },

  dialogButtons: {
    marginTop: 16,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },

  addBtn: {
    backgroundColor: "#800000",
    color: "#fff",
    border: "none",
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    flex: 1,
    fontWeight: "bold",
  },

  cancelBtn: {
    backgroundColor: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    flex: 1,
    fontWeight: "bold",
  },
};

// small helper for pretty label (same as other files)
function prettyLabel(name) {
  if (!name) return "";
  return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
