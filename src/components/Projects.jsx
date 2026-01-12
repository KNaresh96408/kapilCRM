import React, { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { onSnapshot } from "firebase/firestore";
import ProjectDrawer from "../components/ProjectDrawer";
import { useLocation, useNavigate } from "react-router-dom";
import { usePermission } from "../hooks/usePermission";
import { getScopedQuery } from "../helpers/getScopedQuery";

/**
 * ProjectsDashboard.jsx
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
    { key: "teleSale", label: "Tele-Sales" },
  { key: "consultantName", label: "Consultant" },
  { key: "capacity", label: "Capacity" },

  { key: "sixtyPercentReceivedDate", label: "60% Received Date" },

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

function prettyLabel(name) {
  if (!name) return "";
  return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

const isMobile = window.innerWidth <= 768;

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
const navigate = useNavigate();

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
  const [menuPos, setMenuPos] = useState({ top: 140 });
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
  // Utility: fetch 60% date from salesOrders for a KPI ID
  // ---------------------------
  const fetch60PercentDate = async (kpiId) => {
    if (!kpiId) return null;
    try {
      // Fetch salesOrders once and find matching by kpiId
      const snap = await getDocs(collection(db, "salesOrders"));
      for (const d of snap.docs) {
        const so = d.data();
        if (!so) continue;
        if (so.kpiId === kpiId) {
          if (so.secondPaymentDate) return so.secondPaymentDate;
        }
      }
      return null;
    } catch (e) {
      console.error("60% fetch error:", e);
      return null;
    }
  };

  // ---------------------------
  // fetch projects and enrich with 60% date when missing
  // ---------------------------
  const fetchProjects = async () => {
    setLoading(true);
    try {
     const baseRef = await getScopedQuery("projects");

const q = query(
  baseRef,
  orderBy("createdAt", "desc")
);
      const snap = await getDocs(q);
      let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
  const soSnap = await getDocs(collection(db, "salesOrders"));
  const soDocs = soSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

  const soMap = {};
  for (const s of soDocs) {
    if (!s.kpiId) continue;
    soMap[s.kpiId] = s;
  }

  list = list.map((p) => {
    if (!p.kpiId || !soMap[p.kpiId]) return p;

    const so = soMap[p.kpiId];

    return {
      ...p,

      // ⭐ existing logic (unchanged)
      sixtyPercentReceivedDate:
  p.sixtyPercentReceivedDate ||
  so.sixtyPercentReachedDate ||
  so.secondPaymentDate ||
  so.firstPaymentDate ||
  null,
      // ⭐ NEW FIELDS (only if missing — never overwrites)
      sales_zone: p.sales_zone || so.sales_zone || "",
      state: p.state || so.state || "",
      sales_area: p.sales_area || so.sales_area || "",
      zonal_manager: p.zonal_manager || so.zonal_manager || "",
      teleSale: p.teleSale || so.teleSale || "",
  consultantName: p.consultantName || so.consultantName || "",
    };
  });
}

      setProjects(list);
    } catch (err) {
      console.error("Error fetching projects:", err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ⭐ Auto-open drawer from universal search (exactly like Leads/Deals/SO)
useEffect(() => {
  const params = new URLSearchParams(location.search);
  const openId = params.get("open");

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
}, [location.search, projects]);
  useEffect(() => {
  const unsub = onSnapshot(doc(db, "crm_fields", "projects"), () => {
    console.log("🔥 CRM fields updated — refreshing projects table...");
    fetchProjects();     // reload table data
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
    if (!val.trim()) return true;
    const cell = (p[col] || "").toString().toLowerCase();
    return cell.includes(val.toLowerCase());
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

  // visible order of columns (pinned first) but ensure dynamic columns appended at end
  const visibleCols = [
    ...pinnedColumns.filter((k) => visibleColumns.includes(k)).map((key) => DEFAULT_COLUMNS.find((c) => c.key === key)),
    ...DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key) && !pinnedColumns.includes(c.key)),
  ].filter(Boolean);

  const finalCols = [...visibleCols, ...dynamicCols];

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
  const curFilter = columnFilters[columnKey] || "";
  const isPinned = pinnedColumns.includes(columnKey);

  return (
    <div
      ref={menuRef}
      style={{
        ...styles.menu,
        position: "fixed",
        right: 30,
        top: `${menuPos.top}px`,
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

  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <input
      type="text"
      autoFocus
      value={curFilter ?? ""}
      placeholder="Type & press Enter"
      style={{ ...styles.filterInput, flex: 1 }}
      onChange={(e) =>
        setColumnFilters((prev) => ({
          ...prev,
          [columnKey]: e.target.value.trimStart(),
        }))
      }
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setOpenMenuFor(null); // close menu
        }
      }}
    />

    {curFilter && (
      <button
        onClick={() =>
          setColumnFilters((prev) => ({
            ...prev,
            [columnKey]: "",
          }))
        }
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

        <label style={styles.label}>Records Per Page</label>
        <select
          style={styles.dropdown}
          value={perPage}
          onChange={(e) => {
            setPerPage(Number(e.target.value));
            setPage(1);
          }}
        >
          {[10, 20, 30, 40, 50].map((n) => (
            <option key={n} value={n}>
              {n} Records Per Page
            </option>
          ))}
        </select>

        <div style={{ marginTop: "auto", color: "#fff", opacity: 0.9 }}>
          Tip: Projects are created from Sales Orders (Convert → Project). Edit details here.
        </div>
      </div>

      {/* Main content */}
      <div style={styles.mainContent}>
        <div style={styles.headerRow}>
          <h2 style={styles.header}>Projects</h2>

          <div style={{ display: "flex", gap: 10 }}>
            <button style={styles.exportBtn} onClick={() => setShowExportDialog(true)}>
              📤 Export Excel
            </button>

            <div style={{ position: "relative" }}>
              <button style={styles.manageBtn} onClick={() => setShowManageCols((s) => !s)}>
                ⚙ Manage Columns
              </button>

              {showManageCols && (
                <div ref={manageRef} style={styles.manageMenu}>
                  <div style={{ fontWeight: 700, color: "#800000", marginBottom: 6 }}>Show / Hide Columns</div>
                  {DEFAULT_COLUMNS.map((col) => (
                    <label key={col.key} style={styles.manageItem}>
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={(e) =>
                          e.target.checked ? setVisibleColumns((prev) => [...prev, col.key]) : setVisibleColumns((prev) => prev.filter((k) => k !== col.key))
                        }
                      />
                      {col.label}
                    </label>
                  ))}

                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button style={{ ...styles.addBtn, flex: 1 }} onClick={() => setVisibleColumns(DEFAULT_COLUMNS.map((c) => c.key))}>
                      Unhide All
                    </button>
                    <button style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setShowManageCols(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ color: "#800000" }}>Loading projects...</p>
        ) : paged.length === 0 ? (
          <p style={{ color: "#800000" }}>No projects found.</p>
        ) : (
          <>
           <div
  style={{
    height: "65vh",
    overflowY: "auto",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch"
  }}
>
            {/* table wrapper: horizontal scroll only here */}
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {finalCols.map((col) => (
                      <th key={col.key} style={styles.th}>
                        <div style={styles.headerCell}>
                          <span>{col.label}</span>
                          <button
                            style={styles.iconButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setMenuPos({ top: rect.top });
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
                        setSelectedProject(p);
                        setIsDrawerOpen(true);
                      }}
                    >
                      {finalCols.map((col) => {
                        let val = p[col.key];

                        // --------------------------------------------
                        // AUTO FIELDS
                        // --------------------------------------------

                        const sixty = p.sixtyPercentReceivedDate;
                        const dispatch = p.dispatchDate;
                        const install = p.installationDate;
                        const net = p.netMeterDate;

                        // 60% received date (show fetched/assigned value)
                        if (col.key === "sixtyPercentReceivedDate") {
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
              <span>
                {startIdx + 1}–{Math.min(startIdx + perPage, sorted.length)} of {sorted.length}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={styles.pageBtn}>
                  Prev
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={styles.pageBtn}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Drawer */}
      {isDrawerOpen && selectedProject && <ProjectDrawer project={selectedProject} onClose={() => { setIsDrawerOpen(false); setSelectedProject(null); fetchProjects(); }} />}

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
    </div>
  );
}

/* styles (keeps look consistent with your dashboards) */
const styles = {
container: {
  display: "flex",
  minHeight: "100vh",
  height: "auto",              // ⭐ KEY FIX
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
  padding: 28,
  overflowX: "auto",
  overflowY: "auto",          // ⭐ ADD THIS
  WebkitOverflowScrolling: "touch",
  boxSizing: "border-box",
},
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 2 },
  header: { color: "#800000", fontSize: 24, fontWeight: "bold" },
  exportBtn: { background: "#fff", color: "#800000", border: "1px solid #800000", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontWeight: 600 },
  manageBtn: { background: "#800000", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontWeight: 600 },
  manageMenu: { position: "absolute", right: 0, top: "36px", background: "#fff", border: "1px solid rgba(128,0,0,0.2)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", borderRadius: 6, padding: 8, zIndex: 10000, minWidth: 220 },
  manageItem: { display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", color: "#800000", fontSize: 14 },
tableWrapper: {
  width: "100%",
  overflowX: "auto",
  overflowY: "visible",
  WebkitOverflowScrolling: "touch",
},
table: {
  width: "max-content",   // ⭐ IMPORTANT
  minWidth: "100%",
  borderCollapse: "collapse",
},// fixed width to enable horizontal scroll; adjust width as needed
th: {
  backgroundColor: "#800000",
  color: "#fff",
  padding: "12px 10px",
  position: "sticky",
  top: 0,
  zIndex: 10,
  whiteSpace: "nowrap",
},
td: {
  padding: "12px 10px",
  fontSize: 14,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 140,        // ⭐ prevents overlap
},
  tr: { borderBottom: "1px solid #eee", cursor: "pointer" },
  headerCell: { display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" },
  iconButton: { background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 14, cursor: "pointer", padding: "4px 6px", borderRadius: 6 },
  menu: { background: "#fff", border: "1px solid rgba(128,0,0,0.15)", boxShadow: "0 6px 18px rgba(0,0,0,0.08)", width: 220, borderRadius: 6, zIndex: 99999, padding: 8, display: "flex", flexDirection: "column", gap: 6 },
  menuItem: { background: "transparent", border: "none", textAlign: "left", padding: "6px 8px", cursor: "pointer", color: "#800000", fontWeight: 600 },
  filterGroup: { display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px" },
  filterLabel: { fontSize: 12, color: "#800000", opacity: 0.8 },
  filterInput: { border: "1px solid rgba(128,0,0,0.3)", borderRadius: 4, padding: 4, fontSize: 13, color: "#800000" },
  pagination: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 18,
  paddingBottom: 16,        // ⭐ ensures visible on mobile
  color: "#800000",
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
