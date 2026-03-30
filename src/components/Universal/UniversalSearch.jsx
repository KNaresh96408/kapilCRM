import React, { useState, useEffect, useRef } from "react";
import { db } from "../../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
} from "firebase/firestore";

export default function UniversalSearch({ onNavigate }) {
  const [queryText, setQueryText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [modules, setModules] = useState([]);
  const timerRef = useRef(null);

  // ------------------------------------------
  // Load module list
  // ------------------------------------------
  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    try {
      const rows = await import('../../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('crm_modules'));
      const arr = rows.map((r) => ({ id: r.id, ...r }));
      setModules(arr);
    } catch (e) {
      console.error("UniversalSearch: failed to load modules (fallback)", e);
      setModules([]);
    }
  };

  // ------------------------------------------
  // Search logic
  // ------------------------------------------
  const runSearch = async (text) => {
    if (!text || text.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    const qLower = text.trim().toLowerCase();

    // FIRST TRY search index
    try {
      const idxRef = collection(db, "search_index");
      const q = query(
        idxRef,
        orderBy("searchableText"),
        where("searchableText", ">=", qLower),
        where("searchableText", "<=", qLower + "\uf8ff"),
        limit(40)
      );

      const snap = await getDocs(q);
      if (!snap.empty) {
        const groups = {};

        snap.forEach((d) => {
          const data = d.data();
          let mod = data.moduleApiName || data.moduleName?.toLowerCase();

// ⭐ NORMALIZE moduleApi to exact CRM routing
if (mod === "salesorders" || mod === "sales-orders" || mod === "sales_orders" || mod === "salesorder") {
    mod = "salesOrders";   // 🔥 final correct moduleApi
}

          if (!groups[mod])
            groups[mod] = { moduleApi: mod, moduleName: data.moduleName, hits: [] };

          groups[mod].hits.push({
            id: data.recordId,
            title: data.title,
            snippet: data.snippet,
          });
        });

        setResults(Object.values(groups));
        setLoading(false);
        return;
      }
    } catch (_) {}

    // FALLBACK search in each module
    const output = [];

    for (const m of modules) {
// Firestore collection name should come from moduleApiName (correct, code-safe)
let colName = m.moduleApiName || m.moduleName;

if (colName === "salesorders" || colName === "SalesOrders" || colName === "sales-orders") {
    colName = "salesOrders";   // perfect match with Firestore collection
}

// Priority: exact collection name in Firestore
const colRef = collection(db, colName);

      try {
        const snap = await getDocs(query(colRef, limit(200)));
        const hits = [];

        snap.forEach((d) => {
          const data = d.data();
          const full = JSON.stringify(data).toLowerCase();

          if (full.includes(qLower)) {
            const idx = full.indexOf(qLower);
            const snippet = full.substring(Math.max(0, idx - 30), idx + 80);

            hits.push({
              id: d.id,
              title:
                data.title ||
                data.name ||
                data.customerName ||
                data.kpiId ||
                "Record",
              snippet,
            });
          }
        });

        if (hits.length > 0) {
          output.push({
            moduleApi: colName,
            moduleName: m.displayName || colName,
            hits,
          });
        }
      } catch (_) {}
    }

    setResults(output);
    setLoading(false);
  };

  // Debounce
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(queryText), 350);
    return () => clearTimeout(timerRef.current);
  }, [queryText]);

  const handleClick = (moduleApi, recordId) => {
    if (onNavigate) onNavigate(moduleApi, recordId);
  };

  // ------------------------------------------
  // UI
  // ------------------------------------------
  return (
    <div
      className="relative"
      style={{
        width: "100%",
        zIndex: 99999, // ⭐ TOP PRIORITY
      }}
    >
      {/* Search box */}
      <div
        className="flex items-center gap-2 bg-white border rounded px-2 py-1"
        style={{
          borderColor: "#888",
          zIndex: 99999, // ⭐ Make sure dropdown appears below
          position: "relative",
        }}
      >
        <span style={{ fontSize: 20, marginRight: 4 }}>🔎</span>

        <input
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search across CRM (e.g., KPI-007, name, phone...)"
          style={{
            flex: 1,
            outline: "none",
            border: "none",
            padding: "6px",
            fontSize: "14px",
            color: "#000",
          }}
        />

        {loading && <span style={{ fontSize: "12px", color: "#666" }}>Searching…</span>}
      </div>

      {/* Results dropdown */}
      {queryText.trim().length >= 2 && (
        <div
  className="absolute bg-white border rounded shadow-lg"
  style={{
    width: "100%",
    top: "100%",        // ⭐ sits exactly below the search box
    marginTop: "6px",   // ⭐ small gap between input & results
    left: 0,
    zIndex: 9999999,
    maxHeight: "300px",
    overflowY: "auto",
    borderColor: "#aaa",
    position: "absolute",
  }}
>
          {results.length === 0 && !loading ? (
            <div style={{ padding: 10, color: "#666", fontSize: "14px" }}>
              No results
            </div>
          ) : (
            results.map((group) => (
              <div key={group.moduleApi}>
                <div
                  style={{
                    padding: "8px 10px",
                    background: "#f7f7f7",
                    fontWeight: 600,
                    fontSize: "14px",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {group.moduleName}
                </div>

                {group.hits.map((h) => (
                  <div
                    key={h.id}
                    onClick={() => handleClick(group.moduleApi, h.id)}
                    style={{
                      padding: "8px 10px",
                      cursor: "pointer",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f5f5f5")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "white")
                    }
                  >
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>
                      {h.title}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#777",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {h.snippet}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
