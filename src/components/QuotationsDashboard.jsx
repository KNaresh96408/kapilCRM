import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import QuotationPreview from "./QuotationPreview";

const QuotationsDashboard = () => {
  const [quotations, setQuotations] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");
  const [loading, setLoading] = useState(true);
  const maroon = "#800000";

  // 🔹 Fetch quotations from Firestore
  useEffect(() => {
    const fetchQuotations = async () => {
      try {
        const snapshot = await getDocs(collection(db, "quotations"));
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setQuotations(data);
        setFiltered(data);
      } catch (err) {
        console.error("Error loading quotations:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchQuotations();
  }, []);

  // 🔹 Search filter
  useEffect(() => {
    if (!search.trim()) {
      setFiltered(quotations);
      return;
    }

    const query = search.toLowerCase();
    setFiltered(
      quotations.filter(
        (q) =>
          q.id.toLowerCase().includes(query) ||
          (q.customerName || "").toLowerCase().includes(query) ||
          (q.dealId || "").toLowerCase().includes(query)
      )
    );
  }, [search, quotations]);

  // 🔹 Sorting logic
  const handleSort = (field) => {
    const order = sortField === field && sortOrder === "asc" ? "desc" : "asc";
    setSortField(field);
    setSortOrder(order);

    const sorted = [...filtered].sort((a, b) => {
      if (a[field] < b[field]) return order === "asc" ? -1 : 1;
      if (a[field] > b[field]) return order === "asc" ? 1 : -1;
      return 0;
    });

    setFiltered(sorted);
  };

  // 🔹 Delete quotation
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this quotation permanently?")) return;
    await deleteDoc(doc(db, "quotations", id));
    setQuotations((prev) => prev.filter((q) => q.id !== id));
    setFiltered((prev) => prev.filter((q) => q.id !== id));
  };

  // 🔹 Edit inline fields (customer name only)
  const handleEdit = async (id, field, value) => {
    await updateDoc(doc(db, "quotations", id), { [field]: value });
    setQuotations((prev) =>
      prev.map((q) => (q.id === id ? { ...q, [field]: value } : q))
    );
    setFiltered((prev) =>
      prev.map((q) => (q.id === id ? { ...q, [field]: value } : q))
    );
  };

  if (loading) return <p style={{ padding: 20 }}>Loading quotations...</p>;

  return (
    <div style={{ padding: "30px", fontFamily: "Poppins" }}>
      <h2 style={{ color: maroon, fontWeight: "bold" }}>Quotation Management</h2>

      {/* 🔍 Search Bar */}
      <div style={{ margin: "15px 0", display: "flex", gap: "10px" }}>
        <input
          type="text"
          placeholder="Search by Quotation ID, Customer, or Deal ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "6px",
            border: `1px solid ${maroon}`,
            fontSize: "14px",
          }}
        />
      </div>

      <div className="table-wrapper">
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      marginTop: "20px",
      fontSize: "14px",
      background: "#fff",
    }}
  >
        <thead style={{ background: maroon, color: "#fff" }}>
          <tr>
            <th style={{ padding: "10px", cursor: "pointer" }} onClick={() => handleSort("id")}>
              Quotation ID {sortField === "id" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th style={{ padding: "10px" }}>Customer</th>
            <th
              style={{ padding: "10px", cursor: "pointer" }}
              onClick={() => handleSort("capacity")}
            >
              Capacity (kW) {sortField === "capacity" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th
              style={{ padding: "10px", cursor: "pointer" }}
              onClick={() => handleSort("systemCost")}
            >
              System Cost {sortField === "systemCost" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th style={{ padding: "10px" }}>Linked Deal</th>
            <th style={{ padding: "10px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: "center", padding: "20px" }}>
                No quotations found.
              </td>
            </tr>
          ) : (
            filtered.map((q) => (
              <tr key={q.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px", fontWeight: 600 }}>{q.id}</td>
                <td style={{ padding: "10px" }}>
                  <input
                    value={q.customerName || ""}
                    onChange={(e) =>
                      handleEdit(q.id, "customerName", e.target.value)
                    }
                    style={{
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      padding: "4px",
                      width: "100%",
maxWidth: "160px",
                    }}
                  />
                </td>
                <td style={{ padding: "10px" }}>{q.capacity}</td>
                <td style={{ padding: "10px" }}>₹{q.systemCost}</td>
                <td style={{ padding: "10px" }}>{q.dealId || "-"}</td>
                <td style={{ padding: "10px" }}>
                  <button
                    onClick={() => setSelectedQuotation(q)}
                    style={{
                      background: maroon,
                      color: "#fff",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginRight: "6px",
                    }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDelete(q.id)}
                    style={{
                      background: "#ccc",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>

      {selectedQuotation && (
        <QuotationPreview data={selectedQuotation} />
      )}
    </div>
  );
};

export default QuotationsDashboard;
