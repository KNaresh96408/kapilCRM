import React, { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { onSnapshot } from "firebase/firestore";
import ProjectDrawer from "../components/ProjectDrawer";
import MassUpdateDialog from "../components/Universal/MassUpdateDialog";
import { useLocation } from "react-router-dom";
import { usePermission } from "../hooks/usePermission";
import { getScopedQuery } from "../helpers/getScopedQuery";
import { fetchCollectionDocs, getDocsWithFallback, fetchPagedDocs } from "../helpers/firestoreFetch";
import {
  getUserNameByEmailMap,
  importRowsToCollection,
  isAdminSessionUser,
  parseExcelRows,
} from "../helpers/bulkImport";

/**
 * ProjectsDashboard.jsx
        </div>
 *
 * Projects collection UI:
 * - Left sidebar filters
 * - Manage Columns / Export
 * - Table with per-column menu (sort / pin / hide)
 * - Click row opens ProjectDrawer to edit + persist
 *
 * Final columns (order):
 * kpiId, name, phone, address, zone, state, capacity, invoiceAmount,
 * sixtyPercentReceivedDate, dispatchDelayDays, dispatchStatus, dispatchDate,
 * installationDelayDays, installationStatus, installationDate,
 * netMeterDelayDays, netMeterStatus, netMeterDate,
 * nationalPortalStage, createdAt
 */

const DEFAULT_COLUMNS = [
  { key: "kpiId", label: "KPI ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "state", label: "State" },
  { key: "sales_zone", label: "Sales Zone" },
  { key: "sales_area", label: "Sales Area" },
  { key: "zonal_manager", label: "Zonal Manager" },
  { key: "teleSale", label: "Tele-Sales" },
  { key: "consultantName", label: "Consultant" },
  { key: "projectType", label: "Project Type" },
  { key: "capacity", label: "Capacity" },

  { key: "sixtyPercentDate", label: "60% Received Date" },

  { key: "dispatchDelayDays", label: "Dispatch Delay (days)" },
  { key: "dispatchStatus", label: "Dispatch Status" },
  { key: "dispatchDate", label: "Dispatch Date" },

  { key: "installationDelayDays", label: "Installation Delay (days)" },
  { key: "installationStatus", label: "Installation Status" },
  { key: "installationDate", label: "Installation Date" },

  { key: "netMeterDelayDays", label: "Net Meter Delay (days)" },
  { key: "netMeterStatus", label: "Net Meter Status" },
  { key: "netMeterDate", label: "Net Meter Date" },

  { key: "nationalPortalStage", label: "National Portal Stage" },
  { key: "createdAt", label: "Created At" },
  { key: "updatedAt", label: "Updated At" },
  { key: "updatedBy", label: "Updated By" },
];

const MASS_UPDATE_FIELDS = DEFAULT_COLUMNS.filter(
  (c) => !["kpiId", "createdAt", "updatedAt", "updatedBy"].includes(c.key)
);

function prettyLabel(name) {
  if (!name) return "";
  return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

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

function normalizeDocId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  return parts[parts.length - 1] || raw;
}

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
const NUMERIC_FILTER_KEYS = new Set([
  "invoiceAmount",
  "paymentReceived",
  "pendingPayment",
  "paymentPercentage",
  "capacity",
  "dispatchDelayDays",
  "installationDelayDays",
  "netMeterDelayDays",
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

export default function ProjectsDashboard() {
  const perm = usePermission("projects");

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
        <p>You do not have permission to view Projects.</p>
      </div>
    );
  }

  return <ProjectsDashboardInner perm={perm} />;
}

function ProjectsDashboardInner({ perm }) {
  // ---------------------------------------------------
  const location = useLocation();
  const canOpenDrawer = !!perm.update;
  const isAdmin = isAdminSessionUser();
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [isMassUpdating, setIsMassUpdating] = useState(false);
  const [showMassUpdate, setShowMassUpdate] = useState(false);
  const [massField, setMassField] = useState("consultantName");
  const [massValue, setMassValue] = useState("");
  const [massInput, setMassInput] = useState("");
  const [massUserOptions, setMassUserOptions] = useState([]);
  const MAX_ROWS = 1000;
  const fetchInFlightRef = useRef(false);
  const PAGE_SIZE = 200;
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  // table control
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  const [columnFilters, setColumnFilters] = useState({});

  // columns
  const [visibleColumns, setVisibleColumns] = useState(
  DEFAULT_COLUMNS
    .map((c) => c.key)
    .filter((k) => !["updatedAt", "updatedBy"].includes(k))
);

  const [pinnedColumns, setPinnedColumns] = useState([]);
  const [showManageCols, setShowManageCols] = useState(false);

  // column menu
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 140, left: 40 });
  const menuRef = useRef(null);
  const manageRef = useRef(null);

  // export dialog
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({ fieldType: "selected", dataType: "filtered" });

  // drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);

  // ---------- DYNAMIC FIELDS SUPPORT ----------
  const [fieldsDef, setFieldsDef] = useState([]); // array of {name,label,type,required,options,default}
  const [layoutDef, setLayoutDef] = useState([]);
  const [deletedFields, setDeletedFields] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ref = doc(db, "crm_fields", "projects");
        const snap = await getDocs(collection(db, "crm_fields")); // fallback to ensure connection
        // we'll try direct getDoc for doc(db,'crm_fields','projects') but use getDocs for older SDK compatibility
        try {
          const direct = await (async () => {
            // prefer getDoc for single doc
            const { getDoc } = await import("firebase/firestore");
            const refDoc = doc(db, "crm_fields", "projects");
            return await getDoc(refDoc);
          })();
          if (direct && direct.exists && direct.exists()) {
            const data = direct.data() || {};
            const deletedFields = data.deletedFields || {};
setDeletedFields(deletedFields);
            const defs = Array.isArray(data.fields) ? data.fields : [];
            const normalized = defs.map((f) =>
              typeof f === "string"
                ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [], default: "" }
                : { ...(f || {}), options: f.options || [], default: f.default ?? "" }
            );
            if (!mounted) return;
            setFieldsDef(normalized);
            setLayoutDef(Array.isArray(data.layout) ? data.layout : []);
            return;
          }
        } catch (err) {
          // ignore; we'll fallback to empty
        }

        // fallback: set empty
        if (!mounted) return;
        setFieldsDef([]);
        setLayoutDef([]);
      } catch (err) {
        console.error("Failed to load crm_fields/projects", err);
      }
    })();
    return () => (mounted = false);
  }, []);

  // ---------------------------
  // fetch projects and enrich with 60% date when missing
  // ---------------------------
  const fetchProjects = async (reset = false) => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    setLoading(true);
    try {
      const baseRef = await getScopedQuery("projects");

      const q = query(baseRef, orderBy("createdAt", "desc"));
      const { docs, lastDoc: nextLast } = await fetchPagedDocs(q, "projects", {
        limitCount: PAGE_SIZE,
        startAfterDoc: reset ? null : lastDoc,
        cacheMs: 30000,
      });
      let list = (docs || []).map((d) => ({
        ...(d.data || d),
        id: normalizeDocId(d.id || d.docId || d.name || ""),
      }));

      // For projects with no sixtyPercentReceivedDate, try to fetch from salesOrders
      // For projects with missing fields, fetch from salesOrders
      const needsFetch = list.filter(
        (p) =>
          p.kpiId &&
          (
            !p.sixtyPercentReceivedDate ||
            !p.sales_zone ||
            !p.state ||
            !p.sales_area ||
            !p.zonal_manager
          )
      );

      if (needsFetch.length > 0) {
        const soDocs = await fetchCollectionDocs("salesOrders", 2500, 30000, MAX_ROWS);

        const soMap = {};
        for (const s of soDocs) {
          if (!s.kpiId) continue;
          soMap[s.kpiId] = s;
        }

        list = list.map((p) => {
          if (!p.kpiId || !soMap[p.kpiId]) return p;

          const so = soMap[p.kpiId];
          const sixtyDate =
            p.sixtyPercentDate ||
            p.sixtyPercentReceivedDate ||
            so.sixtyPercentDate ||
            so.sixtyPercentReceivedDate ||
            null;

          return {
            ...p,
            sixtyPercentDate: sixtyDate,
            sixtyPercentReceivedDate: sixtyDate,
            projectType: p.projectType || so.projectType || "Residential",
            // ⭐ NEW FIELDS (only if missing — never overwrites)
            sales_zone:
              pickScopedDisplay(p.sales_zone, p.sales_zone_label) ||
              pickScopedDisplay(so.sales_zone, so.sales_zone_label) ||
              "",
            state:
              pickScopedDisplay(p.state, p.state_label) ||
              pickScopedDisplay(so.state, so.state_label) ||
              "",
            sales_area:
              pickScopedDisplay(p.sales_area, p.sales_area_label) ||
              pickScopedDisplay(so.sales_area, so.sales_area_label) ||
              "",
            zonal_manager: p.zonal_manager || so.zonal_manager || "",
            teleSale: sanitizeLegacyUserDisplay(p.teleSale || so.teleSale || ""),
            consultantName: sanitizeLegacyUserDisplay(p.consultantName || so.consultantName || ""),
          };
        });
      }

      const mapped = list.map((p) => ({
        ...p,
        sixtyPercentDate: p.sixtyPercentDate || p.sixtyPercentReceivedDate || null,
        teleSale: sanitizeLegacyUserDisplay(p.teleSale || ""),
        consultantName: sanitizeLegacyUserDisplay(p.consultantName || ""),
        state: pickScopedDisplay(p.state, p.state_label),
        sales_zone: pickScopedDisplay(p.sales_zone, p.sales_zone_label),
        sales_area: pickScopedDisplay(p.sales_area, p.sales_area_label),
        zonal_manager: p.zonal_manager || p.zonalManager || "",
      }));

      const uniqueById = new Map();
      mapped.forEach((p) => {
        if (p?.id) uniqueById.set(p.id, p);
      });

      setProjects((prev) => {
        if (reset) {
          return Array.from(uniqueById.values()).slice(0, MAX_ROWS);
        }
        const merged = new Map();
        prev.forEach((p) => {
          if (p?.id) merged.set(p.id, p);
        });
        uniqueById.forEach((value, key) => {
          merged.set(key, value);
        });
        return Array.from(merged.values()).slice(0, MAX_ROWS);
      });
      setLastDoc(nextLast || null);
      setHasMore((docs || []).length === PAGE_SIZE);
    } catch (err) {
      console.error("Error fetching projects:", err);
      setProjects([]);
    } finally {
      setLoading(false);
      fetchInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const isVisible = () => !document.hidden;
    if (isVisible()) fetchProjects(true);

    const timer = setInterval(() => {
      if (isVisible()) fetchProjects(true);
    }, 60 * 1000);

    const onVisible = () => {
      if (isVisible()) fetchProjects(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ⭐ Auto-open drawer from universal search (exactly like Leads/Deals/SO)
useEffect(() => {
  const params = new URLSearchParams(location.search);
  const openId = params.get("open");

  if (!canOpenDrawer) return;
  if (!openId) return;
  if (projects.length === 0) return;  // wait for load

  const openLower = openId.toLowerCase();

  const match = projects.find(
    (p) =>
      (p.kpiId && p.kpiId.toLowerCase() === openLower) ||
      p.id === openId
  );

  if (match) {
    setSelectedProject(match);
    setIsDrawerOpen(true);
  }
}, [location.search, projects, canOpenDrawer]);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "crm_fields", "projects"), () => {
      console.log("🔥 CRM fields updated — refreshing projects table...");
      fetchProjects(true);     // reload table data
      setFieldsDef([]);    // clear old metadata
      setLayoutDef([]);    // clear old layout
    });

  return () => unsub();
}, []);

  // outside click close menus
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

  // helpers: date formatting & days diff
  const formatDate = (v) => {
    if (!v) return "";
    if (v?.toDate && typeof v.toDate === "function") return v.toDate().toLocaleDateString("en-GB");
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-GB");
    return "";
  };

  const daysBetween = (a, b) => {
    if (!a || !b) return "";
    const da = a?.toDate ? a.toDate().getTime() : new Date(a).getTime();
    const db = b?.toDate ? b.toDate().getTime() : new Date(b).getTime();
    if (isNaN(da) || isNaN(db)) return "";
    const diff = Math.ceil((db - da) / (1000 * 60 * 60 * 24));
    return diff;
  };

  // Filtering & Sorting & Pagination
const filtered = projects.filter((p) => {
  const q = searchTerm.trim().toLowerCase();

  // -------------------------
  // 1️⃣ GLOBAL SEARCH MATCH
  // -------------------------
  const searchMatch =
    !q ||
    (p.name || "").toString().toLowerCase().includes(q) ||
    (p.phone || "").toString().toLowerCase().includes(q) ||
    (p.kpiId || "").toString().toLowerCase().includes(q) ||
    (p.address || "").toString().toLowerCase().includes(q);

  // -------------------------
  // 2️⃣ STATUS FILTER MATCH
  // -------------------------
  const statusMatch =
    statusFilter === "All" ||
    (p.status || "").toString().toLowerCase() === statusFilter.toLowerCase();

  // -------------------------
  // 3️⃣ COLUMN-WISE FILTER MATCH (NEW)
  // -------------------------
  const columnMatch = Object.entries(columnFilters).every(([col, val]) => {
    const token = String(val || "").trim();
    if (!token) return true;

    const parsedNumeric = parseNumericFilterToken(token);
    if (parsedNumeric) {
      return runNumericFilter(p[col], parsedNumeric);
    }

    const cell = normalizeFilterComparable(p[col], col);
    const normalizedToken = normalizeFilterComparable(token, col);
    return cell.includes(normalizedToken);
  });

  return searchMatch && statusMatch && columnMatch;
});

  const getComparable = (v) => {
    if (!v) return "";
    if (v?.toDate && typeof v.toDate === "function") return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return v;
    return v.toString().toLowerCase();
  };

  const sorted = [...filtered].sort((a, b) => {
    const A = getComparable(a[sort.key]);
    const B = getComparable(b[sort.key]);
    if (A < B) return sort.dir === "asc" ? -1 : 1;
    if (A > B) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const startIdx = (page - 1) * perPage;
  const paged = sorted.slice(startIdx, startIdx + perPage);

  const toggleSelectProject = (id) => {
    const normalizedId = normalizeDocId(id);
    if (!normalizedId) return;
    setSelectedProjectIds((prev) =>
      prev.includes(normalizedId)
        ? prev.filter((v) => v !== normalizedId)
        : [...prev, normalizedId]
    );
  };

  const toggleSelectAllPagedProjects = () => {
    const ids = paged.map((p) => normalizeDocId(p.id)).filter(Boolean);
    if (!ids.length) return;
    setSelectedProjectIds((prev) => {
      const allSelected = ids.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !ids.includes(id));
      return Array.from(new Set([...prev, ...ids]));
    });
  };

  const handleMassUpdateProjects = async () => {
    if (!isAdmin) return;
    if (!selectedProjectIds.length) {
      alert("Select at least one project.");
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
        const users = await fetchCollectionDocs("Users", 2500, 30000, MAX_ROWS);
        const opts = users
          .map((u) => ({
            name: String(u?.Name || u?.name || "").trim(),
            email: String(u?.email || "").trim().toLowerCase(),
          }))
          .filter((u) => u.email);
        if (!active) return;
        setMassUserOptions(opts);
      } catch (e) {
        console.warn("Failed loading users for project mass update", e?.message || e);
      }
    })();

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const applyMassUpdateProjects = async () => {
    if (!isAdmin) {
      alert("Only admin can perform mass update.");
      return;
    }

    const fieldName = String(massField || "").trim();
    const fieldValue = String(massValue || "").trim();
    if (!fieldName) return alert("Select a field.");
    if (!fieldValue) return alert("Enter value.");

    const validIds = new Set(projects.map((p) => normalizeDocId(p.id)).filter(Boolean));
    const idsToUpdate = selectedProjectIds
      .map((id) => normalizeDocId(id))
      .filter((id) => id && validIds.has(id));

    if (!idsToUpdate.length) {
      alert("No valid projects selected.");
      return;
    }

    setIsMassUpdating(true);
    try {
      const raw = localStorage.getItem("kp-user");
      const parsed = raw ? JSON.parse(raw) : {};

      const batch = writeBatch(db);
      idsToUpdate.forEach((id) => {
        batch.update(doc(db, "projects", id), {
          [fieldName]: fieldValue,
          updatedAt: serverTimestamp(),
          updatedBy: parsed?.email || "admin",
        });
      });

      await batch.commit();
      await fetchProjects(true);
      setSelectedProjectIds([]);
      setShowMassUpdate(false);
      alert(`✅ Updated ${idsToUpdate.length} project record(s).`);
    } catch (e) {
      console.error("Mass update projects failed", e);
      alert("Mass update failed.");
    } finally {
      setIsMassUpdating(false);
    }
  };

  // ---------- DYNAMIC COLUMNS (append any project keys not in DEFAULT_COLUMNS) ----------
  const allProjectKeys = React.useMemo(() => {
    const keys = new Set();
    projects.forEach((p) => {
      Object.keys(p || {}).forEach((k) => keys.add(k));
    });
    return Array.from(keys);
  }, [projects]);

  const defaultKeysSet = new Set(DEFAULT_COLUMNS.map((c) => c.key));
  const hiddenInternalKeys = new Set([
  "id",
  "_systemDelete",
  "createdBy",
]);


  // REMOVE OLD FIELDS THAT SHOULD NOT SHOW IN PROJECT TABLE
const REMOVE_OLD_PROJECT_FIELDS = new Set([
  "invoiceAmount",
  "totalReceived",
  "pending",
  "paymentPercentage",
  "salesOrderId",
]);
const dynamicKeys = allProjectKeys.filter(
  (k) =>
    !defaultKeysSet.has(k) &&
    !hiddenInternalKeys.has(k) &&
    !REMOVE_OLD_PROJECT_FIELDS.has(k) &&
    !deletedFields[k]          // ⭐ THIS IS THE KEY FIX
);

  const dynamicCols = dynamicKeys.map((k) => ({ key: k, label: prettyLabel(k) }));

  // visible order with scope fields forced to the tail
  const sortByPinned = (cols) =>
    [...cols].sort((a, b) => {
      const aPinned = pinnedColumns.includes(a.key) ? 0 : 1;
      const bPinned = pinnedColumns.includes(b.key) ? 0 : 1;
      return aPinned - bPinned;
    });

  const scopeTailKeys = ["sales_area", "sales_zone", "state", "zonal_manager"];
  const allVisibleCols = [
    ...DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key)),
    ...dynamicCols.filter((c) => visibleColumns.includes(c.key)),
  ];
  const nonScopeCols = allVisibleCols.filter((c) => !scopeTailKeys.includes(c.key));
  const scopeTailCols = allVisibleCols.filter((c) => scopeTailKeys.includes(c.key));
  const finalCols = [...sortByPinned(nonScopeCols), ...sortByPinned(scopeTailCols)];

  // Export logic (Excel)
  const handleExportExcel = () => {
    setShowExportDialog(false);
    const exportAllRows = exportOptions.dataType === "all";
    const exportAllFields = exportOptions.fieldType === "all";
    const dataRows = exportAllRows ? projects : sorted;
    if (!dataRows || dataRows.length === 0) {
      alert("⚠️ No records to export");
      return;
    }

    const exportCols = exportAllFields
      ? [...DEFAULT_COLUMNS, ...dynamicCols]
      : finalCols;

    const exportData = dataRows.map((r) => {
      const row = {};
      exportCols.forEach((c) => {
        let val = r[c.key];
        if (["createdAt","sixtyPercentReceivedDate","dispatchDate","installationDate","netMeterDate"].includes(c.key) && r[c.key]?.toDate) {
          val = r[c.key].toDate().toLocaleString();
        }
        row[c.label] = val ?? "";
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Projects");
    const today = new Date().toISOString().split("T")[0];
    XLSX.writeFile(workbook, `Projects_Export_${today}.xlsx`);
  };

// Column Menu component
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
    const rawValues = projects
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
        .filter((opt) => opt.toLowerCase().includes((draftFilter || "").trim().toLowerCase()))
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

  return (
    <div
      ref={menuRef}
      style={{
        ...styles.menu,
        position: "fixed",
        left: `${Math.max(8, Math.min(menuPos.left || 40, window.innerWidth - 236))}px`,
        top: `${Math.max(72, Math.min(menuPos.top || 140, window.innerHeight - 320))}px`,
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
            prev.includes(columnKey)
              ? prev.filter((p) => p !== columnKey)
              : [...prev, columnKey]
          );
          setOpenMenuFor(null);
        }}
      >
        {isPinned ? "📍 Unpin Column" : "📌 Pin Column"}
      </button>

{/* FILTER SECTION - FIXED */}
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
        placeholder="Value"
        style={{ ...styles.filterInput, flex: 1 }}
        onChange={(e) => setDraftNum(e.target.value)}
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
          value={draftFilter ?? ""}
          placeholder={isUserFilterColumn ? "Type or pick value" : "Type filter"}
          style={{ ...styles.filterInput, flex: 1 }}
          onFocus={() => {
            if (isUserFilterColumn) setShowSuggestions(true);
          }}
          onBlur={() => {
            if (isUserFilterColumn) setShowSuggestions(false);
          }}
          onChange={(e) => {
            setDraftFilter(e.target.value.trimStart());
            if (isUserFilterColumn) setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setColumnFilters((prev) => ({
                ...prev,
                [columnKey]: draftFilter.trim(),
              }));
              setOpenMenuFor(null);
            }
          }}
        />

        {draftFilter && (
          <button
            onClick={() => setDraftFilter("")}
            title="Clear filter"
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
                setColumnFilters((prev) => ({
                  ...prev,
                  [columnKey]: opt,
                }));
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
          setColumnFilters((prev) => ({
            ...prev,
            [columnKey]: draftFilter.trim(),
          }));
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
          setVisibleColumns((prev) =>
            prev.filter((c) => c !== columnKey)
          );
          setPinnedColumns((prev) =>
            prev.filter((p) => p !== columnKey)
          );
          setOpenMenuFor(null);
        }}
      >
        🙈 Hide Column
      </button>
    </div>
  );
};

  // -------------------------
  // Project Drawer is external file; keep existing behavior.
  // The ProjectsDashboard only opens ProjectDrawer and refreshes list.
  // -------------------------

  // small helper to generate yyyy-mm-dd for date inputs
  const toISODateInput = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

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
        collectionName: "projects",
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

      await fetchProjects(true);
      alert(`✅ Imported ${result.imported} project records.`);
    } catch (err) {
      console.error("Project import failed", err);
      alert("Import failed. Please check file format.");
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

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
        <h3 style={styles.sidebarTitle}>Filter Projects</h3>

        <input
          placeholder="Search by name, phone, KPI..."
          style={styles.searchInput}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
        />

        <label style={styles.label}>Status</label>
        <select
          style={styles.dropdown}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option>All</option>
          <option>Active</option>
          <option>On Hold</option>
          <option>Completed</option>
          <option>Cancelled</option>
        </select>

        <div style={{ marginTop: "auto", color: "#fff", opacity: 0.9 }}>
          Tip: Projects are created from Sales Orders (Convert → Project). Edit details here.
        </div>
      </div>

      {/* Main content */}
      <div style={styles.mainContent}>
        <div style={styles.headerCard}>
          <div style={styles.headerRow}>
            <div>
              <h2 style={styles.header}>Projects Pipeline</h2>
              <div style={styles.headerSub}>Monitor project milestones, delays, and completion flow</div>
            </div>

          <div style={styles.toolbarWrap}>
            {isAdmin && (
              <button
                style={styles.exportBtn}
                onClick={handleMassUpdateProjects}
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
              <button style={styles.manageBtn} onClick={() => setShowManageCols((s) => !s)}>
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

        {loading ? (
          <p style={{ color: "#800000" }}>Loading projects...</p>
        ) : paged.length === 0 ? (
          <div style={styles.emptyStateCard}>
            <div style={styles.emptyStateTitle}>No Projects Found</div>
            <div style={styles.emptyStateText}>Try adjusting filters or search keywords.</div>
          </div>
        ) : (
          <>
           <div style={{ width: "100%", minWidth: 0 }}>
            {/* table wrapper: horizontal scroll only here */}
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={styles.selectColTh}>
                        <input
                          type="checkbox"
                          checked={paged.length > 0 && paged.every((r) => selectedProjectIds.includes(normalizeDocId(r.id)))}
                          onChange={toggleSelectAllPagedProjects}
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
                              setOpenMenuFor(openMenuFor === col.key ? null : col.key);
                            }}
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
                  {paged.map((p) => (
                    <tr
                      key={p.id}
                      style={styles.tr}
                      onClick={() => {
                        if (!canOpenDrawer) return;
                        setSelectedProject(p);
                        setIsDrawerOpen(true);
                      }}
                    >
                      {isAdmin && (
                        <td style={styles.selectColTd} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedProjectIds.includes(normalizeDocId(p.id))}
                            onChange={() => toggleSelectProject(p.id)}
                          />
                        </td>
                      )}
                      {finalCols.map((col) => {
                        let val = p[col.key];

                        // --------------------------------------------
                        // AUTO FIELDS
                        // --------------------------------------------

                        const sixty = p.sixtyPercentDate;
                        const dispatch = p.dispatchDate;
                        const install = p.installationDate;
                        const net = p.netMeterDate;

                        // 60% received date (show fetched/assigned value)
                        if (col.key === "sixtyPercentDate") {
  val = formatDate(sixty);
}

                        // Dispatch
                        if (col.key === "dispatchStatus") val = dispatch ? "DONE" : "NOT DONE";
                        if (col.key === "dispatchDelayDays") {
                          const d = daysBetween(sixty, dispatch);
                          val = d === "" ? "-" : String(d);
                        }

                        // Installation
                        if (col.key === "installationStatus") val = install ? "DONE" : "NOT DONE";
                        if (col.key === "installationDelayDays") {
                          const d = daysBetween(dispatch, install);
                          val = d === "" ? "-" : String(d);
                        }

                        // Net meter
                        if (col.key === "netMeterStatus") val = net ? "DONE" : "NOT DONE";
                        if (col.key === "netMeterDelayDays") {
                          const d = daysBetween(install, net);
                          val = d === "" ? "-" : String(d);
                        }

                        // Date formatting for date columns
                        if (["dispatchDate","installationDate","netMeterDate","createdAt","updatedAt"].includes(col.key)) {
  val = formatDate(val);
}

                        // invoiceAmount / capacity pretty formatting (if present)
                        if (col.key === "invoiceAmount") {
                          val = p.invoiceAmount ? `₹${Number(p.invoiceAmount).toLocaleString()}` : "₹0";
                        } else if (col.key === "capacity") {
                          val = p.capacity ? `${p.capacity} kW` : "0 kW";
                        } else if (col.key === "phone") {
                          val = p.phone ?? "";
                        }

                        // dynamic fields: if object/array/date convert to readable string
                        if (dynamicKeys.includes(col.key)) {
                          const value = p[col.key];
                          if (value?.seconds && value?.nanoseconds && typeof value.toDate === "function") {
                            val = value.toDate().toLocaleDateString("en-GB");
                          } else if (Array.isArray(value)) {
                            val = value.join(", ");
                          } else if (typeof value === "object" && value !== null) {
                            try {
                              val = JSON.stringify(value);
                            } catch {
                              val = String(value);
                            }
                          } else {
                            val = value ?? "";
                          }
                        }

                        return (
                          <td key={col.key} style={styles.td}>
                            {val ?? ""}
                          </td>
                        );
                      })}
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
                  {startIdx + 1}–{Math.min(startIdx + perPage, sorted.length)} of {sorted.length}
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
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={styles.pageBtn}>
                  Prev
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={styles.pageBtn}>
                  Next
                </button>
                {hasMore && page >= totalPages && (
                  <button onClick={() => fetchProjects(false)} style={styles.pageBtn}>
                    Load more
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Drawer */}
      {isDrawerOpen && selectedProject && <ProjectDrawer project={selectedProject} onClose={() => { setIsDrawerOpen(false); setSelectedProject(null); fetchProjects(true); }} />}

      {/* Export dialog */}
      {showExportDialog && (
        <div style={styles.dialogOverlay}>
          <div style={styles.dialogBox}>
            <h3 style={{ color: "#800000" }}>📤 Export Projects</h3>

            <div style={{ marginTop: 10 }}>
              <b>Fields to Export</b>
              <label style={styles.radioLabel}>
                <input type="radio" name="fieldType" value="selected" checked={exportOptions.fieldType === "selected"} onChange={(e) => setExportOptions({ ...exportOptions, fieldType: e.target.value })} /> Selected Fields (Visible Columns)
              </label>
              <label style={styles.radioLabel}>
                <input type="radio" name="fieldType" value="all" checked={exportOptions.fieldType === "all"} onChange={(e) => setExportOptions({ ...exportOptions, fieldType: e.target.value })} /> All Fields
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Projects to Export</b>
              <label style={styles.radioLabel}>
                <input type="radio" name="dataType" value="filtered" checked={exportOptions.dataType === "filtered"} onChange={(e) => setExportOptions({ ...exportOptions, dataType: e.target.value })} /> Current Projects (Filtered)
              </label>
              <label style={styles.radioLabel}>
                <input type="radio" name="dataType" value="all" checked={exportOptions.dataType === "all"} onChange={(e) => setExportOptions({ ...exportOptions, dataType: e.target.value })} /> All Projects
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
      )}

      <MassUpdateDialog
        open={showMassUpdate}
        rowCount={selectedProjectIds.length}
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
        onApply={applyMassUpdateProjects}
        onClose={() => setShowMassUpdate(false)}
        loading={isMassUpdating}
      />
    </div>
  );
}

/* styles (keeps look consistent with your dashboards) */
const styles = {
container: {
  display: "flex",
  minHeight: "100vh",
  height: "auto",              // ⭐ KEY FIX
  width: "100%",
  overflowX: "hidden",
  fontFamily: "Poppins, sans-serif",
  backgroundColor: "#fff",
},
  sidebar: {
  backgroundColor: "#800000",
  color: "#fff",
  padding: 20,
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
  width: "100%",
  minWidth: 0,
  padding: 28,
  overflowX: "hidden",
  overflowY: "hidden",
  minHeight: 0,
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
    zIndex: 2,
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
  exportBtn: { background: "#fff", color: "#800000", border: "1px solid rgba(128,0,0,0.35)", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12, letterSpacing: 0.2, boxShadow: "0 4px 10px rgba(128,0,0,0.08)" },
  manageBtn: { background: "linear-gradient(135deg, #8b0000, #a11212)", color: "#fff", border: "none", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12, letterSpacing: 0.2, boxShadow: "0 6px 12px rgba(128,0,0,0.18)" },
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
  width: "max-content",   // ⭐ IMPORTANT
  minWidth: "100%",
  borderCollapse: "collapse",
},// fixed width to enable horizontal scroll; adjust width as needed
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
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 140,        // ⭐ prevents overlap
},
selectColTd: {
  padding: "8px 6px",
  width: 34,
  minWidth: 34,
  maxWidth: 34,
  textAlign: "center",
  whiteSpace: "nowrap",
},
  tr: { borderBottom: "1px solid #eee", cursor: "pointer" },
  headerCell: { display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" },
  iconButton: { background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 14, cursor: "pointer", padding: "4px 6px", borderRadius: 6 },
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
  filterLabel: { fontSize: 12, color: "#800000", opacity: 0.9, fontWeight: 700 },
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
  paddingBottom: 16,        // ⭐ ensures visible on mobile
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
  pageBtn: { background: "#fff", border: "1px solid #800000", color: "#800000", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600 },

  /* Export dialog */
  dialogOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 11000 },
  dialogBox: { background: "#fff", padding: 20, borderRadius: 8, width: 360, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" },
  radioLabel: { display: "block", marginTop: 6, color: "#333", fontSize: 14 },
  dialogButtons: { marginTop: 16, display: "flex", justifyContent: "space-between", gap: 10 },
  addBtn: { flex: 1, backgroundColor: "#800000", color: "#fff", border: "none", padding: "8px", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  cancelBtn: { flex: 1, backgroundColor: "#fff", color: "#800000", border: "1px solid #800000", padding: "8px", borderRadius: 6, cursor: "pointer", fontWeight: 600 },

  // Drawer styles
  drawerOverlay: { position: "fixed", right: 0, top: 0, bottom: 0, left: 260, background: "rgba(0,0,0,0.02)", display: "flex", justifyContent: "flex-end", zIndex: 12000 },
  drawer: { width: 520, background: "#fff", padding: 20, boxShadow: "-6px 0 20px rgba(0,0,0,0.12)", height: "100vh", overflowY: "auto", position: "relative" },
  drawerClose: { position: "absolute", right: 18, top: 18, border: "1px solid #800000", padding: "6px 10px", background: "transparent", color: "#800000", borderRadius: 6 },
  input: { width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ccc", marginBottom: 12 },
  primaryBtn: { background: "#800000", color: "#fff", border: "none", padding: 10, borderRadius: 6, cursor: "pointer", fontWeight: 700 },
  secondaryBtn: { background: "#fff", color: "#800000", border: "1px solid #800000", padding: 10, borderRadius: 6, cursor: "pointer" },
};