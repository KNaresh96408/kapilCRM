// src/components/QuotationPreview.jsx
import React, { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  addDoc,
  updateDoc,  
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import QuotationPDFLayout from "./QuotationPDFLayout";
import { usePermission } from "../hooks/usePermission";
import { useNavigate } from "react-router-dom";
import { getKpiIdFromRecord, resolveQuoteNo } from "../helpers/quotationNumber";



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

const projectExistsByKpi = async (kpiId) => {
  const cleanKpi = String(kpiId || "").trim();
  if (!cleanKpi) return false;
  const q = query(collection(db, "projects"), where("kpiId", "==", cleanKpi));
  const snap = await getDocs(q);
  return !snap.empty;
};

const QuotationPreview = ({ data, onClose, onSaveQuotation }) => {
const perm = usePermission("sales-orders");

  // incoming quotation/deal-like data (prop name `data` from parent)
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [editableData, setEditableData] = useState({ ...data });
  const [summary, setSummary] = useState(null);
  const [showPDF, setShowPDF] = useState(false);
  const [savingQuotation, setSavingQuotation] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  // Convert modal state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertMode, setConvertMode] = useState("SO"); // "SO" | "INVOICE"
  const [firstPayment, setFirstPayment] = useState("");
  const [creating, setCreating] = useState(false);

  // Auto-fill some fields when `data` updates
  useEffect(() => {
    if (!data) return;
    setEditableData((prev) => {
      const resolvedCapacity = Number(data.capacity ?? data.size ?? prev.capacity ?? 0) || 0;
      const resolvedSystemQty = Number(data.systemQty ?? data.capacity ?? prev.systemQty ?? resolvedCapacity) || 1;
      const resolvedStructureRate = Number(data.structureRate ?? prev.structureRate ?? 0) || 0;
      const resolvedStructureQty =
        resolvedStructureRate > 0
          ? Number(data.structureQty ?? prev.structureQty ?? 0)
          : 0;
      return {
      ...prev,
      customerName: data.customerName || data.name || "",
      customerPhone: data.customerPhone || data.phone || "",
      location: data.location || data.address || "",
      capacity: resolvedCapacity,
      systemQty: resolvedSystemQty,
      gst: data.gst ?? 8.9,
      // also copy any quotation fields that might exist directly on `data`
      systemCost: data.systemCost ?? prev.systemCost ?? editableData.systemCost ?? 0,
      structureRate: resolvedStructureRate,
      structureQty: Number.isFinite(resolvedStructureQty) ? resolvedStructureQty : 0,
      panelBrand: data.panelBrand ?? prev.panelBrand,
      panelWatt: data.panelWatt ?? prev.panelWatt,
      panelType: data.panelType ?? prev.panelType,
      inverterBrand: data.inverterBrand ?? prev.inverterBrand,
      inverterSize:
        prev.inverterSize ??
        data.inverterSize ??
        resolvedCapacity ??
        1,
      };
    });
  }, [data]);

  useEffect(() => {
    setHasSaved(Boolean(data?.isSaved || data?.savedAt || data?.createdAt));
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
  const systemRate = Number(editableData.systemCost || 0);
  const systemQty = Number(editableData.systemQty || editableData.capacity || 0);
  const systemTotal = systemRate * systemQty;

  const structureRate = Number(editableData.structureRate || 0);
  const structureQty = Number(editableData.structureQty || 0);
  const structureTotal = structureRate * structureQty;

  const taxableAmount = systemTotal + structureTotal;

  const gstRate = Number(editableData.gst ?? 8.9) || 0;
  const gstValue = Math.round((taxableAmount * gstRate) / 100);

  const totalCost = Math.round(taxableAmount + gstValue);

  setSummary({
    systemTotal,
    structureTotal,
    gstRate,
    gstValue,
    totalCost,
    inWords: numberToWords(totalCost),
  });
}, [editableData]);
const handleChange = (field, value) => {
  setEditableData((prev) => ({ ...prev, [field]: value }));
};
// 🔥 Auto-sync inverter size with capacity (only if empty)
useEffect(() => {
  setEditableData((prev) => {
    if (prev.inverterSize !== undefined && prev.inverterSize !== "") {
      return prev; // user already edited
    }
    return {
      ...prev,
      inverterSize: prev.capacity || 1,
    };
  });
}, [editableData.capacity]);

if (perm.loading) {
  return <p style={{ padding: 20, color: "#800000" }}>Checking permissions…</p>;
}

if (!perm.read) {
  return (
    <div style={{ padding: 20, textAlign: "center", color: "#800000" }}>
      <h2>🚫 You don’t have permission to view Sales Orders.</h2>
    </div>
  );
}

if (!summary) {
  return <div style={{ padding: 30 }}>Loading...</div>;
}
const maroon = "#800000";
const caseId = getKpiIdFromRecord(editableData) || getKpiIdFromRecord(data);
const quoteNo = resolveQuoteNo({ ...editableData, kpiId: caseId }) || (caseId ? `Q/No/${caseId}` : "");

  const handleClosePreview = () => {
    if (typeof onClose === "function") {
      onClose();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate("/crm/deals");
  };

  const handleSaveQuotation = async () => {
    if (!caseId) {
      alert("Missing KPI ID. Please save deal first.");
      return;
    }

    const payload = {
      ...editableData,
      kpiId: caseId,
      systemQty: Number(editableData.systemQty || editableData.capacity || 1),
      dealId: editableData?.dealId || data?.dealId || editableData?.createdFromDeal || data?.createdFromDeal || caseId,
      quotationId: quoteNo,
      quoteNo,
      systemTotal: summary?.systemTotal || 0,
      structureTotal: summary?.structureTotal || 0,
      gstRate: summary?.gstRate || 0,
      gstValue: summary?.gstValue || 0,
      totalCost: summary?.totalCost || 0,
      amountInWords: summary?.inWords || "",
    };

    setSavingQuotation(true);
    try {
      if (typeof onSaveQuotation === "function") {
        await onSaveQuotation(payload);
      }
      setHasSaved(true);
      alert("Quotation saved.");
    } catch (err) {
      console.error("Save quotation error:", err);
      alert("Failed to save quotation.");
    } finally {
      setSavingQuotation(false);
    }
  };

  // --------------------------
  // createSalesOrder
  // Correct, defensive, avoids undefined fields (uses Firestore doc reads)
  // --------------------------
  const createSalesOrder = async () => {
    if (!perm.create) {
      alert("You do not have permission to create Sales Orders.");
      return;
    }

    const tokenAmount = Number(firstPayment || 0);
    if (!tokenAmount || tokenAmount <= 0) {
      alert("Please enter token payment amount before creating Sales Order.");
      return;
    }

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
  editableData?.createdFromDeal ||
  data?.createdFromDeal ||
  null;

      // If deal uses autoId/kpiId as document id
      if (!dealId && data?.autoId) dealId = data.autoId;
      if (!dealId && data?.kpiId) dealId = data.kpiId;

      console.log("🔥 FINAL DealId Being Used = ", dealId);


      // If there is a dealId, attempt to fetch deal doc to prefer canonical values
let dealData = null;

try {
  const q = query(
    collection(db, "deals"),
    where("kpiId", "==", data?.kpiId || editableData?.kpiId || dealId)
  );

  const snap = await Promise.race([
    getDocs(q),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('getDocs timeout')), 3000)
    )
  ]);
  
  if (!snap.empty) {
    dealData = snap.docs[0].data();
    console.log("🟢 Deal data fetched via SDK");
  }
} catch (sdkErr) {
  console.warn("⚠️ SDK getDocs timeout for deal fetch, trying REST", sdkErr.message);
  // REST fallback
  try {
    const stored = localStorage.getItem("kp-user");
    const parsed = stored ? JSON.parse(stored) : null;
    const token = parsed?.idToken;
    if (token) {
      const { fetchCollectionREST } = await import("../helpers/firestoreRest");
      const allDeals = await fetchCollectionREST("deals", token);
      const matchingDeal = allDeals.find(d => 
        d.kpiId === (data?.kpiId || editableData?.kpiId || dealId) ||
        d.autoId === (data?.kpiId || editableData?.kpiId || dealId)
      );
      if (matchingDeal) {
        dealData = matchingDeal;
        console.log("🟢 Deal data fetched via REST");
      }
    }
  } catch (restErr) {
    console.log("Deal fetch failed (both SDK and REST)", restErr);
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
        editableData.contactNumber ||
        editableData.customerPhone ||
        editableData.phone ||
        "";
        // --- Tele-Sales & Consultant Name ---
// --- Tele-Sales & Consultant Name ---
const teleSale =
  dealData?.teleSale ||
  editableData.teleSale ||
  "";

const consultantName =
  dealData?.consultantName ??
  data?.consultantName ??
  editableData?.consultantName ??
  "";
  // --- Lead Source ---
const leadSource =
  dealData?.lead_source ||
  editableData?.lead_source ||
  "";

  // --- Sales Hierarchy Fields ---
const salesArea =
  pickScopedDisplay(
    dealData?.sales_area || dealData?.salesArea,
    dealData?.sales_area_label
  ) ||
  pickScopedDisplay(
    editableData.sales_area || editableData.salesArea,
    editableData.sales_area_label
  ) ||
  "";

const salesZone =
  pickScopedDisplay(
    dealData?.sales_zone || dealData?.salesZone,
    dealData?.sales_zone_label
  ) ||
  pickScopedDisplay(
    editableData.sales_zone || editableData.salesZone,
    editableData.sales_zone_label
  ) ||
  "";

const state =
  pickScopedDisplay(dealData?.state, dealData?.state_label) ||
  pickScopedDisplay(editableData.state, editableData.state_label) ||
  "";

const zonalManager =
  dealData?.zonal_manager ||
  dealData?.zonalManager ||
  editableData.zonal_manager ||
  editableData.zonalManager ||
  "";

const projectType =
  dealData?.projectType ||
  editableData?.projectType ||
  "Residential";

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
      const firstPaymentAmount = Math.max(0, Number(firstPayment || 0));
      const pendingPaymentAmount = Math.max(0, invoiceAmount - firstPaymentAmount);
      const paymentPercent = invoiceAmount > 0 ? (firstPaymentAmount / invoiceAmount) * 100 : 0;
      console.log("FINAL teleSale = ", teleSale);
console.log("FINAL consultantName = ", consultantName);
console.log("dealData = ", dealData);
      // Prepare payload to be written to salesOrders
      const payload = {
        kpiId: data?.kpiId || editableData?.kpiId || dealId,
        name,
        phone,
        customerName: dealData?.customer_name || editableData.customerName || name || '',
        customerPhone: phone,
        contactNumber: phone,
        contact_number: phone,
        // Canonical region hierarchy fields (used across SO/Projects/analytics)
        sales_area: salesArea,
        sales_zone: salesZone,
        state,
        zonal_manager: zonalManager,

        // Keep camelCase mirrors for legacy consumers
        salesArea,
        salesZone,
        zonalManager,

        // Preserve original display labels when available
        sales_area_label: dealData?.sales_area_label || editableData?.sales_area_label || salesArea || '',
        sales_zone_label: dealData?.sales_zone_label || editableData?.sales_zone_label || salesZone || '',
        state_label: dealData?.state_label || editableData?.state_label || state || '',
        teleSale: dealData?.teleSale || editableData.teleSale || '',
        assignedConsultant:
          dealData?.assignedConsultant ||
          data?.assignedConsultant ||
          editableData?.assignedConsultant ||
          "",
        consultantName: dealData?.consultantName ?? data?.consultantName ?? editableData?.consultantName ?? '',
        projectType,
        paymentMode: dealData?.paymentMode || editableData?.paymentMode || "",
        description: dealData?.description || editableData?.description || "",
        address: (dealData && dealData.address) || editableData.location || editableData.address || '',
        capacity: Number(dealData?.capacity ?? editableData.capacity ?? 0),
        invoiceAmount,
        firstPayment: firstPaymentAmount,
        paymentReceived: firstPaymentAmount,
        pendingPayment: pendingPaymentAmount,
        paymentPercentage: Number(paymentPercent.toFixed(2)),
        firstPaymentDate: firstPaymentAmount > 0 ? serverTimestamp() : null,
        tokenPayment: firstPaymentAmount,
        leadSource: dealData?.lead_source || editableData?.lead_source || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Add other fields as needed
      };
      try {
        const q = query(
          collection(db, "deals"),
          where("kpiId", "==", data?.kpiId || editableData?.kpiId || dealId)
        );

        const snap = await getDocs(q);
        if (!snap.empty) {
          dealData = snap.docs[0].data();
        }
      } catch (err) {
        console.log("Deal fetch failed", err);
      }
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
            setCreating(false);
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
      payload.attachments = dealData?.attachments || [];
      const salesOrderRef = await addDoc(collection(db, "salesOrders"), payload);

      const shouldAutoConvertToProject = Number(payload.paymentPercentage || 0) >= 60;
      if (shouldAutoConvertToProject) {
        try {
          const exists = await projectExistsByKpi(payload.kpiId);
          if (!exists) {
            const rawState = pickScopedDisplay(payload.state, payload.state_label);
            const rawZone = pickScopedDisplay(payload.sales_zone, payload.sales_zone_label);
            const rawArea = pickScopedDisplay(payload.sales_area, payload.sales_area_label);
            const sixtyDate = new Date();

            await addDoc(collection(db, "projects"), {
              kpiId: payload.kpiId,
              name: payload.name || "",
              phone: payload.phone || "",
              address: payload.address || "",
              projectType: payload.projectType || "Residential",
              capacity: Number(payload.capacity || 0),
              invoiceAmount: Number(payload.invoiceAmount || 0),
              totalReceived: Number(payload.paymentReceived || 0),
              pending: Number(payload.pendingPayment || 0),
              paymentPercentage: Number(payload.paymentPercentage || 0),
              salesOrderId: salesOrderRef.id,
              sixtyPercentReceivedDate: sixtyDate,
              sixtyPercentDate: sixtyDate,
              state: normalizeScopeValue(rawState),
              sales_zone: normalizeScopeValue(rawZone),
              sales_area: normalizeScopeValue(rawArea),
              state_label: rawState || "",
              sales_zone_label: rawZone || "",
              sales_area_label: rawArea || "",
              zonal_manager: payload.zonal_manager || "",
              teleSale: payload.teleSale || "",
              consultantName: payload.consultantName || "",
              assignedConsultant: payload.assignedConsultant || "",
              createdAt: serverTimestamp(),
            });

            await updateDoc(doc(db, "salesOrders", salesOrderRef.id), {
              status: "Converted",
              convertedToProject: true,
              sixtyPercentReceived: "YES",
              sixtyPercentReceivedDate: sixtyDate,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (projectErr) {
          console.warn("Auto project conversion failed:", projectErr?.message || projectErr);
        }
      }
      // ✅ MARK DEAL AS WON (DO NOT DELETE) — safe, non-blocking
      try {
        const resolveDealDocId = async () => {
          // 1) direct id exists?
          if (dealId) {
            try {
              const directRef = doc(db, "deals", dealId);
              const directSnap = await getDoc(directRef);
              if (directSnap.exists()) return dealId;
            } catch (_) {
              // ignore and continue fallback lookup
            }
          }

          // 2) lookup by KPI / autoId
          const probe = payload.kpiId || data?.kpiId || editableData?.kpiId || dealId;
          if (!probe) return null;

          const byKpi = await getDocs(query(collection(db, "deals"), where("kpiId", "==", probe)));
          if (!byKpi.empty) return byKpi.docs[0].id;

          const byAuto = await getDocs(query(collection(db, "deals"), where("autoId", "==", probe)));
          if (!byAuto.empty) return byAuto.docs[0].id;

          return null;
        };

        const resolvedDealId = await resolveDealDocId();
        if (resolvedDealId) {
          await updateDoc(doc(db, "deals", resolvedDealId), {
            stage: "Won",
            updatedAt: serverTimestamp(),
          });
        } else {
          console.warn("⚠️ Could not resolve deal document to mark Won", { dealId, kpiId: payload.kpiId });
        }
      } catch (stageErr) {
        console.warn("⚠️ Sales Order created, but deal stage update skipped:", stageErr);
      }

      // ---------------------------
      alert("Sales Order created successfully.");
      setShowConvertModal(false);

      // Navigate to sales orders list
      navigate("/crm/salesOrders");
    } catch (err) {
      console.error("Create Sales Order error:", err);
      alert("Error creating Sales Order: " + (err.message || err));
    } finally {
      setCreating(false);
    }
  };

  const cleaned = {
  ...editableData,
  teleSale:
    editableData.teleSale === "no" ? "" : editableData.teleSale,
  consultantName:
    editableData.consultantName === "no" ? "" : editableData.consultantName,
};

  // --------------------------
  // Render
  // --------------------------
  return (
    <div style={{ padding: "30px", fontFamily: "Poppins, sans-serif" }}>
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
          <b>Case ID:</b> {caseId || "-"}
        </p>
        <p>
          <b>Quote No:</b> {quoteNo || "-"}
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
  <option>Renew</option>
  <option>Premier Energies</option>
  <option>Tata</option>
  <option>Adani</option>
  <option>Waaree</option>
  <option>RenewSys</option>
</select>

{" | "}

<select
  value={editableData.panelWatt}
  onChange={(e) => handleChange("panelWatt", e.target.value)}
>
  <option>535 Wp</option>
  <option>540 Wp</option>
  <option>545 Wp</option>
  <option>550 Wp</option>
  <option>555 Wp</option>
  <option>560 Wp</option>
  <option>580 Wp</option>
  <option>590 Wp</option>
  <option>640 Wp</option>
  <option>680 Wp</option>
  <option>685 Wp</option>
</select>
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
  <option>Powerone</option>
  <option>Polycab</option>
  <option>Sungrow</option>
  <option>Waaree</option>
  <option>Growatt</option>
</select>
          |{" "}
          {" | "}
<input
  type="number"
  value={editableData.inverterSize || ""}
  onChange={(e) => handleChange("inverterSize", e.target.value)}
  placeholder="Enter kW"
  style={{ width: 80, padding: 4 }}
/>
<span style={{ marginLeft: 4 }}>kW</span>
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
            <td>
              <input
                type="number"
                min="1"
                value={editableData.systemQty ?? editableData.capacity ?? 1}
                onChange={(e) => handleChange("systemQty", e.target.value)}
                style={{
                  width: "60px",
                  padding: 4,
                  border: "1px solid #ccc",
                }}
              />
            </td>
            <td>₹{summary.systemTotal.toLocaleString()}</td>
          </tr>

           <tr>
    <td style={{ padding: 10 }}>Structure Cost</td>

    <td>
      <input
        type="number"
        value={editableData.structureRate}
        onChange={(e) => handleChange("structureRate", e.target.value)}
        style={{ width: "100px", padding: 4 }}
      />
    </td>

    <td>
      <input
        type="number"
        value={editableData.structureQty}
        onChange={(e) => handleChange("structureQty", e.target.value)}
        style={{ width: "60px", padding: 4 }}
      />
    </td>

    <td>
      ₹{(
        Number(editableData.structureRate || 0) *
        Number(editableData.structureQty || 0)
      ).toLocaleString()}
    </td>
  </tr>

            <tr>
              <td colSpan="3" style={{ textAlign: "right", padding: 10 }}>
                GST (
                <input
                  type="number"
                  step="0.1"
                  value={editableData.gst ?? 8.9}
                  onChange={(e) => handleChange("gst", e.target.value)}
                  style={{ width: "70px", padding: 4, margin: "0 4px" }}
                />
                %) on System + Structure
              </td>
              <td>₹{summary.gstValue.toLocaleString()}</td>
            </tr>

          <tr
            style={{
              background: maroon,
              color: "#fff",
              fontWeight: "bold",
            }}
          >
            <td colSpan="3" style={{ textAlign: "right", padding: 10, color: "#fff" }}>
              Total
            </td>
            <td style={{ color: "#fff" }}>₹{summary.totalCost.toLocaleString()}</td>
          </tr>

          <tr>
            <td colSpan="4" style={{ textAlign: "center", padding: 10 }}>
              <b>Amount in Words:</b> {summary.inWords}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Footer actions */}
      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={handleSaveQuotation}
          disabled={savingQuotation}
          style={{
            background: "#800000",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 6,
            border: "none",
            fontWeight: 700,
          }}
        >
          {savingQuotation ? "Saving..." : "Save"}
        </button>

        {hasSaved && (
          <button
            onClick={() => setShowPDF(true)}
            style={{
              background: "#5f0000",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: 6,
              border: "none",
              fontWeight: 700,
            }}
          >
            Export as PDF
          </button>
        )}

        {perm.create && (
          <button
            onClick={() => {
              setConvertMode("SO");
              setShowConvertModal(true);
            }}
            style={{
              background: "#fff",
              color: maroon,
              border: `1px solid ${maroon}`,
              padding: "10px 20px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Convert
          </button>
        )}

        <button
          onClick={handleClosePreview}
          style={{
            background: "#f3f4f6",
            color: maroon,
            padding: "10px 20px",
            borderRadius: 6,
            border: `1px solid ${maroon}`,
            fontWeight: 700,
          }}
        >
          Close
        </button>
      </div>

    {showPDF && (
  <QuotationPDFLayout
    quotationData={{ ...cleaned, amountInWords: summary.inWords }}
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
                style={{
                  flex: 1,
                  padding: 10,
                  background: maroon,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                Create Sales Order
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
