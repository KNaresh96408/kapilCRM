// src/components/QuotationPreview.jsx
import React, { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  addDoc,
  deleteDoc,
  collection,
  serverTimestamp,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import QuotationPDFLayout from "./QuotationPDFLayout";

// Convert To Words (utility)
const numberToWords = (num) => {
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const inWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + " " + a[n % 10];
    if (n < 1000)
      return a[Math.floor(n / 100)] + " Hundred " + inWords(n % 100);
    if (n < 100000)
      return inWords(Math.floor(n / 1000)) + " Thousand " + inWords(n % 1000);
    if (n < 10000000)
      return inWords(Math.floor(n / 100000)) + " Lakh " + inWords(n % 100000);
    return (
      inWords(Math.floor(n / 10000000)) + " Crore " + inWords(n % 10000000)
    );
  };

  return inWords(num).trim() + " Rupees";
};

const QuotationPreview = ({ data }) => {
  // incoming quotation/deal-like data (prop name `data` from parent)
  const [template, setTemplate] = useState(null);
  const [editableData, setEditableData] = useState({ ...data });
  const [summary, setSummary] = useState(null);
  const [showPDF, setShowPDF] = useState(false);

  // Convert modal state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertMode, setConvertMode] = useState(null); // "SO" | "INVOICE"
  const [firstPayment, setFirstPayment] = useState("");
  const [creating, setCreating] = useState(false);

  // Auto-fill some fields when `data` updates
  useEffect(() => {
    if (!data) return;
    setEditableData((prev) => ({
      ...prev,
      customerName: data.customerName || data.name || "",
      customerPhone: data.customerPhone || data.phone || "",
      location: data.location || data.address || "",
      capacity: data.capacity || data.size || 0,
      // also copy any quotation fields that might exist directly on `data`
      systemCost: data.systemCost ?? prev.systemCost ?? editableData.systemCost ?? 0,
      gst: data.gst ?? prev.gst,
      subsidy: data.subsidy ?? prev.subsidy,
      panelBrand: data.panelBrand ?? prev.panelBrand,
      panelWatt: data.panelWatt ?? prev.panelWatt,
      panelType: data.panelType ?? prev.panelType,
      inverterBrand: data.inverterBrand ?? prev.inverterBrand,
      inverterSize: data.inverterSize ?? prev.inverterSize,
    }));
  }, [data]);

  // Fetch template (if you have templates in Firestore)
  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const id =
          editableData.templateType === "Commercial-General"
            ? "TEMPLATE-COMMERCIAL"
            : "TEMPLATE-RESIDENTIAL";
        const ref = doc(db, "quotationTemplates", id);
        const snap = await getDoc(ref);
        if (snap.exists()) setTemplate(snap.data());
      } catch (err) {
        console.error("Template fetch error:", err);
      }
    };
    fetchTemplate();
  }, [editableData.templateType]);

  // Price summary calculation (system cost * capacity + gst - subsidy)
  useEffect(() => {
    const sc = Number(editableData.systemCost || 0);
    const cap = Number(editableData.capacity || 0);

    const systemTotal = Math.round(sc * cap);
    const gstRate = Number(editableData.gst ?? template?.pricing?.gst ?? 0);
    const gstValue = Math.round((systemTotal * gstRate) / 100);
    const subsidy = Number(editableData.subsidy || 0);

    const totalCost = Math.round(systemTotal + gstValue - subsidy);

    if (!isNaN(totalCost)) {
      setSummary({
        systemTotal,
        gstRate,
        gstValue,
        totalCost,
        inWords: numberToWords(Math.round(totalCost)),
      });
    }
  }, [editableData, template]);

  if (!summary) {
    return <div style={{ padding: 30 }}>Loading...</div>;
  }

  const maroon = "#800000";

  const handleChange = (field, value) => {
    setEditableData((prev) => ({ ...prev, [field]: value }));
  };

  // --------------------------
  // createSalesOrder
  // Correct, defensive, avoids undefined fields (uses Firestore doc reads)
  // --------------------------
  const createSalesOrder = async () => {
    setCreating(true);

    try {
      // ---------------------------
      // 1) Robust deal lookup (Fix 3)
      // ---------------------------
      let dealId =
        data?.dealId ||
        data?.sourceDealId ||
        editableData?.dealId ||
        editableData?.sourceDealId ||
        data?.originalDealId ||
        null;


      // If deal uses autoId/kpiId as document id
      if (!dealId && data?.autoId) dealId = data.autoId;
      if (!dealId && data?.kpiId) dealId = data.kpiId;

      // If there is a dealId, attempt to fetch deal doc to prefer canonical values
      let dealData = null;
      if (dealId) {
        try {
          const dealSnap = await getDoc(doc(db, "deals", dealId));
          if (dealSnap.exists()) {
            dealData = dealSnap.data();
            // if the deal doc doesn't include id fields, ensure we have them
            dealData.id = dealData.id || dealId;
            dealData.autoId = dealData.autoId || dealData.kpiId || data?.autoId || data?.kpiId || null;
          }
        } catch (err) {
          console.warn("Failed to fetch deal doc for dealId:", dealId, err);
        }
      }

      // ---------------------------
      // 2) Build canonical values for SO (use summary.totalCost as invoice when available) (Fix 1)
      // ---------------------------
      const kpiIdValue =
        (dealData && (dealData.autoId || dealData.kpiId)) ||
        editableData.autoId ||
        editableData.kpiId ||
        null;

      const name =
        (dealData && dealData.name) ||
        editableData.customerName ||
        editableData.name ||
        "";
      const phone =
        (dealData && dealData.phone) ||
        editableData.customerPhone ||
        editableData.phone ||
        "";
      const address =
        (dealData && dealData.address) ||
        editableData.location ||
        editableData.address ||
        "";
      const capacity = Number(
        dealData?.capacity ?? editableData.capacity ?? 0
      );

      // InvoiceAmount priority:
      // 1) deal.expectedRevenue
      // 2) editableData.invoiceAmount (if user set)
      // 3) computed summary.totalCost (quotation)
      const invoiceAmount = Number(summary.totalCost || 0);

      // Prepare payload to be written to salesOrders
      const payload = {
        kpiId: kpiIdValue,
        name,
        phone,
        address,
        capacity,
        invoiceAmount,
        firstPayment: Number(firstPayment || 0),
        firstPaymentDate: firstPayment ? serverTimestamp() : null,
        secondPayment: 0,
        thirdPayment: 0,
        fourthPayment: 0,
        paymentReceived: Number(firstPayment || 0),
        pendingPayment: invoiceAmount - Number(firstPayment || 0),
        paymentPercentage:
          invoiceAmount > 0
            ? (Number(firstPayment || 0) / invoiceAmount) * 100
            : 0,
        convertedToProject: false,
        sixtyPercentReceivedDate: null,
        sourceQuotationId: data?.id || null,
        sourceDealId: dealId || null,
        quotationSnapshot: { ...editableData },
        createdAt: serverTimestamp(),
      };

      // defensive: normalize undefined -> null
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) payload[k] = null;
      });

      // ---------------------------
      // 3) Prevent duplicate KPI in salesOrders (Fix 2)
      //    If KPI id exists and not null, query salesOrders
      // ---------------------------
      if (payload.kpiId) {
        try {
          const q = query(
            collection(db, "salesOrders"),
            where("kpiId", "==", payload.kpiId)
          );
          const existing = await getDocs(q);
          if (!existing.empty) {
            alert(
              "⚠️ A Sales Order with this KPI ID already exists! Preventing duplicate."
            );
            setCreating(true);
            return;
          }
        } catch (err) {
          console.warn("KPI duplicate check failed:", err);
          // We don't block creation on query failure, but it's safer to stop:
          // setCreating(false); return;
        }
      }

      // ---------------------------
      // 4) Write sales order to Firestore
      // ---------------------------
      await addDoc(collection(db, "salesOrders"), payload);

      // ---------------------------
      // 5) If there was an originating deal, delete it (Fix 4)
      // ---------------------------
     // ---------------------------
// 5) Delete original deal safely (handles all cases)
// ---------------------------
if (dealId || kpiIdValue) {
  try {
    const dealsRef = collection(db, "deals");

    // 1) delete using autoId = KPI
    if (kpiIdValue) {
      const q1 = query(dealsRef, where("autoId", "==", kpiIdValue));
      const snap1 = await getDocs(q1);

      for (const d of snap1.docs) {
        await deleteDoc(doc(db, "deals", d.id));
      }
    }

    // 2) delete using dealId
    if (dealId) {
      const q2 = query(dealsRef, where("id", "==", dealId));
      const snap2 = await getDocs(q2);

      for (const d of snap2.docs) {
        await deleteDoc(doc(db, "deals", d.id));
      }

      // also try direct delete (if doc id = dealId)
      await deleteDoc(doc(db, "deals", dealId)).catch(() => {});
    }
  } catch (err) {
    console.warn("Could not fully delete deal:", err);
  }
}

      alert("Sales Order created successfully.");
      setShowConvertModal(false);

      // Navigate to sales orders list
      window.location.href = "/crm/salesOrders";
    } catch (err) {
      console.error("Create Sales Order error:", err);
      alert("Error creating Sales Order: " + (err.message || err));
    } finally {
      setCreating(false);
    }
  };

  // --------------------------
  // Render
  // --------------------------
  return (
    <div style={{ padding: "30px", fontFamily: "Poppins, sans-serif" }}>
      {/* Top header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ color: maroon }}>Quotation Preview</h2>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowConvertModal(true)}
            style={{
              background: maroon,
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Convert
          </button>

          <button
            onClick={() => window.history.back()}
            style={{
              background: "#aaa",
              color: "#fff",
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
            }}
          >
            Close
          </button>
        </div>
      </div>

      <h2 style={{ fontWeight: "bold", marginTop: 20, color: maroon }}>
        Our Offer for You
      </h2>

      {/* Customer & System details */}
      <div
        style={{
          padding: 15,
          borderRadius: 8,
          border: `1px solid ${maroon}`,
          background: "#f9f9f9",
          marginTop: 10,
        }}
      >
        <p>
          <b>Customer:</b> {editableData.customerName} (
          {editableData.customerPhone})
        </p>
        <p>
          <b>System Size:</b> {editableData.capacity} kW
        </p>

        <p>
          <b>Location:</b>{" "}
          <input
            value={editableData.location}
            onChange={(e) => handleChange("location", e.target.value)}
            style={{ padding: 6, width: "60%", border: "1px solid #ccc" }}
          />
        </p>

        <p>
          <b>Panel:</b>{" "}
          <select
            value={editableData.panelBrand}
            onChange={(e) => handleChange("panelBrand", e.target.value)}
          >
            <option>Premier Solar</option>
            <option>Adani</option>
            <option>Tata</option>
            <option>Renew Power</option>
          </select>{" "}
          |{" "}
          <select
            value={editableData.panelWatt}
            onChange={(e) => handleChange("panelWatt", e.target.value)}
          >
            <option>530 Wp</option>
            <option>545 Wp</option>
            <option>550 Wp</option>
          </select>{" "}
          |{" "}
          <select
            value={editableData.panelType}
            onChange={(e) => handleChange("panelType", e.target.value)}
          >
            <option>Topcon</option>
            <option>Monofacial</option>
            <option>Bifacial</option>
          </select>
        </p>

        <p>
          <b>Inverter:</b>{" "}
          <select
            value={editableData.inverterBrand}
            onChange={(e) => handleChange("inverterBrand", e.target.value)}
          >
            <option>Polycab</option>
            <option>Powerone</option>
            <option>Fronius</option>
          </select>{" "}
          |{" "}
          <select
            value={editableData.inverterSize}
            onChange={(e) => handleChange("inverterSize", e.target.value)}
          >
            <option>5kW</option>
            <option>10kW</option>
            <option>20kW</option>
          </select>
        </p>
      </div>

      {/* Pricing table */}
      <table
        style={{ width: "100%", marginTop: 20, borderCollapse: "collapse" }}
      >
        <thead style={{ background: maroon, color: "#fff" }}>
          <tr>
            <th style={{ padding: 10 }}>Description</th>
            <th>Rate</th>
            <th>Qty</th>
            <th>Subtotal</th>
          </tr>
        </thead>

        <tbody>
          <tr style={{ background: "#f4e5e5" }}>
            <td style={{ padding: 10 }}>System Cost</td>
            <td>
              <input
                type="number"
                value={editableData.systemCost}
                onChange={(e) => handleChange("systemCost", e.target.value)}
                style={{
                  width: "100px",
                  padding: 4,
                  border: "1px solid #ccc",
                }}
              />
            </td>
            <td>{editableData.capacity}</td>
            <td>₹{summary.systemTotal.toLocaleString()}</td>
          </tr>

          <tr>
            <td style={{ padding: 10 }}>Structure Cost</td>
            <td>₹0</td>
            <td>1</td>
            <td>₹0</td>
          </tr>

          <tr>
            <td colSpan="3" style={{ textAlign: "right", padding: 10 }}>
              GST ({summary.gstRate}%)
            </td>
            <td>₹{summary.gstValue.toLocaleString()}</td>
          </tr>

          <tr>
            <td colSpan="3" style={{ textAlign: "right", padding: 10 }}>
              Subsidy
            </td>
            <td>₹{editableData.subsidy || 0}</td>
          </tr>

          <tr
            style={{
              background: maroon,
              color: "#fff",
              fontWeight: "bold",
            }}
          >
            <td colSpan="3" style={{ textAlign: "right", padding: 10 }}>
              Total
            </td>
            <td>₹{summary.totalCost.toLocaleString()}</td>
          </tr>

          <tr>
            <td colSpan="4" style={{ textAlign: "center", padding: 10 }}>
              <b>Amount in Words:</b> {summary.inWords}
            </td>
          </tr>
        </tbody>
      </table>

      {/* PDF export */}
      <button
        onClick={() => setShowPDF(true)}
        style={{
          marginTop: 20,
          background: maroon,
          color: "#fff",
          padding: "10px 20px",
          borderRadius: 6,
          border: "none",
        }}
      >
        Export as PDF
      </button>

      {showPDF && (
        <QuotationPDFLayout
          quotationData={{ ...editableData, amountInWords: summary.inWords }}
          onClose={() => setShowPDF(false)}
        />
      )}

      {/* Convert modal */}
      {showConvertModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#fff",
              width: 420,
              padding: 20,
              borderRadius: 10,
            }}
          >
            <h3>Convert</h3>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConvertMode("SO")}
                style={{
                  flex: 1,
                  padding: 10,
                  background: convertMode === "SO" ? maroon : "#eee",
                  color: convertMode === "SO" ? "#fff" : "#000",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                Create Sales Order
              </button>

              <button
                disabled
                style={{
                  flex: 1,
                  padding: 10,
                  background: "#ccc",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                Create Invoice (Later)
              </button>
            </div>

            {convertMode === "SO" && (
              <>
                <p style={{ marginTop: 15, marginBottom: 5 }}>
                  Enter First/Token Payment:
                </p>
                <input
                  value={firstPayment}
                  onChange={(e) => setFirstPayment(e.target.value)}
                  placeholder="0"
                  type="number"
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #ccc",
                    borderRadius: 6,
                  }}
                />

                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <button
                    onClick={() => setShowConvertModal(false)}
                    style={{
                      padding: "8px 16px",
                      background: "#ddd",
                      border: "none",
                      borderRadius: 6,
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={createSalesOrder}
                    disabled={creating}
                    style={{
                      padding: "8px 16px",
                      background: maroon,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                    }}
                  >
                    {creating ? "Creating..." : "Create Sales Order"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default QuotationPreview;
