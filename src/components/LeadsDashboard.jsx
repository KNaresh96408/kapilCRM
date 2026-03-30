// src/components/LeadsDashboard.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, serverTimestamp, writeBatch, query, orderBy } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { fetchCollectionDocs, getDocsWithFallback, fetchPagedDocs } from "../helpers/firestoreFetch";
import * as XLSX from "xlsx";
import LeadDrawer from "./LeadDrawer";
import MassUpdateDialog from "./Universal/MassUpdateDialog";
import { useLocation, useNavigate } from "react-router-dom";
import { usePermission } from "../hooks/usePermission";
import { getScopedQuery } from "../helpers/getScopedQuery";
import {
  getUserNameByEmailMap,
  importRowsToCollection,
  isAdminSessionUser,
  parseExcelRows,
} from "../helpers/bulkImport";

const toJSDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};


const DEFAULT_COLUMNS = [
  { key: "autoId", label: "KPI ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "state", label: "State" },
  { key: "sales_zone", label: "Sales Zone" },
  { key: "sales_area", label: "Sales Area" },
  { key: "zonal_manager", label: "Zonal Manager" },
  { key: "source", label: "Lead Source" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location" },
  { key: "teleSale", label: "Tele-Sales" },
  { key: "consultantName", label: "Consultant" },
  { key: "assignedConsultant", label: "Assigned Consultant" },
  { key: "projectType", label: "Project Type" },
  { key: "status", label: "Status" },
  { key: "siteVisitArranged", label: "Site Visit Arranged" },
  { key: "createdAt", label: "Created At" },
  { key: "state_label", label: "State Label" },
  { key: "sales_zone_label", label: "Sales Zone Label" },
  { key: "sales_area_label", label: "Sales Area Label" },

  // ⭐ NEW HIDDEN BY DEFAULT COLUMNS
  { key: "locationLink", label: "Location Link" },
  { key: "updatedBy", label: "Updated By" },
  { key: "createdBy", label: "Created By" },
  { key: "ownerUid", label: "Owner UID" },
  { key: "updatedAt", label: "Updated At" },
];

const MASS_UPDATE_FIELDS = DEFAULT_COLUMNS.filter(
  (c) => !["autoId", "createdAt", "updatedAt", "updatedBy", "ownerUid", "createdBy"].includes(c.key)
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
const NUMERIC_FILTER_KEYS = new Set(["invoiceAmount", "paymentReceived", "pendingPayment", "paymentPercentage", "capacity", "expectedRevenue"]);

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

const prettyLabel = (name) =>
  name
    ? name
        .toString()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase())
    : "";

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

export default function LeadsDashboard() {

  const perm = usePermission("leads");   // ⭐ ADD THIS

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
        <p>You do not have permission to view Leads.</p>
      </div>
    );
  }

  return <LeadsDashboardInner perm={perm} />;
}

function LeadsDashboardInner({ perm }) {
  const location = useLocation();
  const navigate = useNavigate();
  const canOpenDrawer = !!perm.update;
  const isAdmin = isAdminSessionUser();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef(null);
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [isMassUpdating, setIsMassUpdating] = useState(false);
  const [showMassUpdate, setShowMassUpdate] = useState(false);
  const [massField, setMassField] = useState("assignedConsultant");
  const [massValue, setMassValue] = useState("");
  const [massInput, setMassInput] = useState("");
  const [massUserOptions, setMassUserOptions] = useState([]);


 const HIDE_BY_DEFAULT = [
  "email",
  "assignedConsultant",
  "locationLink",
  "updatedBy",
  "createdBy",
  "ownerUid",
  "updatedAt",
  "state_label",
  "sales_zone_label",
  "sales_area_label",
];

const [visibleColumns, setVisibleColumns] = useState(
  DEFAULT_COLUMNS
    .map((c) => c.key)
    .filter((key) => !HIDE_BY_DEFAULT.includes(key))
);
const DYNAMIC_HIDE_BY_DEFAULT = ["state_label", "sales_zone_label", "sales_area_label"];
const deletedFieldKeys =
  leads.length > 0 && leads[0].deletedFields
    ? Object.keys(leads[0].deletedFields)
    : [];
  const [filters, setFilters] = useState({});
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 120, left: 40 }); // Dynamic menu position
  const [showManageCols, setShowManageCols] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    fieldType: "selected",
    dataType: "filtered",
  });
  const [pinnedColumns, setPinnedColumns] = useState([]);
  const menuRef = useRef(null);
  const manageRef = useRef(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const MAX_ROWS = 1000;
  const fetchInFlightRef = useRef(false);
  const PAGE_SIZE = 200;
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  // ✅ Fetch Leads
  const fetchLeads = async (reset = false) => {
  if (fetchInFlightRef.current) return;
  fetchInFlightRef.current = true;
  setLoading(true);
  try {
    // 🔥 build role-based query
    const q = await getScopedQuery("leads");

    const baseQuery = q?._query ? q : query(q, orderBy("createdAt", "desc"));
    const { docs, lastDoc: nextLast } = await fetchPagedDocs(baseQuery, "leads", {
      limitCount: PAGE_SIZE,
      startAfterDoc: reset ? null : lastDoc,
      cacheMs: 30000,
    });

    const data = (docs || []).map((doc, idx) => {
      const d = doc.data || doc;
      return {
        ...d,
        id: normalizeDocId(doc.id || doc.docId || doc.name || ""),
        autoId:
          d.autoId ||
          d.kpiId ||
          d.kpi_id ||
          d.manualKpiId ||
          d.manual_kpi_id ||
          `KPI-${String(idx + 1).padStart(3, "0")}`,
        state: pickScopedDisplay(d.state, d.state_label),
        sales_zone: pickScopedDisplay(d.sales_zone, d.sales_zone_label),
        sales_area: pickScopedDisplay(d.sales_area, d.sales_area_label),
        zonal_manager: d.zonal_manager || d.zonalManager || "",
      };
    });

    data.sort((a, b) => {
      const at = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bt = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bt - at;
    });

    const uniqueById = new Map();
    data.forEach((d) => {
      if (d?.id) uniqueById.set(d.id, d);
    });

    setLeads((prev) => {
      if (reset) {
        return Array.from(uniqueById.values()).slice(0, MAX_ROWS);
      }
      const merged = new Map();
      prev.forEach((d) => {
        if (d?.id) merged.set(d.id, d);
      });
      uniqueById.forEach((value, key) => {
        merged.set(key, value);
      });
      return Array.from(merged.values()).slice(0, MAX_ROWS);
    });
    setLastDoc(nextLast || null);
    setHasMore((docs || []).length === PAGE_SIZE);
  } catch (err) {
    console.error("Error fetching leads:", err);
    setLeads([]);
  } finally {
    setLoading(false);
    fetchInFlightRef.current = false;
  }
};

// 1️⃣ First useEffect → fetch leads
useEffect(() => {
  const isVisible = () => !document.hidden;
  if (isVisible()) fetchLeads(true);

  const timer = setInterval(() => {
    if (isVisible()) fetchLeads(true);
  }, 60 * 1000);

  const onVisible = () => {
    if (isVisible()) fetchLeads(true);
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}, []);

// 2️⃣ Second useEffect → auto open drawer
// 2️⃣ Second useEffect → auto open drawer (safe: only when on /leads)
// auto open drawer — only when on /leads
useEffect(() => {
  // adjust this exact check to match your route,
  // e.g. if route is "/app/leads" use location.pathname.includes("/app/leads")
  if (!location.pathname || !location.pathname.includes("/leads")) return;
  if (!canOpenDrawer) return;

  const params = new URLSearchParams(location.search);
  const openId = params.get("open");
  if (!openId) return;
  if (leads.length === 0) return;

  const match = leads.find((l) => l.id === openId || l.autoId === openId);
  if (match) {
    setSelectedLead(match);
    setIsDrawerOpen(true);

    // CLEANUP: remove the open param so other pages won't react
    params.delete("open");
    const newSearch = params.toString();
    navigate({
      pathname: location.pathname,
      search: newSearch ? `?${newSearch}` : ""
    }, { replace: true });
  }
}, [location.pathname, location.search, leads, navigate, canOpenDrawer]);

// 3️⃣ Third useEffect → close menus
useEffect(() => {
  const handler = (e) => {
    const insideMenu = menuRef.current?.contains(e.target);
    const insideManage = manageRef.current?.contains(e.target);
    const typing =
      e.target.tagName === "INPUT" || e.target.tagName === "SELECT";

    if (insideMenu && typing) return;
    if (!insideMenu && !insideManage) {
      setOpenMenuFor(null);
      setShowManageCols(false);
    }
  };

  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, []);

  // ✅ Filtering, sorting, pagination
const filteredLeads = leads.filter((lead) => {
  const q = searchTerm.trim().toLowerCase();

  const matchSearch =
    !q ||
    (lead.autoId || "").toString().toLowerCase().includes(q) ||
    (lead.kpiId || "").toString().toLowerCase().includes(q) ||
    (lead.name || "").toString().toLowerCase().includes(q) ||
    (lead.email || "").toString().toLowerCase().includes(q) ||
    (lead.phone || "").toString().includes(q);

  const matchStatus =
    statusFilter === "all" || lead.status === statusFilter;

  const matchColumnFilters = Object.keys(filters).every((key) => {
    const token = String(filters[key] || "").trim();
    if (!token) return true;
    const parsedNumeric = parseNumericFilterToken(token);
    if (parsedNumeric) {
      return runNumericFilter(lead[key], parsedNumeric);
    }
    const target = normalizeFilterComparable(lead[key], key);
    const normalizedToken = normalizeFilterComparable(token, key);
    return target.includes(normalizedToken);
  });

  return matchSearch && matchStatus && matchColumnFilters;
});

  const sortedLeads = [...filteredLeads].sort((a, b) => {
    const av = a[sort.key]?.toDate?.() ?? a[sort.key] ?? "";
    const bv = b[sort.key]?.toDate?.() ?? b[sort.key] ?? "";
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedLeads.length / perPage);
  const startIdx = (page - 1) * perPage;
  const pagedLeads = sortedLeads.slice(startIdx, startIdx + perPage);

  const toggleSelectLead = (id) => {
    const normalizedId = normalizeDocId(id);
    if (!normalizedId) return;
    setSelectedLeadIds((prev) =>
      prev.includes(normalizedId)
        ? prev.filter((v) => v !== normalizedId)
        : [...prev, normalizedId]
    );
  };

  const toggleSelectAllPagedLeads = () => {
    const ids = pagedLeads.map((l) => normalizeDocId(l.id)).filter(Boolean);
    if (!ids.length) return;

    setSelectedLeadIds((prev) => {
      const allSelected = ids.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !ids.includes(id));
      return Array.from(new Set([...prev, ...ids]));
    });
  };

  const handleMassUpdateLeads = async () => {
    if (!isAdmin) return;
    if (!selectedLeadIds.length) {
      alert("Select at least one lead.");
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
        console.warn("Failed loading users for leads mass update", e?.message || e);
      }
    })();

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const applyMassUpdateLeads = async () => {
    if (!isAdmin) {
      alert("Only admin can perform mass update.");
      return;
    }

    const fieldName = String(massField || "").trim();
    const fieldValue = String(massValue || "").trim();
    if (!fieldName) return alert("Select a field.");
    if (!fieldValue) return alert("Enter value.");

    const validIds = new Set(leads.map((l) => normalizeDocId(l.id)).filter(Boolean));
    const idsToUpdate = selectedLeadIds
      .map((id) => normalizeDocId(id))
      .filter((id) => id && validIds.has(id));

    if (!idsToUpdate.length) {
      alert("No valid leads selected.");
      return;
    }

    setIsMassUpdating(true);
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : {};

      const batch = writeBatch(db);
      idsToUpdate.forEach((id) => {
        batch.update(doc(db, "leads", id), {
          [fieldName]: fieldValue,
          updatedAt: serverTimestamp(),
          updatedBy: parsed?.email || "admin",
        });
      });

      await batch.commit();
      await fetchLeads(true);
      setSelectedLeadIds([]);
      setShowMassUpdate(false);
      alert(`✅ Updated ${idsToUpdate.length} lead record(s).`);
    } catch (e) {
      console.error("Mass update failed", e);
      alert("Mass update failed.");
    } finally {
      setIsMassUpdating(false);
    }
  };

  // ✅ Export Excel
  const handleExportExcel = () => {
    setShowExportDialog(false);
    const exportAll = exportOptions.dataType === "all";
    const useAllFields = exportOptions.fieldType === "all";
    let dataToExport = exportAll ? leads : filteredLeads;
    if (dataToExport.length === 0) {
      alert("⚠️ No leads to export!");
      return;
    }
    const exportCols = useAllFields
      ? DEFAULT_COLUMNS
      : DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key));
    const exportData = dataToExport.map((lead) => {
      const row = {};
      exportCols.forEach((col) => {
        let val = lead[col.key];
        if (col.key === "createdAt" && lead.createdAt?.toDate) {
          val = lead.createdAt.toDate().toLocaleDateString("en-GB");
        }
        row[col.label] = val ?? "";
      });
      return row;
    });
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
    const today = new Date().toISOString().split("T")[0];
    XLSX.writeFile(workbook, `Leads_Export_${today}.xlsx`);
  };

  const ExportDialog = () => (
    <div style={styles.dialogOverlay}>
      <div style={styles.dialogBox}>
        <h3 style={{ color: "#800000" }}>📤 Export Leads</h3>
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
            All Fields
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <b>Leads to Export</b>
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
            Current Leads (Filtered)
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
            All Leads
          </label>
        </div>
        <div style={styles.dialogButtons}>
          <button style={styles.addBtn} onClick={handleExportExcel}>
            Export Now
          </button>
          <button
            style={styles.cancelBtn}
            onClick={() => setShowExportDialog(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  // ✅ Enhanced Column Menu (appears on right side, aligned with clicked header)
  const ColumnMenu = ({ columnKey }) => {
    const curFilter = String(filters[columnKey] ?? "");
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
      const rawValues = leads
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
          ⬆ Asc
        </button>

        <button
          style={styles.menuItem}
          onClick={() => {
            setSort({ key: columnKey, dir: "desc" });
            setOpenMenuFor(null);
          }}
        >
          ⬇ Desc
        </button>

        <button
          style={styles.menuItem}
          onClick={() => {
            setPinnedColumns((prev) =>
              prev.includes(columnKey)
                ? prev.filter((p) => p !== columnKey)
                : [...prev, columnKey]
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
                  setFilters({ ...filters, [columnKey]: "" });
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
                autoFocus
                type="number"
                value={draftNum}
                onChange={(e) => setDraftNum(e.target.value)}
                placeholder="Value"
                style={{ ...styles.filterInput, flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = Number(draftNum);
                    setFilters({
                      ...filters,
                      [columnKey]: Number.isFinite(n) ? `__num__:${draftOp}:${n}` : "",
                    });
                    setOpenMenuFor(null);
                  }
                }}
              />
            </div>
          ) : (
            <div style={{ position: "relative", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minWidth: 0 }}>
                <input
                  autoFocus
                  type="text"
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
                      setFilters({ ...filters, [columnKey]: draftFilter.trim() });
                      setOpenMenuFor(null);
                    }
                  }}
                />
                {draftFilter && (
                  <button
                    onClick={() => setDraftFilter("")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#800000",
                      cursor: "pointer",
                      fontSize: 16,
                      padding: 0,
                    }}
                    title="Clear Filter"
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
                        setFilters({ ...filters, [columnKey]: opt });
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
                  setFilters({
                    ...filters,
                    [columnKey]: Number.isFinite(n) ? `__num__:${draftOp}:${n}` : "",
                  });
                } else {
                  setFilters({ ...filters, [columnKey]: draftFilter.trim() });
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
          style={{
            ...styles.menuItem,
            borderTop: "1px solid #eee",
            marginTop: 6,
          }}
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

  const visibleCols = [
    ...pinnedColumns
      .filter((c) => visibleColumns.includes(c))
      .map((key) => DEFAULT_COLUMNS.find((col) => col.key === key)),
    ...DEFAULT_COLUMNS.filter(
      (c) => visibleColumns.includes(c.key) && !pinnedColumns.includes(c.key)
    ),
  ];

  // ---------- START: TABLE HEADER & ROW RENDERING (DYNAMIC APPEND) ----------
  // We'll append dynamic columns (fields found on lead objects but not in DEFAULT_COLUMNS)
// ---------- START: DYNAMIC TABLE COLUMNS ----------
// collect keys present in current loaded leads
const allLeadKeys = React.useMemo(() => {
  const keys = new Set();
  leads.forEach((l) => {
    Object.keys(l || {}).forEach((k) => keys.add(k));
  });
  return Array.from(keys);
}, [leads]);

// default keys set
const defaultKeysSet = new Set(DEFAULT_COLUMNS.map((c) => c.key));

// dynamic keys: keys not part of default columns
const dynamicKeys = allLeadKeys.filter(
  (k) =>
    !defaultKeysSet.has(k) &&
    k !== "id" &&
    k !== "_systemDelete" &&
    k !== "singleLine" &&
    k !== "single_line" &&   // ⭐ FIRESTORE version
    !deletedFieldKeys.includes(k)   // ⭐ Auto-remove deleted fields
);


// convert dynamic keys to same column shape {key,label}
const dynamicCols = dynamicKeys.map((k) => ({
  key: k,
  label: prettyLabel(k),
}));

useEffect(() => {
  if (!dynamicCols.length) return;
  setVisibleColumns((prev) => {
    const next = [...prev];
    dynamicCols.forEach((col) => {
      const hideByDefault =
        DYNAMIC_HIDE_BY_DEFAULT.includes(col.key) ||
        col.key.endsWith("_label");
      if (!next.includes(col.key) && !hideByDefault) {
        next.push(col.key);
      }
    });
    return next;
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [dynamicCols.length]);

const sortByPinned = (cols) =>
  [...cols].sort((a, b) => {
    const aPinned = pinnedColumns.includes(a.key) ? 0 : 1;
    const bPinned = pinnedColumns.includes(b.key) ? 0 : 1;
    return aPinned - bPinned;
  });

const scopeTailKeys = ["sales_area", "sales_zone", "state", "zonal_manager"];
const allVisibleCols = [
  ...DEFAULT_COLUMNS.filter((col) => visibleColumns.includes(col.key)),
  ...dynamicCols.filter((col) => visibleColumns.includes(col.key)),
];
const nonScopeCols = allVisibleCols.filter((col) => !scopeTailKeys.includes(col.key));
const scopeTailCols = allVisibleCols.filter((col) => scopeTailKeys.includes(col.key));
const finalCols = [...sortByPinned(nonScopeCols), ...sortByPinned(scopeTailCols)];
// ---------- END: DYNAMIC TABLE COLUMNS ----------

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
        collectionName: "leads",
        rows,
        preferDocIdKeys: ["autoId", "kpiId", "id"],
        userMeta: {
          uid: parsed?.uid || parsed?.id || "",
          email: parsed?.email || "",
        },
        transformRow: (row) => {
          const assignedEmail = String(row.assignedConsultant || "").trim().toLowerCase();
          return {
            ...row,
            name: row.name || row.customerName || "",
            consultantName: row.consultantName || emailNameMap[assignedEmail] || "",
          };
        },
      });

      await fetchLeads(true);
      alert(`✅ Imported ${result.imported} lead records.`);
    } catch (err) {
      console.error("Lead import failed", err);
      alert("Import failed. Please check file format.");
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

  // ---------- END: TABLE HEADER & ROW RENDERING ----------
  
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
    boxSizing: "border-box",
  }}
>
        <h3 style={styles.sidebarTitle}>Filter Leads</h3>
        <input
          type="text"
          placeholder="Search by name, phone, email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
        <label style={styles.label}>Status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={styles.dropdown}
        >
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="in_progress">In Progress</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </div>

{/* Main Content */}
<div style={styles.mainContent}>
  <div style={styles.headerCard}>
    <div style={styles.headerRow}>
      <div>
        <h2 style={styles.header}>Leads Pipeline</h2>
        <div style={styles.headerSub}>Track and manage incoming leads with quick actions</div>
      </div>

    {/* BUTTONS ROW */}
    <div style={styles.toolbarWrap}>

      {isAdmin && (
        <button
          style={styles.exportBtn}
          onClick={handleMassUpdateLeads}
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

      {/* ⭐ CREATE LEAD BUTTON MOVED TO TOP */}
      {perm.create && (
  <button
    style={styles.exportBtn}
    onClick={() => {
      setSelectedLead(null);
      setIsDrawerOpen(true);
    }}
  >
    + Create Lead
  </button>
)}

      {/* EXPORT */}
      <button
        style={styles.exportBtn}
        onClick={() => setShowExportDialog(true)}
      >
        📤 Export Excel
      </button>

      {/* MANAGE COLUMNS */}
      <div style={{ position: "relative" }}>
        <button
          style={styles.manageBtn}
          onClick={() => setShowManageCols(!showManageCols)}
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
                        : setVisibleColumns((prev) => prev.filter((c) => c !== col.key))
                    }
                  />
                  <span>{col.label}</span>
                </label>
              ))}

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
                            : setVisibleColumns((prev) => prev.filter((c) => c !== col.key))
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
                onClick={() =>
                  setVisibleColumns([
                    ...DEFAULT_COLUMNS.map((c) => c.key),
                    ...dynamicCols.map((c) => c.key),
                  ])
                }
                style={{ ...styles.addBtn, flex: 1, borderRadius: 10 }}
              >
                Unhide All
              </button>
              <button
                onClick={() => setShowManageCols(false)}
                style={{ ...styles.cancelBtn, flex: 1, borderRadius: 10 }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  </div>

        {loading ? (
          <p style={{ color: "#800000" }}>Loading leads...</p>
        ) : pagedLeads.length === 0 ? (
          <div style={styles.emptyStateCard}>
            <div style={styles.emptyStateTitle}>No Leads Found</div>
            <div style={styles.emptyStateText}>Try changing filters or search keywords.</div>
          </div>
        ) : (
          <>
 <div style={{ width: "100%", minWidth: 0 }}>
  <div style={styles.tableWrapper}>
    <table style={styles.table}>
      <thead>
        <tr>
          {isAdmin && (
            <th style={styles.th}>
              <input
                type="checkbox"
                checked={pagedLeads.length > 0 && pagedLeads.every((l) => selectedLeadIds.includes(normalizeDocId(l.id)))}
                onChange={toggleSelectAllPagedLeads}
              />
            </th>
          )}
          {finalCols.map((col) => (
            <th key={col.key} style={styles.th}>
              <div style={styles.headerCell}>
                <span>{col.label}</span>
                <button
                  style={styles.iconButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenuPos({ top: rect.bottom + 6, left: rect.left });
                    setOpenMenuFor(
                      openMenuFor === col.key ? null : col.key
                    );
                  }}
                >
                  ≡
                </button>
                {openMenuFor === col.key && (
                  <ColumnMenu columnKey={col.key} />
                )}
              </div>
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {pagedLeads.map((lead) => (
          <tr
            key={lead.id}
            style={{ ...styles.tr, cursor: canOpenDrawer ? "pointer" : "default" }}
            onClick={() => {
              if (!canOpenDrawer) return;
              setSelectedLead(lead);
              setIsDrawerOpen(true);
            }}
          >
            {isAdmin && (
              <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedLeadIds.includes(normalizeDocId(lead.id))}
                  onChange={() => toggleSelectLead(lead.id)}
                />
              </td>
            )}
            {finalCols.map((col) => (
              <td key={col.key} style={styles.td}>
                {(() => {
                  const value = lead[col.key];

                  if (!value) return "";

                  // Use safe date parser for all date formats
                  const jsDate = toJSDate(value);
                  if (jsDate) return jsDate.toLocaleDateString("en-GB");

                  if (Array.isArray(value)) return value.join(", ");

                  if (typeof value === "object") {
                    if (value.label) return value.label;
                    if (value.name) return value.name;
                    try {
                      return JSON.stringify(value);
                    } catch {
                      return "";
                    }
                  }

                  return value;
                })()}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  </div>

  {/* Pagination */}
  <div style={styles.pagination}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span>
        {startIdx + 1}–
        {Math.min(startIdx + perPage, sortedLeads.length)} of{" "}
        {sortedLeads.length}
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
          onClick={() => fetchLeads(false)}
          style={styles.pageBtn}
        >
          Load more
        </button>
      )}
    </div>
  </div>
          </>
        )}
      </div>

      {isDrawerOpen && (
  <LeadDrawer
    onClose={() => {
      setIsDrawerOpen(false);
      setSelectedLead(null);
    }}
    onLeadAdded={() => fetchLeads(true)}
    existingLead={selectedLead}
    refreshLeads={() => fetchLeads(true)}   // 👈 ADD THIS LINE
  />
)}
      {showExportDialog && <ExportDialog />}

      <MassUpdateDialog
        open={showMassUpdate}
        rowCount={selectedLeadIds.length}
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
        onApply={applyMassUpdateLeads}
        onClose={() => setShowMassUpdate(false)}
        loading={isMassUpdating}
      />
    </div>
  );
}

/* 🎨 Styles */
const styles = {
  container: {
    display: "flex",
    height: "100%",
    minHeight: 0,
    fontFamily: "Poppins, sans-serif",
    backgroundColor: "#fff",
    width: "100%",
    overflowX: "hidden",
    overflowY: "hidden",
  },
sidebar: {
  backgroundColor: "#800000",
  color: "#fff",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  position: "relative",
  boxSizing: "border-box",
},
  sidebarTitle: { fontWeight: "bold", fontSize: 18 },
  searchInput: { padding: 8, borderRadius: 6, border: "none" },
  label: { marginTop: 10, fontSize: 14, color: "#fff" },
  dropdown: { padding: 8, borderRadius: 6, border: "none" },
 createButton: {
  position: "absolute",
  bottom: "20px",
  left: "20px",
  right: "20px",
  backgroundColor: "#fff",
  color: "#800000",
  border: "none",
  borderRadius: 8,
  padding: "12px",
  fontWeight: "bold",
  cursor: "pointer",
  textAlign: "center",
  width: "auto",
},

mainContent: {
  flex: 1,
  padding: isMobile ? "12px" : "20px",
  overflowX: "hidden",
  overflowY: "hidden",
  minWidth: 0,
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
    marginBottom: 0,
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
 maxHeight: "65vh",
overflowX: "auto", // ⭐ only table scrolls horizontally
  overflowY: "auto",
},
table: {
  width: "max-content",  // ⭐ Auto-expand when many columns exist
  minWidth: "100%",
  borderCollapse: "collapse",
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
  padding: "10px",
  fontSize: "13px",
  color: "#333",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  overflow: "hidden",
  maxWidth: "180px",   // ⭐ Prevents breaking UI
},
  tr: {
    borderBottom: "1px solid #eee",
  },
  headerCell: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "relative",
  },
  iconButton: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.25)",
    color: "#fff",
    fontSize: 14,
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
  },
  menu: {
    background: "linear-gradient(180deg, #ffffff 0%, #fff8f8 100%)",
    border: "1px solid rgba(128,0,0,0.18)",
    boxShadow: "0 16px 28px rgba(77,12,12,0.18)",
    width: 220,
    borderRadius: 10,
    zIndex: 12000,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
    maxHeight: "70vh",
    overflowY: "auto",
  },
  menuItem: {
    background: "#fff",
    border: "1px solid rgba(128,0,0,0.12)",
    textAlign: "left",
    padding: "7px 9px",
    cursor: "pointer",
    color: "#800000",
    fontWeight: 700,
    borderRadius: 8,
    fontSize: 13,
  },
  filterGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 2px",
    borderTop: "1px solid rgba(128,0,0,0.1)",
    borderBottom: "1px solid rgba(128,0,0,0.1)",
  },
  filterLabel: {
    fontSize: 12,
    color: "#800000",
    opacity: 0.9,
    fontWeight: 700,
  },
  filterInput: {
    border: "1px solid rgba(128,0,0,0.24)",
    borderRadius: 6,
    padding: 7,
    fontSize: 13,
    color: "#800000",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    minWidth: 0,
  },
  pagination: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    color: "#800000",
  },
  pageBtn: {
    background: "#fff",
    border: "1px solid #800000",
    color: "#800000",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    transition: "all 0.2s ease",
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
    width: 320,
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  },
  radioLabel: {
    display: "block",
    marginTop: 6,
    color: "#333",
    fontSize: 14,
  },
  dialogButtons: {
    marginTop: 16,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  addBtn: {
    flex: 1,
    backgroundColor: "#800000",
    color: "#fff",
    border: "none",
    padding: "8px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    padding: "8px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
  },
};

// ✅ Optional hover effects
Object.assign(styles.pageBtn, {
  ":hover": {
    background: "#800000",
    color: "#fff",
  },
});
Object.assign(styles.exportBtn, {
  ":hover": {
    background: "#800000",
    color: "#fff",
  },
});
Object.assign(styles.manageBtn, {
  ":hover": {
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
  },
});
