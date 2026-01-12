// ✅ src/components/DealsDashboard.jsx (WITH DYNAMIC COLUMNS ADDED - B1 / All support)
// NOTE: Additive-only changes — your existing logic is untouched.

import React, { useEffect, useRef, useState } from "react";
import { db, storage } from "../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import * as XLSX from "xlsx";
import { useLocation, useNavigate } from "react-router-dom";

import DealDrawer from "./DealDrawer";
import QuotationDrawer from "./QuotationDrawer";
import QuotationPreview from "./QuotationPreview";
import { usePermission } from "../hooks/usePermission";
import { getScopedQuery } from "../helpers/getScopedQuery";


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

  // KEEP ONLY ONE CONSULTANT FIELD
  { key: "assignedConsultant", label: "Assigned Consultant" },
  { key: "siteVisitArrangedDate", label: "Site Visit Arranged Date" },

  { key: "capacity", label: "Capacity (kW)" },
  { key: "expectedRevenue", label: "Expected Revenue (₹)" },
  { key: "stage", label: "Stage" },
  { key: "createdAt", label: "Created At" },

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

const isMobile = window.innerWidth <= 768;

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

  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

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
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

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

  /* ---------------------------
     Helpers
     --------------------------- */
  const formatCurrency = (v) =>
    typeof v === "number" ? `₹ ${v.toLocaleString()}` : v;

  // Safe cell renderer for dynamic columns (timestamps, arrays, objects)
  const renderCellValue = (value, colKey) => {
    // 🔗 Design Link (clickable, read-only)
if ((colKey === "designLink" || colKey === "designlink") && value) {
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
      Open Design
    </a>
  );
}
    if (value?.seconds && value?.nanoseconds && typeof value.toDate === "function") {
      return value.toDate().toLocaleDateString("en-GB");
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
const fetchDeals = async () => {
  setLoading(true);
  try {

    // 1️⃣ FETCH USERS (KEEP AS IS)
    const usersSnap = await getDocs(collection(db, "Users"));
    const userMap = {};
    usersSnap.forEach(u => {
      const d = u.data();
      if (d.email && d.Name) {
        userMap[d.email.trim().toLowerCase()] = d.Name;
      }
    });

    // 2️⃣ FETCH DEALS (ROLE BASED 🔥)
    const q = await getScopedQuery("deals");
    const snap = await getDocs(q);

    const data = snap.docs.map((d) => {
      const raw = d.data() || {};

      const assignedEmail = (raw.assignedConsultant || "")
        .trim()
        .toLowerCase();

      return {
        id: d.id,
        ...raw,

        autoId: raw.autoId || raw.kpiId || "",
        designLink: raw.designLink || raw.designlink || "",

        // ⭐ Consultant name resolved safely
        consultantName: userMap[assignedEmail] || "",

        capacity:
          raw.capacity !== undefined && raw.capacity !== null
            ? raw.capacity
            : "",

        expectedRevenue:
          raw.expectedRevenue !== undefined &&
          raw.expectedRevenue !== null
            ? raw.expectedRevenue
            : "",
      };
    });

    // Deduplicate (KEEP)
    const uniqueByDocId = {};
    for (const d of data) uniqueByDocId[d.id] = d;

    setDeals(Object.values(uniqueByDocId));
  } catch (err) {
    console.error("❌ Error fetching deals:", err);
    setDeals([]);
  } finally {
    setLoading(false);
  }
};

  useEffect(() => {
    fetchDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ⭐ AUTO-OPEN DEAL DRAWER WHEN ?open=ID COMES FROM UNIVERSAL SEARCH
// ⭐ AUTO-OPEN DEAL DRAWER WHEN ?open=ID COMES FROM UNIVERSAL SEARCH
useEffect(() => {
  if (!location.pathname.includes("/deals")) return;

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
}, [location.pathname, location.search, deals]);

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
          const dyn = normalized
            .map((fd) => ({ key: fd.name, label: fd.label || prettyLabel(fd.name) }))
            .filter((dc) => !defaultKeySet.has(dc.key) && dc.key !== "id");
          setDynamicCols(dyn);

          // Ensure dynamic columns are visible by default (append to visibleColumns if missing)
          setVisibleColumns((prev) => {
            const next = [...prev];
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
    const matchStage = stageFilter === "all" || (d.stage || "") === stageFilter;
    return matchSearch && matchStage;
  });

  /* ---------------------------
     Sorting
     --------------------------- */
  const sortedDeals = [...filteredDeals].sort((a, b) => {
    const getVal = (obj, key) => {
      const v = obj[key];
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
        let val = item[col.key];
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
    const col =
      DEFAULT_COLUMNS.find((c) => c.key === colKey) ||
      dynamicCols.find((c) => c.key === colKey) ||
      { key: colKey, label: colKey };
    const left = Math.min(posX + 8, window.innerWidth - 260);
    const top = Math.min(posY + 6, window.innerHeight - 200);

    const menuStyle = {
      position: "fixed",
      top,
      left,
      width: 260,
      zIndex: 3000,
      background: "#fff",
      border: "1px solid rgba(128,0,0,0.12)",
      borderRadius: 8,
      padding: 12,
      boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
    };

    return (
      <div
        ref={columnMenuRef}
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 700, color: "#800000", marginBottom: 8 }}>
          {col.label}
        </div>

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
              alert(`Pinned column ${col.label} (not implemented)`);
              closeColumnMenu();
            }}
          >
            📌 Pin Column
          </button>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#800000", marginBottom: 6 }}>🔎 Quick filter</div>
          <input
            placeholder="Type & press enter"
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 6,
              border: "1px solid #ddd",
              outline: "none",
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                const term = ev.target.value.trim();
                if (term) setSearchTerm(term);
                closeColumnMenu();
              }
            }}
          />
        </div>

        <div style={{ marginTop: 6 }}>
          <button
            style={styles.menuAction}
            onClick={() => {
              toggleColumn(colKey);
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
    return {
      quotationId: `QTN-${String(new Date().getTime()).slice(-6)}`,
      kpiId: deal.autoId || deal.id,
      projectType: deal.projectType || "Residential",
      customerName: deal.name || "",
      customerPhone: deal.phone || "",
      capacity: deal.capacity || 1,
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
            const preview = {
              ...data.quotation,
              customerName: data.quotation.customerName || data.name || "",
              customerPhone: data.quotation.customerPhone || data.phone || "",
              address: data.quotation.address || "",
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
    setPreviewQuotationData(q);
  };

  const closeQuotationPreview = () => setPreviewQuotationData(null);

  const saveQuotationToFirestore = async (quotationObj) => {
    try {
      if (!quotationObj) throw new Error("No quotation object provided.");

      const docId = quotationObj.dealId;
      if (!docId) throw new Error("Unable to determine deal document id.");

      const dealRef = doc(db, "deals", docId);

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
          ...quotationObj,
          savedAt: serverTimestamp(),
        },

        updatedAt: serverTimestamp(),
      };

      await setDoc(dealRef, updatePayload, { merge: true });

      await fetchDeals();

      alert("✅ Quotation saved inside deal document.");
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
        <div style={{ display: "flex", gap: 8 }}>
          <select
            style={styles.dropdown}
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="Qualification">Qualification</option>
            <option value="Proposal">Proposal</option>
            <option value="Negotiation">Negotiation</option>
            <option value="Closed Won">Closed Won</option>
            <option value="Closed Lost">Closed Lost</option>
          </select>
          <button
            style={{ ...styles.cancelBtn, padding: "6px 8px", whiteSpace: "nowrap" }}
            onClick={() => setStageFilter("all")}
            title="Clear stage"
          >
            Clear
          </button>
        </div>

        <label style={styles.label}>Records per page</label>
        <select
          style={styles.dropdown}
          value={perPage}
          onChange={(e) => {
            setPerPage(Number(e.target.value));
            setPage(1);
          }}
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {/* Main */}
      <div style={styles.main}>
        <div style={styles.headerRow}>
          <h2 style={styles.header}>All Deals</h2>

          {/* spacer pushes buttons to right */}
          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
                  <p style={{ color: "#800000", fontWeight: "bold" }}>
                    Show / Hide Columns
                  </p>

                  {/* existing default columns */}
                  {DEFAULT_COLUMNS.map((col) => (
                    <label key={col.key} style={styles.dropdownItem}>
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                      />{" "}
                      {col.label}
                    </label>
                  ))}

                  {/* dynamic columns (admin-driven) */}
                  {dynamicCols.length > 0 && (
                    <>
                      <div style={{ marginTop: 8, fontWeight: 700, color: "#800000" }}>
                        Additional Fields
                      </div>
                      {dynamicCols.map((col) => (
                        <label key={col.key} style={styles.dropdownItem}>
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(col.key)}
                            onChange={() => toggleColumn(col.key)}
                          />{" "}
                          {col.label}
                        </label>
                      ))}
                    </>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button style={{ ...styles.addBtn, flex: 0.6 }} onClick={unhideAllColumns}>
                      Unhide All
                    </button>
                    <button style={{ ...styles.cancelBtn, flex: 0.4 }} onClick={() => setShowManageCols(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

{/* Table */}
{loading ? (
  <p style={{ color: "#800000" }}>Loading deals...</p>
) : pagedDeals.length === 0 ? (
  <p style={{ color: "#800000" }}>No deals found.</p>
) : (
  <div>

     <div
  style={{
    height: "65vh",
    overflowY: "auto",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch"
  }}
>
    {/* TABLE SCROLL CONTAINER */}
    <div style={styles.tableWrapper}>
      <table style={styles.table}>
        <thead>
          <tr>
            {/* Render DEFAULT columns (only those visible) */}
            {DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key)).map((col) => (
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

            {/* ⭐ APPEND DYNAMIC COLUMNS */}
            {dynamicCols
              .filter((c) => visibleColumns.includes(c.key))
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
              onClick={() => setDrawerDeal(dealRow)}
            >
              {/* DEFAULT columns cells */}
{DEFAULT_COLUMNS.filter((c) => visibleColumns.includes(c.key)).map((col) => (
  <td key={col.key} style={styles.td}>
    {renderCellValue(dealRow[col.key], col.key)}
  </td>
))}

              {/* DYNAMIC columns cells */}
              {dynamicCols
                .filter((c) => visibleColumns.includes(c.key))
                .map((col) => (
                  <td key={col.key} style={styles.td}>
                    {renderCellValue(dealRow[col.key], col.key)}
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
    </div>

    {/* PAGINATION (OUTSIDE TABLE SCROLL) */}
    <div style={styles.pagination}>
      <span>
        {sortedDeals.length === 0 ? 0 : startIdx + 1}–
        {Math.min(startIdx + perPage, sortedDeals.length)} of {sortedDeals.length}
      </span>

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
      onDealSaved={fetchDeals}
      refreshDeals={fetchDeals} 
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ color: "#800000" }}>Quotation Preview</h3>
              <button style={styles.cancelBtn} onClick={closeQuotationPreview}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <QuotationPreview data={previewQuotationData} />
            </div>
          </div>
        </div>
      )}
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
  overflow: "hidden",     // prevent double scroll
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
  width: "100%",
  overflowX: "auto",
  overflow: "hidden",      // ⭐ ADD THIS
  minHeight: 0,            // ⭐ ADD THIS (VERY IMPORTANT)
  WebkitOverflowScrolling: "touch",
  boxSizing: "border-box",
},
  headerRow: { display: "flex", alignItems: "center", gap: 8 },
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

  dropdownMenu: {
    position: "absolute",
    top: "110%",
    right: 0,
    background: "#fff",
    border: "1px solid #800000",
    borderRadius: 8,
    padding: 12,
    zIndex: 1000,
    width: 240,
  },

  dropdownItem: { display: "block", color: "#800000", marginBottom: 6 },

tableWrapper: {
  width: "100%",
  maxHeight: "60vh",        // ⭐ FIXED HEIGHT
  overflowY: "auto",        // ⭐ VERTICAL SCROLL HERE
  overflowX: "auto",
  borderRadius: 8,
  position: "relative",
  zIndex: 1,
  WebkitOverflowScrolling: "touch",
},
  table: { width: "100%", borderCollapse: "collapse" },

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
  padding: "8px 6px",
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
    background: "transparent",
    border: "none",
    color: "#800000",
    fontWeight: 700,
    cursor: "pointer",
  },

  menuAction: {
    width: "100%",
    textAlign: "left",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #eee",
    background: "#fff",
    cursor: "pointer",
    color: "#800000",
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
