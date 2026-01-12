// src/components/LeadsDashboard.jsx
import React, { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";
import LeadDrawer from "./LeadDrawer";
import { useLocation, useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { usePermission } from "../hooks/usePermission";
import { getScopedQuery } from "../helpers/getScopedQuery";


const DEFAULT_COLUMNS = [
  { key: "autoId", label: "KPI ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "source", label: "Lead Source" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location" },
  { key: "teleSale", label: "Tele-Sales" },
  { key: "consultantName", label: "Consultant" },
  { key: "status", label: "Status" },
  { key: "siteVisitArranged", label: "Site Visit Arranged" },
  { key: "createdAt", label: "Created At" },

  // ⭐ NEW HIDDEN BY DEFAULT COLUMNS
  { key: "locationLink", label: "Location Link" },
  { key: "updatedBy", label: "Updated By" },
  { key: "createdBy", label: "Created By" },
  { key: "ownerUid", label: "Owner UID" },
  { key: "updatedAt", label: "Updated At" },
];

const isMobile = window.innerWidth <= 768;

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
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");


 const HIDE_BY_DEFAULT = [
  "email",
  "locationLink",
  "updatedBy",
  "createdBy",
  "ownerUid",
  "updatedAt",
];

const [visibleColumns, setVisibleColumns] = useState(
  DEFAULT_COLUMNS
    .map((c) => c.key)
    .filter((key) => !HIDE_BY_DEFAULT.includes(key))
);
const deletedFieldKeys =
  leads.length > 0 && leads[0].deletedFields
    ? Object.keys(leads[0].deletedFields)
    : [];
  const [filters, setFilters] = useState({});
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 120 }); // Dynamic top position
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

  // ✅ Fetch Leads
  const fetchLeads = async () => {
  setLoading(true);
  try {
    const auth = getAuth();
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;

    // 🔥 build role-based query
    const q = await getScopedQuery("leads");

    const snap = await getDocs(q);

    const data = snap.docs.map((doc, idx) => {
      const d = doc.data();
      return {
        id: doc.id,
        autoId: d.autoId || `KPI-${String(idx + 1).padStart(3, "0")}`,
        ...d,
      };
    });

    data.sort((a, b) => {
      const at = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bt = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bt - at;
    });

    setLeads(data);
  } catch (err) {
    console.error("Error fetching leads:", err);
    setLeads([]);
  } finally {
    setLoading(false);
  }
};

// 1️⃣ First useEffect → fetch leads
useEffect(() => {
  fetchLeads();
}, []);


// 2️⃣ Second useEffect → auto open drawer
// 2️⃣ Second useEffect → auto open drawer (safe: only when on /leads)
// auto open drawer — only when on /leads
useEffect(() => {
  // adjust this exact check to match your route,
  // e.g. if route is "/app/leads" use location.pathname.includes("/app/leads")
  if (!location.pathname || !location.pathname.includes("/leads")) return;

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
}, [location.pathname, location.search, leads, navigate]);

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
    const val = filters[key]?.toLowerCase();
    if (!val) return true;
    return (lead[key] ?? "").toString().toLowerCase().includes(val);
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
    const curFilter = filters[columnKey] ?? "";
    const isPinned = pinnedColumns.includes(columnKey);

    return (
      <div
        ref={menuRef}
        style={{
          ...styles.menu,
          position: "fixed",
          right: "30px",
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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              autoFocus
              type="text"
              value={curFilter}
              onChange={(e) =>
                setFilters({ ...filters, [columnKey]: e.target.value })
              }
              placeholder="Type & press enter"
              style={{ ...styles.filterInput, flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && setOpenMenuFor(null)}
            />
            {curFilter && (
              <button
                onClick={() =>
                  setFilters((prev) => ({ ...prev, [columnKey]: "" }))
                }
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
const prettyLabel = (name) =>
  name ? name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : "";

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

// IMPORTANT FIX ⚠️
// dynamic fields must ALWAYS be visible even if not in Manage Columns dropdown
// FINAL COLUMNS (STATIC FIRST → DYNAMIC NEXT)
const finalCols = [
  // 1️⃣ Render static columns that user selected
  ...DEFAULT_COLUMNS.filter((col) => visibleColumns.includes(col.key)),

  // 2️⃣ Render dynamic columns (auto-added)
  ...dynamicCols
];
// ---------- END: DYNAMIC TABLE COLUMNS ----------

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
        <label style={styles.label}>Records Per Page</label>
        <select
          value={perPage}
          onChange={(e) => {
            setPerPage(Number(e.target.value));
            setPage(1);
          }}
          style={styles.dropdown}
        >
          {[10, 20, 30, 40, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} Records Per Page
            </option>
          ))}
        </select>
      </div>

{/* Main Content */}
<div style={styles.mainContent}>
  <div style={styles.headerRow}>
    <h2 style={styles.header}>All Leads</h2>

    {/* BUTTONS ROW */}
    <div style={{ display: "flex", gap: 10 }}>

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
            <div
              style={{
                fontWeight: 700,
                color: "#800000",
                marginBottom: 6,
              }}
            >
              Show / Hide Columns
            </div>

            {DEFAULT_COLUMNS.map((col) => (
              <label key={col.key} style={styles.manageItem}>
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(col.key)}
                  onChange={(e) =>
                    e.target.checked
                      ? setVisibleColumns([...visibleColumns, col.key])
                      : setVisibleColumns(
                          visibleColumns.filter((c) => c !== col.key)
                        )
                  }
                />
                {col.label}
              </label>
            ))}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 10,
                gap: 6,
              }}
            >
              <button
                onClick={() =>
                  setVisibleColumns(DEFAULT_COLUMNS.map((c) => c.key))
                }
                style={{
                  flex: 1,
                  background: "#800000",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 8px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Unhide All
              </button>
              <button
                onClick={() => setShowManageCols(false)}
                style={{
                  flex: 1,
                  background: "#fff",
                  color: "#800000",
                  border: "1px solid #800000",
                  borderRadius: 6,
                  padding: "6px 8px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>

        {loading ? (
          <p style={{ color: "#800000" }}>Loading leads...</p>
        ) : pagedLeads.length === 0 ? (
          <p style={{ color: "#800000" }}>No leads found.</p>
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
                    const rect = e.target.getBoundingClientRect();
                    setMenuPos({ top: rect.top });
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
            style={{ ...styles.tr, cursor: "pointer" }}
            onClick={() => {
              setSelectedLead(lead);
              setIsDrawerOpen(true);
            }}
          >
            {finalCols.map((col) => (
              <td key={col.key} style={styles.td}>
                {(() => {
                  const value = lead[col.key];

                  if (!value) return "";

                  if (value.toDate)
                    return value.toDate().toLocaleDateString("en-GB");

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

  {/* Pagination */}
  <div style={styles.pagination}>
    <span>
      {startIdx + 1}–
      {Math.min(startIdx + perPage, sortedLeads.length)} of{" "}
      {sortedLeads.length}
    </span>
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
    </div>
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
    onLeadAdded={fetchLeads}
    existingLead={selectedLead}
    refreshLeads={fetchLeads}   // 👈 ADD THIS LINE
  />
)}
      {showExportDialog && <ExportDialog />}
    </div>
  );
}

/* 🎨 Styles */
const styles = {
  container: {
    display: "flex",
    height: "100vh",
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
  overflowX: "auto",
  width: "100%",
  boxSizing: "border-box",
},

  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 2,
  },
  header: { color: "#800000", fontSize: 24, fontWeight: "bold" },
  exportBtn: {
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 600,
  },
  manageBtn: {
    background: "#800000",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 600,
  },
  manageMenu: {
    position: "absolute",
    right: 0,
    top: "36px",
    background: "#fff",
    border: "1px solid rgba(128,0,0,0.2)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    borderRadius: 6,
    padding: 8,
    zIndex: 10000,
    minWidth: 180,
  },
  manageItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 8px",
    color: "#800000",
    fontSize: 14,
  },
tableWrapper: {
  width: "100%",
  overflowX: "auto",
  borderRadius: 8,
  position: "relative",
  zIndex: 1,
 maxHeight: "calc(100vh - 150px)",
overflowX: "auto", // ⭐ Fit screen height
  overflowY: "auto",
},
table: {
  width: "max-content",  // ⭐ Auto-expand when many columns exist
  minWidth: "100%",
  borderCollapse: "collapse",
},
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
    border: "none",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
  },
  menu: {
    background: "#fff",
    border: "1px solid rgba(128,0,0,0.15)",
    boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
    width: 220,
    borderRadius: 6,
    zIndex: 99999,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  menuItem: {
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "6px 8px",
    cursor: "pointer",
    color: "#800000",
    fontWeight: 600,
  },
  filterGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "6px 8px",
  },
  filterLabel: {
    fontSize: 12,
    color: "#800000",
    opacity: 0.8,
  },
  filterInput: {
    border: "1px solid rgba(128,0,0,0.3)",
    borderRadius: 4,
    padding: 4,
    fontSize: 13,
    color: "#800000",
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
