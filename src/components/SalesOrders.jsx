// src/components/SalesOrders.jsx
import React, { useEffect, useRef, useState } from "react";
import { collection, getDocs, query, orderBy, doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as XLSX from "xlsx";
import SalesOrderDrawer from "./SalesOrderDrawer";
import { usePermission } from "../hooks/usePermission";
// add these imports
import { useLocation, useNavigate } from "react-router-dom";
import { getScopedQuery } from "../helpers/getScopedQuery";

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
{ key: "teleSale", label: "Tele-Sales" },
{ key: "consultantName", label: "Consultant Name" },
{ key: "lead_source", label: "Lead Source" },
  { key: "address", label: "Address" },
  { key: "capacity", label: "Capacity" },
  { key: "invoiceAmount", label: "Invoice Amount" },
  { key: "paymentReceived", label: "Payment Received" },
  { key: "pendingPayment", label: "Pending" },
  { key: "paymentPercentage", label: "Payment %" },
  { key: "sixtyPercentReceived", label: "60% Received" },
{ key: "sixtyPercentDelayDays", label: "60% Delay Days" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created At" },
  { key: "updatedAt", label: "Updated At" },
  { key: "updatedBy", label: "Updated By" },
];

const isMobile = window.innerWidth <= 768;

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

  const [salesOrders, setSalesOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  // table control state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  // column visibility/pinning/filtering/menu
  const [visibleColumns, setVisibleColumns] = useState(
  DEFAULT_COLUMNS
    .map((c) => c.key)
    .filter((k) => !["updatedAt", "updatedBy", "lead_source"].includes(k))
);
  const [pinnedColumns, setPinnedColumns] = useState([]);
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 120 });
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

  // Admin check (local storage "kp-user")
  const user = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("kp-user") || "{}") : {};
  const isAdmin = user?.role === "admin" || user?.email === "loan@kapilpower.com";

  // Fetch Sales Orders
  const fetchSalesOrders = async () => {
  setLoading(true);
  try {
    
    // 1️⃣ Get ALL DEALS first
const dealsSnap = await getDocs(collection(db, "deals"));
const dealsMap = {};

dealsSnap.forEach((d) => {
  const deal = d.data();

  const key =
    deal.kpiId ||
    deal.autoId ||
    deal.KPIID ||
    "";

  if (!key) return;

  dealsMap[key] = {
    teleSale: deal.teleSale || "",
    consultantName: deal.consultantName || ""
  };
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

const snap = await getDocs(finalQuery);


    const list = snap.docs.map((d) => {
      const data = d.data();
        // ---------- 60% Received & Delay Logic ----------
  let sixtyPercentReceived = "NO";
  let sixtyPercentDelayDays = 0;

  const createdDate = data.createdAt?.toDate?.() || new Date();

  // find first date where cumulative reached >= 60%
  let reachedDate = null;
  let total = 0;

  const payments = [
    { amount: data.firstPayment || 0, date: data.firstPaymentDate },
    { amount: data.secondPayment || 0, date: data.secondPaymentDate },
    { amount: data.thirdPayment || 0, date: data.thirdPaymentDate },
    { amount: data.fourthPayment || 0, date: data.fourthPaymentDate },
  ];

  payments.forEach(p => {
    if (!p.amount || !p.date) return;

    total += Number(p.amount);

    const percentage = data.invoiceAmount
      ? (total / Number(data.invoiceAmount)) * 100
      : 0;

    if (!reachedDate && percentage >= 59.3) {
      reachedDate = p.date?.toDate?.() || new Date(p.date);
    }
  });

  if (reachedDate) {
    // ---------- 60% ACHIEVED ----------
    sixtyPercentReceived = "YES";

    const diffMs = reachedDate - createdDate;
    sixtyPercentDelayDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  } else {
    // ---------- NOT ACHIEVED ----------
   // ---------- NOT ACHIEVED ----------
sixtyPercentReceived = "NO";

const today = new Date();

// pure date only (no time)
const created = new Date(
  createdDate.getFullYear(),
  createdDate.getMonth(),
  createdDate.getDate()
);

const current = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate()
);

// diff in days exactly
const diffMs = current - created;
sixtyPercentDelayDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }


      const key =
        data.kpiId ||
        data.autoId ||
        data.KPIID ||
        "";

      const link = dealsMap[key] || {};

      return {
         ...data,
        id: d.id,

        kpiId: key,
        autoId: data.autoId || "",
        KPIID: data.KPIID || "",

        name: data.name || "",
        phone: data.phone || "",
        address: data.address || data.location || "",

        teleSale: data.teleSale || "",
        consultantName: data.consultantName || "",
        lead_source: data.lead_source || "",

        capacity: data.capacity || data.systemSize || 0,
        invoiceAmount:
          typeof data.invoiceAmount === "number"
            ? data.invoiceAmount
            : Number(data.invoiceAmount || 0),

        paymentReceived: Number(data.paymentReceived || 0),
        pendingPayment: Number(data.pendingPayment || 0),
        paymentPercentage: Number(data.paymentPercentage || 0),

        sixtyPercentReceived,
sixtyPercentDelayDays,

        status:
          data.status ||
          (data.convertedToProject ? "Converted" : "Not Converted"),

        createdAt: data.createdAt || null,

       
      };
    });

    setSalesOrders(list);
  } catch (err) {
    console.error("Error fetching sales orders:", err);
    setSalesOrders([]);
  } finally {
    setLoading(false);
  }
};
  useEffect(() => {
    fetchSalesOrders();
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
}, [location.search, salesOrders]);

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
            .filter((d) => d.key !== "id");

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
    // search term across name, phone, kpiId
    const q = searchTerm.trim().toLowerCase();
    const searchMatch =
      !q ||
      (so.name || "").toLowerCase().includes(q) ||
      (so.phone || "").toString().includes(q) ||
      (so.kpiId || "").toString().trim().toLowerCase().includes(q);

    const statusMatch = statusFilter === "All" || (so.status || "").toLowerCase() === statusFilter.toLowerCase();

    const columnFilterMatch = Object.keys(columnFilters).every((key) => {
      const val = (columnFilters[key] || "").toString().toLowerCase().trim();
      if (!val) return true;
      const target = (so[key] || "").toString().toLowerCase();
      return target.includes(val);
    });

    return searchMatch && statusMatch && columnFilterMatch;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];

    // handle firestore timestamp-like objects
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

  // Column Menu component (right-side)
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
              prev.includes(columnKey) ? prev.filter((p) => p !== columnKey) : [...prev, columnKey]
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
              type="text"
              autoFocus
              value={curFilter}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, [columnKey]: e.target.value }))}
              placeholder="Type & press enter"
              style={{ ...styles.filterInput, flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && setOpenMenuFor(null)}
            />
            {curFilter && (
              <button
                onClick={() => setColumnFilters((prev) => ({ ...prev, [columnKey]: "" }))}
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
          // include dynamic fields
          ...dynamicCols.map((c) => ({ key: c.key, label: c.label })),
          { key: "firstPaymentDate", label: "1st Payment Date" },
          { key: "secondPaymentDate", label: "2nd Payment Date" },
          { key: "thirdPaymentDate", label: "3rd Payment Date" },
          { key: "fourthPaymentDate", label: "4th Payment Date" },
        ]
      : [
          // selected visible columns (map to objects)
          ...visibleCols,
          ...dynamicCols.filter((d) => visibleColumns.includes(d.key)),
          { key: "firstPaymentDate", label: "1st Payment Date" },
          { key: "secondPaymentDate", label: "2nd Payment Date" },
          { key: "thirdPaymentDate", label: "3rd Payment Date" },
          { key: "fourthPaymentDate", label: "4th Payment Date" },
        ];

    const exportData = dataRows.map((r) => {
      const row = {};
      exportCols.forEach((c) => {
        let val = r[c.key];
        if (c.key === "createdAt" && r.createdAt?.toDate) {
          val = r.createdAt.toDate().toLocaleString();
        }
        if (c.key === "updatedAt" && r.updatedAt?.toDate) {
  val = r.updatedAt.toDate().toLocaleString();
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

  // UI helpers
  const openColumnMenu = (e, key) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.top });
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

        <label style={styles.label}>Records Per Page</label>
        <select
          value={perPage}
          onChange={(e) => {
            setPerPage(Number(e.target.value));
            setPage(1);
          }}
          style={styles.dropdown}
        >
          {[10, 20, 30, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} Records Per Page
            </option>
          ))}
        </select>

        <div style={{ marginTop: "auto", color: "#fff", fontSize: 12 }}>
          Tip: Click any row to open and view the Sales Order. Editing allowed for admin only.
        </div>
      </div>

      {/* Main */}
      <div style={styles.mainContent}>
        <div style={styles.headerRow}>
          <h2 style={styles.header}>Sales Orders</h2>

          <div style={{ display: "flex", gap: 10 }}>
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
                  <div style={{ fontWeight: 700, color: "#800000", marginBottom: 6 }}>Show / Hide Columns</div>
                  {DEFAULT_COLUMNS.map((col) => (
                    <label key={col.key} style={styles.manageItem}>
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={(e) =>
                          e.target.checked
                            ? setVisibleColumns((prev) => [...prev, col.key])
                            : setVisibleColumns((prev) => prev.filter((k) => k !== col.key))
                        }
                      />
                      {col.label}
                    </label>
                  ))}

                  {/* dynamic fields will not be removed from table by default in case admin wants them visible,
                      but they are listed here for admin control as well */}
                  {dynamicCols.length > 0 && (
                    <>
                      <div style={{ marginTop: 8, fontWeight: 700, color: "#800000" }}>Additional Fields</div>
                      {dynamicCols.map((col) => (
                        <label key={col.key} style={styles.manageItem}>
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(col.key)}
                            onChange={(e) =>
                              e.target.checked
                                ? setVisibleColumns((prev) => [...prev, col.key])
                                : setVisibleColumns((prev) => prev.filter((k) => k !== col.key))
                            }
                          />
                          {col.label}
                        </label>
                      ))}
                    </>
                  )}

                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button
                      style={{ ...styles.addBtn, flex: 1 }}
                      onClick={() => setVisibleColumns(DEFAULT_COLUMNS.map((c) => c.key).concat(dynamicCols.map((d) => d.key)))}
                    >
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

        {/* TABLE */}
        {/* TABLE */}
{loading ? (
  <p style={{ color: "#800000" }}>Loading sales orders...</p>
) : (
 <div
  style={{
    height: isMobile ? "auto" : "65vh", // desktop scroll, mobile natural
    maxHeight: isMobile ? "50vh" : "auto",
    position: "relative", 
    WebkitOverflowScrolling: "touch",
  }}
>
    <div
      style={{
        ...styles.tableWrapper,
        overflowX: "auto",          // 🔥 horizontal scroll
        WebkitOverflowScrolling: "touch",
      }}
    >
       <div
  style={{
    height: "65vh",
    overflowY: "auto",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch"
  }}
>
      <table style={styles.table}>
        <thead>
          <tr>
    {/* 1️⃣ STATIC COLUMNS (only visible ones) */}
    {DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key)).map((col) => (
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

    {/* 2️⃣ DYNAMIC COLUMNS (admin-added fields) */}
    {dynamicCols
      .filter((c) => visibleColumns.includes(c.key))
      .map((col) => (
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
                      <td style={{ ...styles.td, padding: 20 }} colSpan={visibleCols.length + dynamicCols.length}>
                        No Sales Orders Found
                      </td>
                    </tr>
                  ) : (
                    paged.map((so) => (
                     <tr
  key={so.id}
  style={{ ...styles.tr, cursor: "pointer" }}
  onClick={() => {
    setSelectedSO(so);
    setIsDrawerOpen(true);
  }}
>
  {/* 1️⃣ STATIC COLUMN CELLS */}
  {DEFAULT_COLUMNS
  .filter((c) => visibleColumns.includes(c.key))
  .map((col) => (
    <td key={col.key} style={styles.td}>
      {renderCellValue(so[col.key], col.key)}
    </td>
  ))}

  {/* 2️⃣ DYNAMIC COLUMN CELLS */}
  {dynamicCols
    .filter((c) => visibleColumns.includes(c.key))
    .map((col) => (
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
    fetchSalesOrders();
  }}
  fieldsDef={fieldsDef}
/>
      )}

      {showExportDialog && <ExportDialog />}
    </div>
  );

  // helper used in dynamic cell render
  function renderCellValue(value, colKey) {
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
}

/* styles (same visual language as LeadsDashboard) */
const styles = {
container: {
  display: "flex",
  width: "100%",
  minHeight: "100vh",     // ✅ KEY FIX
  overflow: "hidden",
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
  width: "100%",
  padding: isMobile ? 12 : 28,
  overflowY: "auto",     // ⭐ KEY
  overflowX: "hidden",  // ⭐ KEY
  boxSizing: "border-box",
},
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 2 },
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
    minWidth: 220,
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
  overflowY: "hidden",
  WebkitOverflowScrolling: "touch",
},
  table: {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "auto",     // ⭐ VERY IMPORTANT
  minWidth: "1200px",      // ⭐ forces horizontal scroll on Android
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
  padding: "12px 10px",
  fontSize: 14,
  color: "#333",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 140,       // ⭐ IMPORTANT
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
    width: 260,
    borderRadius: 8,
    zIndex: 99999,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  menuItem: {
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "8px 10px",
    cursor: "pointer",
    color: "#800000",
    fontWeight: 700,
    borderRadius: 6,
  },
  filterGroup: { display: "flex", flexDirection: "column", gap: 6, padding: "6px 0" },
  filterLabel: { fontSize: 13, color: "#800000", opacity: 0.9 },
  filterInput: { border: "1px solid rgba(128,0,0,0.2)", borderRadius: 6, padding: 8 },
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
