// src/components/SalesOrderDrawer.jsx
import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import {
  doc,
  updateDoc,
  getDoc,
  serverTimestamp,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  setDoc,
  arrayUnion
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import { arrayRemove } from "firebase/firestore";
import { deleteObject } from "firebase/storage";
import { deleteDoc } from "firebase/firestore";
import { usePermission } from "../hooks/usePermission";



/* ============================================================
   NOTE: This file keeps your existing logic untouched.
   I only added dynamic fields support:
   - loads /crm_fields/salesOrders
   - initializes missing dynamic fields into the form
   - renders dynamic inputs below static fields
   - merges dynamic fields into update payload when saving
   ============================================================ */

export default function SalesOrderDrawer(props) {

  const perm = usePermission("sales-orders");

  if (perm.loading) {
    return (
      <div style={{ padding:40, textAlign:"center", color:"#800000" }}>
        Checking permissions…
      </div>
    );
  }

  if (!perm.update) {
    return (
      <div style={{ padding:40, textAlign:"center", color:"#800000" }}>
        <h2>🚫 Access Denied</h2>
        <p>You do not have permission to update Sales Orders.</p>
        <button onClick={props.onClose}>Close</button>
      </div>
    );
  }

  return <SalesOrderDrawerInner perm={perm} {...props} />;
}


function SalesOrderDrawerInner({ perm, so, onClose }) {

  const [form, setForm] = useState({ ...so });
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState(so.attachments || []);
  const [uploading, setUploading] = useState(false);
  const [fileType, setFileType] = useState("payment-proof");
  const [isAdmin, setIsAdmin] = useState(false);

  const [fieldsDef, setFieldsDef] = useState([]);


  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const adminEmails = ["loan@kapilpower.com", "kapiladmin@gmail.com"];
    const adminUIDs = ["0r8Xa7QPYHeosf65fBVdhI3kj5V2"];

    if (adminEmails.includes(storedUser?.email)) return setIsAdmin(true);
    if (adminUIDs.includes(storedUser?.uid)) return setIsAdmin(true);

    const loadRole = async () => {
      if (!storedUser?.uid) return;
      const ref = doc(db, "Users", storedUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data()?.role?.toLowerCase() === "admin") {
        setIsAdmin(true);
      }
    };

    loadRole();
  }, []);

  useEffect(() => {
    setForm((prev) => ({ ...prev, ...so }));
    // ⭐ Auto carry forward 4 fields from Deal → Sales Order
["sales_area", "sales_zone", "state", "zonal_manager"].forEach((k) => {
  if (so?.[k] !== undefined) {
    setForm((prev) => ({ ...prev, [k]: so[k] }));
  }
});
  }, [so]);

  // load dynamic fields defs for salesOrders
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const ref = doc(db, "crm_fields", "salesOrders");
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          if (active) setFieldsDef([]);
          return;
        }
        const data = snap.data() || {};
        const defs = Array.isArray(data.fields) ? data.fields : [];
        const normalized = defs.map((f) =>
          typeof f === "string"
            ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [], default: "" }
            : { ...(f || {}), options: f.options || [], default: f.default ?? "" }
        );
        if (!active) return;
        setFieldsDef(normalized);

        // initialize missing dynamic fields into form
        setForm((prev) => {
          const n = { ...prev };
          normalized.forEach((fd) => {
            if (n[fd.name] === undefined) {
              if (fd.type === "checkbox") n[fd.name] = !!fd.default;
              else if (fd.type === "multiselect") n[fd.name] = Array.isArray(fd.default) ? fd.default : [];
              else n[fd.name] = fd.default ?? "";
            }
          });
          return n;
        });
      } catch (err) {
        console.error("Failed to load crm_fields/salesOrders", err);
      }
    })();

    return () => (active = false);
  }, []);
  const currentUser =
  typeof window !== "undefined"
    ? JSON.parse(localStorage.getItem("kp-user") || "{}")
    : {};

  // payments
  const p1 = Number(form.firstPayment || 0);
  const p2 = Number(form.secondPayment || 0);
  const p3 = Number(form.thirdPayment || 0);
  const p4 = Number(form.fourthPayment || 0);

  const invoiceAmount = Number(form.invoiceAmount || 0);
  const totalReceived = p1 + p2 + p3 + p4;
  const pending = invoiceAmount - totalReceived;
  const percentage = invoiceAmount ? (totalReceived / invoiceAmount) * 100 : 0;

  const handleChange = (field, value) => {
  if (!perm.update) return;
  setForm((prev) => ({ ...prev, [field]: value }));
};

  // Project utilities
  const projectExists = async (kpiId) => {
    const projRef = collection(db, "projects");
    const q = query(projRef, where("kpiId", "==", kpiId));
    const snap = await getDocs(q);
    return snap.size > 0;
  };

  const createProject = async (salesOrder, totalReceivedArg, pendingArg, percentageArg) => {
    if (await projectExists(salesOrder.kpiId)) return false;

    const today = serverTimestamp();

    await addDoc(collection(db, "projects"), {
      kpiId: salesOrder.kpiId,
      name: salesOrder.name,
      phone: salesOrder.phone,
      address: salesOrder.address,
      capacity: salesOrder.capacity,
      invoiceAmount: salesOrder.invoiceAmount,
      totalReceived: totalReceivedArg,
      pending: pendingArg,
      paymentPercentage: percentageArg,
      salesOrderId: salesOrder.id,
      createdAt: today,
    });

    return true;
  };

  const handleFileUpload = async (file) => {
  if (!file) return;

if (file.size > 300 * 1024 * 1024) {
  alert("Max file size is 300MB");
  return;
}

  setUploading(true);

  try {
    const storage = getStorage();
    const storagePath = `salesOrders/${form.kpiId}/${fileType}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const attachmentObj = {
      name: file.name,
      type: fileType,
      url,
      uploadedAt: new Date(),
    };

    await updateDoc(doc(db, "salesOrders", form.id), {
      attachments: arrayUnion(attachmentObj),
    });

    setAttachments((prev) => [...prev, attachmentObj]);
  } catch (e) {
    console.error(e);
    alert("Upload failed");
  } finally {
    setUploading(false);
  }
};
const handleDeleteAttachment = async (att) => {
  if (!isAdmin) return alert("Only admin can delete files.");
  if (!window.confirm("Delete this file?")) return;

  try {
    setUploading(true);

    const storage = getStorage();
    const fileRef = ref(storage, att.url);

    await deleteObject(fileRef);

    await updateDoc(doc(db, "salesOrders", form.id), {
      attachments: arrayRemove(att),
    });

    setAttachments(prev => prev.filter(a => a.url !== att.url));

    alert("Deleted successfully");
  } catch (e) {
    console.error(e);
    alert("Delete failed");
  } finally {
    setUploading(false);
  }
};

const handleDeleteRecord = async () => {
  if (!isAdmin) return alert("Only admin can delete Sales Orders.");
  if (!window.confirm("Are you sure? This cannot be undone.")) return;

  try {
    await deleteDoc(doc(db, "salesOrders", form.id));

    alert("Sales Order deleted successfully");
    onClose();       // closes drawer + refresh happens automatically
  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};

  // Save sales order and auto-convert logic (60% but only if project doesn't exist)
  const saveSalesOrder = async () => {
    if (!perm.update) return alert("You do not have permission to update");

    setSaving(true);
    try {
      const ref = doc(db, "salesOrders", so.id);
      const old = so;
      const today = serverTimestamp();

      let updateData = {
        name: form.name,
        phone: form.phone,
        teleSale: form.teleSale,
        consultantName: form.consultantName,
        address: form.address,
        capacity: form.capacity,
        invoiceAmount,
        firstPayment: p1,
        secondPayment: p2,
        thirdPayment: p3,
        fourthPayment: p4,
        paymentReceived: totalReceived,
        pendingPayment: pending,
        paymentPercentage: percentage,
        updatedAt: today,
          // ✅ FIXED
  updatedBy:
    currentUser.displayName ||
    currentUser.email ||
    "",
      };

      const setDate = (oldVal, newVal, oldDate) => {
        if (newVal > 0) {
          if (!oldDate || newVal > oldVal) return today;
          return oldDate;
        }
        return oldDate || null;
      };

      updateData.firstPaymentDate = setDate(old.firstPayment, p1, old.firstPaymentDate);
      updateData.secondPaymentDate = setDate(old.secondPayment, p2, old.secondPaymentDate);
      updateData.thirdPaymentDate = setDate(old.thirdPayment, p3, old.thirdPaymentDate);
      updateData.fourthPaymentDate = setDate(old.fourthPayment, p4, old.fourthPaymentDate);
      // 🔥 60% reached DATE logic (WORKS for 1st / 2nd / any payment)
const paymentPercent = invoiceAmount
  ? (totalReceived / invoiceAmount) * 100
  : 0;

if (paymentPercent >= 60 && !old.sixtyPercentReachedDate) {
  // find WHICH payment crossed 60%
  const paymentDate =
    updateData.fourthPaymentDate ||
    updateData.thirdPaymentDate ||
    updateData.secondPaymentDate ||
    updateData.firstPaymentDate ||
    today;

  updateData.sixtyPercentReachedDate = paymentDate;
}


      // ---------------------------------------------------
// 60% PAYMENT LOGIC (Stores YES/NO + Delay Days)
// ---------------------------------------------------
const sixtyTarget = invoiceAmount * 0.6;

// 1️⃣ YES / NO STATUS
const sixtyPercentReceived = totalReceived >= sixtyTarget ? "YES" : "NO";

// 2️⃣ DELAY DAYS LOGIC
let sixtyPercentDelayDays = null;

// token date = 1st payment date (your base reference)
const tokenDate = updateData.firstPaymentDate || old.firstPaymentDate;

if (tokenDate) {
  const tokenMs =
    tokenDate?.seconds
      ? tokenDate.seconds * 1000
      : new Date(tokenDate).getTime();

  let endDateMs;

  if (sixtyPercentReceived === "YES") {
    const sixtyDate =
      old?.sixtyPercentReceivedDate ||
      updateData?.sixtyPercentReceivedDate ||
      new Date();

    endDateMs = sixtyDate?.seconds
      ? sixtyDate.seconds * 1000
      : new Date(sixtyDate).getTime();
  } else {
    endDateMs = Date.now();
  }

  const days = Math.floor(
    (endDateMs - tokenMs) / (1000 * 60 * 60 * 24)
  );
  sixtyPercentDelayDays = days >= 0 ? days : 0;
}

// push to firestore
updateData.sixtyPercentReceived = sixtyPercentReceived;
updateData.sixtyPercentDelayDays = sixtyPercentDelayDays;


      // Merge dynamic fields into updateData
      fieldsDef.forEach((fd) => {
        // include only the dynamic fields, do not override core fields accidentally
        const name = fd.name;
        if (name && !["id", "kpiId", "createdAt", "createdBy", "updatedAt"].includes(name)) {
          updateData[name] = form[name] ?? (fd.type === "checkbox" ? false : fd.default ?? "");
        }
      });


// 1️⃣ FIRST save Sales Order
await updateDoc(ref, updateData);

// 2️⃣ THEN check conversion
const sixty = invoiceAmount * 0.6;
const isAbove60 = totalReceived >= sixty;
const projectAlreadyExists = await projectExists(so.kpiId);

if (isAbove60 && !projectAlreadyExists) {

  // set 60% received date ONLY once
  if (!old.sixtyPercentReceivedDate) {
    await updateDoc(ref, {
      sixtyPercentReceivedDate: today,
      convertedToProject: true
    });
  }

  await createProject(
    so,
    totalReceived,
    pending,
    percentage
  );

  console.log("✔ Auto converted to Project (>=60%)");
}


      await updateDoc(ref, updateData);

      alert("Sales Order updated successfully");
      onClose();
    } catch (err) {
      console.error("Update error:", err);
      alert("Error updating sales order");
    }
    setSaving(false);
  };

  // -------------------------
  // Invoice generation logic (unchanged)
  // -------------------------
  const company = {
    name: "Kapil Power & Infra (P) Limited",
    addressLine1: "2nd Floor, Kapil Kavuri Hub",
    addressLine2: "Financial District, Nanakramguda, Gachi Bowli",
    cityLine: "Hyderabad - 500 032",
    gst: "36AAFCA3811M1ZO",
    cin: "U72200TG2004PTC042811",
    bankName: "Union Bank of India",
    bankAccount: "183911100000539",
    logoSrc: "/kapil_power_logo.png",
  };

  /**
   * invoiceAmount => GRAND TOTAL (including GST)
   * Reverse calculate base amount using 12% GST (6% CGST + 6% SGST)
   */
  const computeGstBreakdown = (grandTotal, capacity = 1) => {
    const GT = Number(grandTotal || 0) || 0;
    const qty = Number(capacity) || 1;

    // CGST + SGST = 12%
    const totalGstRate = 0.12;

    // base price = grand total ÷ 1.12
    const baseAmount = +(GT / (1 + totalGstRate)).toFixed(2);

    // rate per unit (excluding GST)
    const ratePerUnit = +(baseAmount / qty).toFixed(2);

    // taxes
    const cgst = +(baseAmount * 0.06).toFixed(2);
    const sgst = +(baseAmount * 0.06).toFixed(2);
    const igst = 0;

    const totalTax = +(cgst + sgst + igst).toFixed(2);

    return {
      qty,
      baseAmount,
      ratePerUnit,
      cgst,
      sgst,
      igst,
      totalTax,
      grandTotal: GT,
    };
  };

  const createInvoicePdf = (salesOrder) => {
const amount = Number(salesOrder.invoiceAmount || 0); // Grand Total
const capacity = Number(salesOrder.capacity || 1) || 1;
const gst = computeGstBreakdown(amount, capacity);
    const billToName = salesOrder.name || "";
    const billToPhone = salesOrder.phone || "";
    const billToAddress = salesOrder.address || "";

    const description = `Supply, Installation & Commissioning of Solar System - ${capacity}`;
    const invoiceNo = salesOrder.kpiId ? `KPIPL-INV-${salesOrder.kpiId}` : `KPIPL-INV-${Date.now()}`;

    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Invoice - ${invoiceNo}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 13px; color: #222; padding: 24px; }
          .invoice-wrap { max-width: 800px; margin: 0 auto; border: 1px solid #ddd; padding: 18px; }
          .header { display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; }
          .company { text-align: left; }
          .company h2 { margin:0; color:#800000; font-size:18px; }
          .company p { margin:2px 0; font-size:12px; }
          .logo img { max-width:140px; height:auto; }
          .meta { text-align:right; }
          .meta h3 { margin:0; font-size:16px; color:#800000; }
          .meta p { margin:2px 0; font-size:12px; }
          .bill { margin-top:12px; display:flex; justify-content:space-between; }
          .bill-to { width:65%; }
          .bill-to h4 { margin:0 0 6px 0; }
          table { width:100%; border-collapse:collapse; margin-top:12px; }
          th, td { border:1px solid #ddd; padding:10px; text-align:left; }
          th { background:#f7f7f7; font-weight:700; }
          .totals { width:320px; float:right; margin-top:12px; }
          .totals table { width:100%; }
          .small { font-size:12px; color:#333; }
          .signature { margin-top:50px; }
          .bank { margin-top:18px; font-weight:700; }
        </style>
      </head>
      <body>
        <div class="invoice-wrap">
          <div class="header">
            <div class="company">
              <h2>${company.name}</h2>
              <p>${company.addressLine1}</p>
              <p>${company.addressLine2}</p>
              <p>${company.cityLine}</p>
              <p>GST: ${company.gst}</p>
              <p>CIN: ${company.cin}</p>
            </div>
            <div class="logo">
              <img 
  src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  alt="logo"
  style="width:120px;height:auto;"
/>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="bill-to">
              <h4>Bill To</h4>
              <div>${billToName}</div>
              <div>Phone: ${billToPhone}</div>
              <div>${billToAddress}</div>
            </div>
            <div style="text-align:right;">
              <h3>Tax Invoice</h3>
              <p><strong>Invoice No:</strong> ${invoiceNo}</p>
              <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
              <p><strong>Ref:</strong> ${salesOrder.kpiId || ""}</p>
            </div>
          </div>

                          <table>
            <thead>
              <tr>
                <th style="width:60px">S. No</th>
                <th>Description</th>
                <th style="width:80px">Qty</th>
                <th style="width:120px">Rate (₹)</th>
                <th style="width:120px">Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>${description}</td>
                <td style="text-align:center">${gst.qty}</td>
                <td style="text-align:right">${gst.ratePerUnit.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td style="text-align:right">${gst.baseAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
              </tr>
            </tbody>
          </table>

          <div class="totals">
            <table>
              <tbody>
                <tr>
                  <td class="small">Taxable Amount</td>
                  <td style="text-align:right">₹ ${gst.baseAmount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                  <td class="small">CGST @ 6%</td>
                  <td style="text-align:right">₹ ${gst.cgst.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                  <td class="small">SGST @ 6%</td>
                  <td style="text-align:right">₹ ${gst.sgst.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                  <td class="small">IGST @ 0%</td>
                  <td style="text-align:right">₹ ${gst.igst.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                  <td style="font-weight:700">Total Tax</td>
                  <td style="text-align:right; font-weight:700">₹ ${gst.totalTax.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                  <td style="font-weight:900">Grand Total</td>
                  <td style="text-align:right; font-weight:900">₹ ${gst.grandTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
              </tbody>
            </table>
          </div>
              </tr>
            </tbody>
          </table>

          <div class="totals">
            <table>
            </table>
          </div>

          <div style="clear:both"></div>

          <p style="margin-top:40px;">It is certified that the particulars given above are true and correct</p>
          <p>Authorised Signatory</p>

          <div class="bank">
            Bank Details:
            <div>Bank Name: ${company.bankName}</div>
            <div>A/C No: ${company.bankAccount}</div>
          </div>
        </div>

        <div style="margin-top:12px; text-align:center;">
          <button onclick="window.print()" style="padding:10px 18px; background:#800000; color:#fff; border:none; border-radius:6px; cursor:pointer;">
            Download / Print PDF
          </button>
        </div>
      </body>
      </html>
    `;

    const w = window.open("", "_blank", "toolbar=0,location=0,menubar=0");
    if (!w) return alert("Popup blocked. Allow popups for this site to generate invoice.");
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  // -------------------------
  // Render UI
  // -------------------------
  const label = { display: "block", marginBottom: 5, fontWeight: 600 };
  const input = { width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ccc", marginBottom: 12, background: isAdmin ? "white" : "#eee" };
  const dateText = { fontSize: 12, color: "#555", marginTop: -8, marginBottom: 12 };

  // dynamic input renderer
  const renderDynamicInput = (fd) => {
    const val = form[fd.name] ?? "";
    const commonStyle = { width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ccc", marginBottom: 12, background: isAdmin ? "white" : "#eee" };
    const t = (fd.type || "text").toLowerCase();

    switch (t) {
      case "textarea":
        return <textarea value={val} onChange={(e) => handleChange(fd.name, e.target.value)} rows={3} style={{ ...commonStyle, minHeight: 80 }} disabled={!perm.update} />;
      case "date":
        return <input type="date" value={val ? String(val).split("T")[0] : ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update} />;
      case "checkbox":
        return <input type="checkbox" checked={!!val} onChange={(e) => handleChange(fd.name, e.target.checked)} disabled={!perm.update} />;
      case "select":
      case "picklist":
        return (
          <select value={val ?? ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update}>
            <option value="">Select</option>
            {fd.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case "multiselect":
        return (
          <input
            placeholder="comma separated"
            value={Array.isArray(val) ? val.join(",") : val}
            onChange={(e) =>
              handleChange(
                fd.name,
                e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean)
              )
            }
            style={commonStyle}
            disabled={!perm.update}
          />
        );
      default:
        return <input value={val} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update} />;
    }
  };

  return (
<div
  style={{
    position: "fixed",
    right: 0,
    top: 0,
    width: window.innerWidth <= 768 ? "100%" : "460px",
    height: "100vh",
    background: "#fff",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.2)",
      padding: 5,
    overflowY: "auto",
    overscrollBehavior: "contain",
    overflowX: "auto",               // ⭐ ADD THIS
    WebkitOverflowScrolling: "touch",// ⭐ ADD THIS
    zIndex: 999999,
  }}
>
      <h2 style={{ color: "#800000" }}>Sales Order Details</h2>

      <button onClick={onClose} style={{ position: "absolute", right: 20, top: 20, padding: "6px 10px", border: "1px solid #800000", color: "#800000", background: "#fff", borderRadius: 6 }}>
        Close
      </button>

      <p style={{ fontWeight: 700 }}>KPI ID: {form.kpiId}</p>

      <label style={label}>Customer Name</label>
      <input style={input} value={form.name} onChange={(e) => handleChange("name", e.target.value)} disabled={!perm.update} />

      <label style={label}>Phone</label>
      <input style={input} value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} disabled={!perm.update} />

      <label style={label}>Tele-Sales</label>
      <input style={input} value={form.teleSale} onChange={(e) => handleChange("teleSale", e.target.value)} disabled={!perm.update} />

      <label style={label}>Consultant Name</label>
      <input style={input} value={form.consultantName} onChange={(e) => handleChange("consultantName", e.target.value)} disabled={!perm.update} />

      <label style={label}>Address</label>
      <input style={input} value={form.address} onChange={(e) => handleChange("address", e.target.value)} disabled={!perm.update} />

      <label style={label}>Capacity (kW)</label>
      <input style={input} type="number" value={form.capacity} onChange={(e) => handleChange("capacity", e.target.value)} disabled={!perm.update} />

      <label style={label}>Invoice Amount</label>
      <input style={input} type="number" value={form.invoiceAmount} onChange={(e) => handleChange("invoiceAmount", e.target.value)} disabled={!perm.update} />

      <h3 style={{ marginTop: 20 }}>Payments</h3>
      {[
        ["1st Payment", "firstPayment", "firstPaymentDate"],
        ["2nd Payment", "secondPayment", "secondPaymentDate"],
        ["3rd Payment", "thirdPayment", "thirdPaymentDate"],
        ["4th Payment", "fourthPayment", "fourthPaymentDate"],
      ].map(([labelText, field, dateField]) => (
        <div key={field}>
          <label style={label}>{labelText}</label>
          <input style={input} type="number" value={form[field]} onChange={(e) => handleChange(field, e.target.value)} disabled={!perm.update} />
          {form[dateField] && <p style={dateText}>Date: {new Date(form[dateField]?.seconds * 1000).toLocaleDateString("en-GB")}</p>}
        </div>
      ))}

      <div style={{ background: "#f4f4f4", padding: 12, borderRadius: 6, marginTop: 20 }}>
        <p><b>Total Received:</b> ₹{totalReceived.toLocaleString()}</p>
        <p><b>Pending:</b> ₹{pending.toLocaleString()}</p>
        <p><b>Payment %:</b> {percentage.toFixed(1)}%</p>
      </div>

      {/* =========================================================
          ⭐ DYNAMIC FIELDS SECTION (BELOW STATIC FIELDS)
          ========================================================= */}
      {fieldsDef.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ color: "#800000" }}>Additional Fields</h3>
          {fieldsDef.map((fd) => (
            <div key={fd.name} style={{ marginTop: 8 }}>
              <label style={label}>{fd.label}{fd.required ? " *" : ""}</label>
              {renderDynamicInput(fd)}
            </div>
          ))}
        </div>
      )}

      {/* Convert to Project (keeps your existing behavior) */}
      {perm.update && (
        <button
          onClick={async () => {
            if (await projectExists(form.kpiId)) return alert("Project already exists for this KPI.");
            const created = await createProject(form, totalReceived, pending, percentage);
            if (created) alert("✔ Project created successfully!");
            else alert("Project already exists!");
          }}
          style={{ marginTop: 10, width: "100%", padding: 12, background: "#0066cc", color: "#fff", border: "none", borderRadius: 6, fontWeight: "bold" }}
        >
          Convert to Project
        </button>
      )}

      {/* Create Invoice button (under Convert to Project) */}
      {perm.update && (
        <button
          onClick={() => createInvoicePdf(form)}
          style={{ marginTop: 12, width: "100%", padding: 12, background: "#800000", color: "#fff", border: "none", borderRadius: 6, fontWeight: "bold" }}
        >
          Create Invoice / Download PDF
        </button>
      )}

      {/* Save */}
     {/* Spacer so content doesn't hide behind fixed buttons */}
<div style={{ height: "140px" }}></div>
{/* ATTACHMENTS SECTION */}
<div style={{ marginTop: 30 }}>
  <h3 style={{ color: "#800000" }}>Attachments</h3>

  {attachments.length === 0 ? (
    <p style={{ color: "#999" }}>No files uploaded</p>
  ) : (
<ul>
  {attachments.map((a, i) => (
    <li key={i} style={{ marginBottom: 6 }}>
      <a href={a.url} target="_blank" rel="noreferrer">
        {a.name}
      </a>
      <small> ({a.type})</small>

      {isAdmin &&  (
        <button
          onClick={() => handleDeleteAttachment(a)}
          style={{
            marginLeft: 10,
            color: "white",
            background: "red",
            border: "none",
            padding: "4px 8px",
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          Delete
        </button>
      )}
    </li>
  ))}
</ul>
  )}

  <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
    <select
      value={fileType}
      onChange={(e) => setFileType(e.target.value)}
    >
      <option value="payment-proof">Payment Proof</option>
      <option value="loan-documents">Loan Documents</option>
      <option value="design">Design</option>
      <option value="site-survey-report">Site Survey Report</option>
    </select>

    <input
      type="file"
      disabled={uploading}
      onChange={(e) => handleFileUpload(e.target.files[0])}
    />
  </div>

  {uploading && <p>Uploading...</p>}
</div>

{/* FIXED BOTTOM BUTTON BAR */}
<div
  style={{
    borderTop: "1px solid #eee",
    padding: 12,
    display: "flex",
    gap: 10,
    marginTop: 20,
  }}
>
  {perm.update && (
    <button
      onClick={saveSalesOrder}
      disabled={saving}
      style={{
        flex: 1,
        background: "#800000",
        color: "#fff",
        padding: "12px 0",
        borderRadius: "8px",
        border: "none",
        fontWeight: "bold",
      }}
    >
      {saving ? "Saving..." : "Save"}
    </button>
  )}
  {isAdmin && (
  <button
    onClick={handleDeleteRecord}
    style={{
      background: "red",
      color: "white",
      padding: "8px 15px",
      borderRadius: 6,
      border: "none",
      marginRight: 10,
      cursor: "pointer"
    }}
  >
    Delete Sales Order
  </button>
)}

  <button
    onClick={onClose}
    style={{
      flex: 1,
      background: "#fff",
      color: "#800000",
      border: "2px solid #800000",
      padding: "12px 0",
      borderRadius: "8px",
      fontWeight: 700,
    }}
  >
    Cancel
  </button>
</div>
    </div>
  );
};


// small helper for pretty label (same pattern used elsewhere)
function prettyLabel(name) {
  if (!name) return "";
  return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
