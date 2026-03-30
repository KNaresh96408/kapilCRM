// src/components/SalesOrderDrawer.jsx
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { db, serverTimestamp } from "../firebaseConfig";
import {
  doc,
  updateDoc,
  getDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { usePermission } from "../hooks/usePermission";
import { toJSDate } from "../helpers/safeDateParser";
import { getAreaOptions, getStateOptions, getZoneOptions, isAreaInZone, isZoneInState } from "../helpers/salesRegions";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";
import SearchableSelect from "./Universal/SearchableSelect";
import AttachmentFolderTiles from "../modules/attachments/AttachmentFolderTiles";
import kapilLogo from "../kapil-logo.png";
import html2pdf from "html2pdf.js";
import { isZonalManagerField, ZONAL_MANAGER_NAMES } from "../helpers/zonalManagers";



/* ============================================================
   NOTE: This file keeps your existing logic untouched.
   I only added dynamic fields support:
   - loads /crm_fields/salesOrders
   - initializes missing dynamic fields into the form
   - renders dynamic inputs below static fields
   - merges dynamic fields into update payload when saving
   ============================================================ */

// 🔐 NORMALIZER FOR STATE / ZONE / AREA (MANDATORY)
const normalizeScope = (v) =>
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
  return normalizeScope(raw) === normalizeScope(label) ? label : raw;
};

const OVERALL_PAYMENT_MODE_OPTIONS = ["NPL", "Ecofy", "Bajaj", "Creditfair", "Solfin", "Fibe"];
const INSTALLMENT_PAYMENT_MODE_OPTIONS = ["UPI", "Cash", "Loan"];

export default function SalesOrderDrawer(props) {
  const perm = props.perm || usePermission("sales-orders");

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
  const isMobileView = typeof window !== "undefined" && window.innerWidth <= 768;
  const canEdit = !!perm.update;
  const DAY_MS = 1000 * 60 * 60 * 24;
  const SIXTY_PERCENT_THRESHOLD = 59.5;

  const toSafeDate = (value) => {
    const parsed = toJSDate(value);
    if (parsed && !isNaN(parsed.getTime())) return parsed;

    if (typeof value === "string") {
      const raw = value.trim();
      const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (dmy) {
        const day = Number(dmy[1]);
        const month = Number(dmy[2]);
        const year = Number(dmy[3]);
        const fallback = new Date(year, month - 1, day);
        if (!isNaN(fallback.getTime())) return fallback;
      }
    }

    return null;
  };

  const atStartOfDay = (dateValue) => {
    const d = toSafeDate(dateValue);
    if (!d) return null;
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    return n;
  };

  const getFirstPaidDate = (current, previous) => {
    const getAmount = (field) => Number(current?.[field] ?? previous?.[field] ?? 0);
    const getDate = (field) => current?.[field] ?? previous?.[field];

    const candidates = [
      { amount: getAmount("firstPayment"), date: getDate("firstPaymentDate") },
      { amount: getAmount("secondPayment"), date: getDate("secondPaymentDate") },
      { amount: getAmount("thirdPayment"), date: getDate("thirdPaymentDate") },
      { amount: getAmount("fourthPayment"), date: getDate("fourthPaymentDate") },
    ];

    if (getAmount("firstPayment") <= 0 && getAmount("tokenPayment") > 0) {
      candidates.push({
        amount: getAmount("tokenPayment"),
        date:
          getDate("tokenPaymentDate") ||
          getDate("firstPaymentDate") ||
          current?.createdAt ||
          previous?.createdAt,
      });
    }

    const paidDates = candidates
      .filter((c) => c.amount > 0)
      .map((c) => atStartOfDay(c.date))
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());

    return paidDates[0] || null;
  };

  const [form, setForm] = useState({
    ...so,
    paymentMode: so?.paymentMode || so?.payment_mode || "",
    firstPaymentMode: so?.firstPaymentMode || so?.first_payment_mode || "",
    secondPaymentMode: so?.secondPaymentMode || so?.second_payment_mode || "",
    thirdPaymentMode: so?.thirdPaymentMode || so?.third_payment_mode || "",
    fourthPaymentMode: so?.fourthPaymentMode || so?.fourth_payment_mode || "",
  });
  const activeKpiId = form?.kpiId || so?.kpiId || "-";
  const [saving, setSaving] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState({ open: false, html: "", filename: "" });
  const [sharingReceipt, setSharingReceipt] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [consultants, setConsultants] = useState([]);
  const [teleUsers, setTeleUsers] = useState([]);

  const [fieldsDef, setFieldsDef] = useState([]);

  const formatDateValue = (value) => {
    if (!value) return "";
    const dateObj = toJSDate(value);
    if (!dateObj || isNaN(dateObj.getTime())) return "";
    return dateObj.toLocaleDateString("en-GB");
  };


  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const adminEmails = ["loan@kapilpower.com", "kapiladmin@gmail.com"];
    const adminUIDs = ["26VHcREEDMMg8C24kXYVGzRXHe43"];

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

  // Load consultants for assignedConsultant dropdown
  useEffect(() => {
    const load = async () => {
      try {
        const normalizeRole = (v) => String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        const rows = await fetchCollectionDocs("Users");
        const allUsers = (rows || []).map((d) => ({
          name: d.Name || d.name || "",
          email: d.email || "",
          role: normalizeRole(d.role || d.Role || d.designation || d.Designation || ""),
        }));

        setConsultants(
          allUsers.filter((u) =>
            ["consultant", "area_sales_manager", "zonal_manager"].includes(u.role)
          )
        );

        setTeleUsers(
          allUsers.filter((u) =>
            [
              "tele_caller",
              "telecaller",
              "telesales",
              "tele_sales",
              "team_lead",
              "team_manager",
            ].includes(u.role) ||
            String(u.role || "").includes("tele")
          )
        );
      } catch (err) {
        console.error("Consultant load error:", err);
      }
    };
    load();
  }, []);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      ...so,
      paymentMode: so?.paymentMode || so?.payment_mode || prev.paymentMode || "",
      firstPaymentMode: so?.firstPaymentMode || so?.first_payment_mode || prev.firstPaymentMode || "",
      secondPaymentMode: so?.secondPaymentMode || so?.second_payment_mode || prev.secondPaymentMode || "",
      thirdPaymentMode: so?.thirdPaymentMode || so?.third_payment_mode || prev.thirdPaymentMode || "",
      fourthPaymentMode: so?.fourthPaymentMode || so?.fourth_payment_mode || prev.fourthPaymentMode || "",
    }));
    // ⭐ Auto carry forward 4 fields from Deal → Sales Order
    ["sales_area", "sales_zone", "state", "zonal_manager"].forEach((k) => {
      const compat =
        k === "sales_area"
          ? so?.salesArea
          : k === "sales_zone"
          ? so?.salesZone
          : k === "zonal_manager"
          ? so?.zonalManager
          : undefined;
      const labelValue =
        k === "sales_area"
          ? pickScopedDisplay(so?.sales_area, so?.sales_area_label)
          : k === "sales_zone"
          ? pickScopedDisplay(so?.sales_zone, so?.sales_zone_label)
          : k === "state"
          ? pickScopedDisplay(so?.state, so?.state_label)
          : undefined;
      const value = labelValue ?? so?.[k] ?? compat;
      if (value !== undefined) {
        setForm((prev) => ({ ...prev, [k]: value }));
      }
    });
  }, [so]);

  useEffect(() => {
    if (!form?.state) return;
    if (form.sales_zone && !isZoneInState(form.state, form.sales_zone)) {
      setForm((prev) => ({ ...prev, sales_zone: "", sales_area: "" }));
    }
  }, [form?.state, form?.sales_zone]);

  useEffect(() => {
    if (!form?.state || !form?.sales_zone) return;
    if (form.sales_area && !isAreaInZone(form.state, form.sales_zone, form.sales_area)) {
      setForm((prev) => ({ ...prev, sales_area: "" }));
    }
  }, [form?.state, form?.sales_zone, form?.sales_area]);

  useEffect(() => {
    if (!form?.assignedConsultant || consultants.length === 0) return;
    const match = consultants.find((c) => c.email === form.assignedConsultant);
    if (match?.name && form.consultantName !== match.name) {
      setForm((prev) => ({ ...prev, consultantName: match.name }));
    }
  }, [form?.assignedConsultant, consultants]);

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
  setForm((prev) => {
    const next = { ...prev, [field]: value };

    const scopeKey = String(field || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    if (scopeKey === "state") {
      next.state = value;
      next.state_label = value;
      next.sales_zone = "";
      next.sales_zone_label = "";
      next.sales_area = "";
      next.sales_area_label = "";
    }

    if (scopeKey === "saleszone" || scopeKey === "zone") {
      next.sales_zone = value;
      next.sales_zone_label = value;
      next.sales_area = "";
      next.sales_area_label = "";
    }

    if (scopeKey === "salesarea") {
      next.sales_area = value;
      next.sales_area_label = value;
    }

    if (field === "assignedConsultant") {
      const match = consultants.find((c) => c.email === value);
      next.consultantName = match?.name || "";
    }
    return next;
  });
};

  // Project utilities
  const projectExists = async (kpiId) => {
    const projRef = collection(db, "projects");
    const q = query(projRef, where("kpiId", "==", kpiId));
    const snap = await getDocs(q);
    return snap.size > 0;
  };

  const createProject = async (salesOrder, totalReceivedArg, pendingArg, percentageArg, sixtyPercentDate) => {
    if (await projectExists(salesOrder.kpiId)) return false;

    const normalizedSixtyDate = toJSDate(sixtyPercentDate) || new Date();
    const rawState = pickScopedDisplay(salesOrder?.state, salesOrder?.state_label);
    const rawZone = pickScopedDisplay(salesOrder?.sales_zone, salesOrder?.sales_zone_label);
    const rawArea = pickScopedDisplay(salesOrder?.sales_area, salesOrder?.sales_area_label);

    const payload = {
      kpiId: salesOrder.kpiId,
      name: salesOrder.name,
      phone: salesOrder.phone,
      address: salesOrder.address,
        projectType: salesOrder.projectType || "Residential",
      capacity: salesOrder.capacity,
      invoiceAmount: salesOrder.invoiceAmount,
      totalReceived: totalReceivedArg,
      pending: pendingArg,
      paymentPercentage: percentageArg,
      salesOrderId: salesOrder.id,
      sixtyPercentReceivedDate: normalizedSixtyDate,
      sixtyPercentDate: normalizedSixtyDate,
      state: normalizeScope(rawState),
      sales_zone: normalizeScope(rawZone),
      sales_area: normalizeScope(rawArea),
      state_label: rawState,
      sales_zone_label: rawZone,
      sales_area_label: rawArea,
      zonal_manager: salesOrder?.zonal_manager || salesOrder?.zonalManager || "",
      teleSale: salesOrder?.teleSale || "",
      consultantName: salesOrder?.consultantName || "",
      assignedConsultant: salesOrder?.assignedConsultant || "",
      createdAt: new Date(),
    };

    await addDoc(collection(db, "projects"), payload);
    return true;
  };


const handleDeleteRecord = async () => {
  if (!isAdmin) return alert("Only admin can delete Sales Orders.");
  if (!window.confirm("Are you sure? This cannot be undone.")) return;

  try {
    const docId = form.id || so?.id;
    await deleteDoc(doc(db, "salesOrders", docId));

    alert("Sales Order deleted successfully");
    onClose();       // closes drawer + refresh happens automatically
  } catch (err) {
    console.error("❌ Delete sales order error:", err);
    alert("Delete failed: " + (err.message || "Unknown error"));
  }
};

  // Save sales order and auto-convert logic (60% but only if project doesn't exist)
  const saveSalesOrder = async () => {
    if (!perm.update) return alert("You do not have permission to update");

    setSaving(true);
    try {
      const ref = doc(db, "salesOrders", so.id);
      const old = so;
      const today = new Date();

      let resolvedConsultantName = form.consultantName || "";
      if (!resolvedConsultantName && form.assignedConsultant) {
        const match = consultants.find((c) => c.email === form.assignedConsultant);
        resolvedConsultantName = match?.name || "";
      }

      let updateData = {
        name: form.name,
        phone: form.phone,
        teleSale: form.teleSale,
        assignedConsultant: form.assignedConsultant || "",
        consultantName: resolvedConsultantName,
        projectType: form.projectType || "Residential",
        paymentMode: form.paymentMode || "",
        payment_mode: form.paymentMode || "",
        description: form.description || "",
        address: form.address,
        capacity: form.capacity,
        invoiceAmount,
        firstPayment: p1,
        secondPayment: p2,
        thirdPayment: p3,
        fourthPayment: p4,
        firstPaymentMode: form.firstPaymentMode || "",
        secondPaymentMode: form.secondPaymentMode || "",
        thirdPaymentMode: form.thirdPaymentMode || "",
        fourthPaymentMode: form.fourthPaymentMode || "",
        first_payment_mode: form.firstPaymentMode || "",
        second_payment_mode: form.secondPaymentMode || "",
        third_payment_mode: form.thirdPaymentMode || "",
        fourth_payment_mode: form.fourthPaymentMode || "",
        paymentReceived: totalReceived,
        pendingPayment: pending,
        paymentPercentage: percentage,
        updatedAt: serverTimestamp(),
        // ✅ FIXED
        updatedBy:
          currentUser.displayName ||
          currentUser.email ||
          "",
      };

      // ✅ normalized scoping fields + labels
      const rawState = pickScopedDisplay(form.state, form.state_label);
      const rawZone = pickScopedDisplay(form.sales_zone, form.sales_zone_label);
      const rawArea = pickScopedDisplay(form.sales_area, form.sales_area_label);

      updateData.state = normalizeScope(rawState);
      updateData.sales_zone = normalizeScope(rawZone);
      updateData.sales_area = normalizeScope(rawArea);
      updateData.state_label = rawState;
      updateData.sales_zone_label = rawZone;
      updateData.sales_area_label = rawArea;
      updateData.zonal_manager = form.zonal_manager || "";

      const setDate = (fieldName, oldVal, newVal, oldDate) => {
        const manualDate = toSafeDate(form[fieldName]);
        if (manualDate && !isNaN(manualDate.getTime())) return manualDate;
        if (newVal > 0) {
          if (!oldDate || newVal > oldVal) return today;
          return oldDate;
        }
        return oldDate || null;
      };

      updateData.firstPaymentDate = setDate("firstPaymentDate", old.firstPayment, p1, old.firstPaymentDate);
      updateData.secondPaymentDate = setDate("secondPaymentDate", old.secondPayment, p2, old.secondPaymentDate);
      updateData.thirdPaymentDate = setDate("thirdPaymentDate", old.thirdPayment, p3, old.thirdPaymentDate);
      updateData.fourthPaymentDate = setDate("fourthPaymentDate", old.fourthPayment, p4, old.fourthPaymentDate);
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
const sixtyTarget = invoiceAmount * (SIXTY_PERCENT_THRESHOLD / 100);

// 1️⃣ YES / NO STATUS
const sixtyPercentReceived = totalReceived >= sixtyTarget ? "YES" : "NO";

// 1.1️⃣ 60% RECEIVED DATE (editable + auto-set)
const raw60Date = form.sixtyPercentReceivedDate;
const parsed60Date = toSafeDate(raw60Date);

if (parsed60Date && !isNaN(parsed60Date.getTime())) {
  updateData.sixtyPercentReceivedDate = parsed60Date;
} else if (sixtyPercentReceived === "YES" && !old.sixtyPercentReceivedDate) {
  updateData.sixtyPercentReceivedDate = new Date();
}

// 2️⃣ DELAY DAYS LOGIC
let sixtyPercentDelayDays = null;

// Delay start date = first actual payment date (token/1st/2nd/3rd/4th, whichever comes first)
const firstPaidDate = getFirstPaidDate(updateData, old);

if (firstPaidDate) {
  const tokenStart = atStartOfDay(firstPaidDate);
  let endDate;

  if (sixtyPercentReceived === "YES") {
    const sixtyDate =
      updateData?.sixtyPercentReceivedDate ||
      old?.sixtyPercentReceivedDate ||
      new Date();
    endDate = toSafeDate(sixtyDate) || new Date();
  } else {
    endDate = new Date();
  }

  const endStart = atStartOfDay(endDate);

  const days =
    tokenStart && endStart
      ? Math.floor((endStart.getTime() - tokenStart.getTime()) / DAY_MS)
      : NaN;
  sixtyPercentDelayDays = Number.isFinite(days) && days >= 0 ? days : 0;
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

let projectAlreadyExists = false;
try {
  projectAlreadyExists = await projectExists(so.kpiId);
} catch (err) {
  console.warn("Could not check if project exists:", err.message);
}

if (isAbove60 && !projectAlreadyExists) {

  try {
    await createProject(
      so,
      totalReceived,
      pending,
      percentage,
      updateData.sixtyPercentReceivedDate || new Date()
    );
    console.log("✔ Auto converted to Project (>=60%)");
    
    // Update sales order status to Converted
    await updateDoc(ref, { status: "Converted", convertedToProject: true });
  } catch (err) {
    console.warn("Could not create project:", err.message);
  }
}

      alert("Sales Order updated successfully");
    } catch (err) {
      console.error("Update error:", err);
      alert("Error updating sales order: " + (err.message || err));
    } finally {
      setSaving(false);
      setTimeout(onClose, 200);
    }
  };

  // -------------------------
  // Payment Receipt generation logic
  // -------------------------
  const company = {
    name: "Kapil Power & Infra (P) Limited",
    addressLine1: "sy no 115/1, kapil towers",
    addressLine2: "nanakramguda, hyderabad, Rangareddy",
    cityLine: "Telangana 500032, India",
    gst: "36AAFCA3811M1ZO",
    logoSrc: kapilLogo,
  };

  const formatDate = (value) => {
    if (!value) return "-";
    const d = toJSDate(value);
    if (!d || isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const money = (value) => `₹ ${Number(value || 0).toLocaleString("en-IN")}`;

  const buildReceiptHtml = (salesOrder) => {
    const totalProjectCost = Number(salesOrder.invoiceAmount || 0);
    const receiptNo = salesOrder.kpiId ? `KPIPL-PR-${salesOrder.kpiId}` : `KPIPL-PR-${Date.now()}`;
    const billToName = salesOrder.name || "Customer";

    const payments = [
      {
        label: "1st Payment",
        amount: Number(salesOrder.firstPayment || 0),
        date: salesOrder.firstPaymentDate,
        mode: salesOrder.firstPaymentMode || salesOrder.first_payment_mode || "-",
      },
      {
        label: "2nd Payment",
        amount: Number(salesOrder.secondPayment || 0),
        date: salesOrder.secondPaymentDate,
        mode: salesOrder.secondPaymentMode || salesOrder.second_payment_mode || "-",
      },
      {
        label: "3rd Payment",
        amount: Number(salesOrder.thirdPayment || 0),
        date: salesOrder.thirdPaymentDate,
        mode: salesOrder.thirdPaymentMode || salesOrder.third_payment_mode || "-",
      },
      {
        label: "4th Payment",
        amount: Number(salesOrder.fourthPayment || 0),
        date: salesOrder.fourthPaymentDate,
        mode: salesOrder.fourthPaymentMode || salesOrder.fourth_payment_mode || "-",
      },
    ].filter((p) => p.amount > 0 || (p.date && formatDate(p.date) !== "-") || (p.mode && p.mode !== "-"));

    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const pendingAmount = Math.max(0, totalProjectCost - totalPaid);
    const paidPercent = totalProjectCost > 0 ? Math.min(100, Math.round((totalPaid / totalProjectCost) * 100)) : 0;
    const modeMeta = {
      upi: { emoji: "🔷", cls: "mode-upi" },
      cash: { emoji: "💸", cls: "mode-cash" },
      loan: { emoji: "🏦", cls: "mode-loan" },
    };

    const getModeBadge = (mode) => {
      const key = String(mode || "").trim().toLowerCase();
      const meta = modeMeta[key] || { emoji: "💳", cls: "mode-default" };
      const text = mode || "Mode";
      return `<span class="mode ${meta.cls}">${meta.emoji} ${text}</span>`;
    };

    const paymentCards = payments.length
      ? payments
          .map(
            (p) => `
              <div class="pay-item">
                <div class="pay-top">
                  <strong>${p.label}</strong>
                  <strong class="plus">+ ${money(p.amount)}</strong>
                </div>
                <div class="pay-meta">
                  ${getModeBadge(p.mode || "Mode")}
                  <span>${formatDate(p.date)}</span>
                </div>
              </div>
            `
          )
          .join("")
      : `<div class="pay-item"><div class="pay-meta"><span>No payments recorded yet.</span></div></div>`;

    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Payment Receipt - ${receiptNo}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 14px; color: #162033; background: radial-gradient(circle at 20% 20%, #e8ecff, #e6f8f1 52%, #edf8ff); padding: 24px; }
          .receipt-wrap { max-width: 860px; margin: 0 auto; border-radius: 18px; overflow: hidden; border: 1px solid #c7d2fe; background: #fff; box-shadow: 0 16px 38px rgba(49, 46, 129, 0.20); }
          .header { background: linear-gradient(135deg, #1f2a78, #2d62b8 45%, #2bb9a9); color: #fff; padding: 20px; }
          .header-row { display: flex; gap: 16px; align-items: center; }
          .logo { width: 140px; border-radius: 10px; background: #fff; padding: 6px; border: 1px solid rgba(255,255,255,.6); }
          .company h2 { margin: 0 0 4px; font-size: 34px; letter-spacing: .3px; text-shadow: 0 2px 8px rgba(0,0,0,.2); }
          .company p { margin: 3px 0; font-size: 13px; }
          .head-meta { margin-top: 8px; font-size: 13px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

          .body { padding: 20px; background: linear-gradient(180deg, #f8faff, #f2f9ff 40%, #f4fffb); }
          .greet { font-size: 34px; font-weight: 700; margin: 0 0 14px; color: #1f2a44; }

          .progress-wrap { background: #e9edff; border-radius: 12px; padding: 12px; margin-bottom: 14px; border: 1px solid #dbe3ff; }
          .progress-top { display: flex; justify-content: space-between; color: #3843b8; font-weight: 700; margin-bottom: 8px; }
          .bar { height: 12px; border-radius: 999px; background: #c7d2fe; overflow: hidden; }
          .bar > span { display: block; height: 100%; width: ${paidPercent}%; border-radius: 999px; background: linear-gradient(90deg, #5b5ce7, #3ea3ff); }

          .summary { border-radius: 14px; background: linear-gradient(135deg, #06b6d4, #29c9a4 65%, #53dd9f); color: #fff; padding: 14px; margin-bottom: 14px; box-shadow: 0 10px 20px rgba(20, 184, 166, .22); }
          .sum-row { display: flex; justify-content: space-between; margin: 8px 0; font-size: 24px; font-weight: 700; }

          .title-line { display: flex; align-items: center; gap: 10px; margin: 16px 0 10px; color: #6b7280; }
          .title-line::before, .title-line::after { content: ""; flex: 1; border-bottom: 1px solid #d1d5db; }

          .pay-item { border: 1px solid #d8e0f0; border-radius: 12px; background: #fff; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 4px 14px rgba(30, 64, 175, .06); }
          .pay-top { display: flex; justify-content: space-between; align-items: center; font-size: 17px; }
          .plus { color: #059669; }
          .pay-meta { display: flex; justify-content: space-between; margin-top: 9px; color: #64748b; font-size: 13px; }
          .mode { border-radius: 999px; padding: 4px 10px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
          .mode-upi { background: #e0e7ff; color: #3730a3; }
          .mode-cash { background: #dcfce7; color: #166534; }
          .mode-loan { background: #cffafe; color: #155e75; }
          .mode-default { background: #f3f4f6; color: #334155; }

          .foot { margin-top: 14px; border-top: 1px solid #e5e7eb; padding-top: 12px; display: block; }
        </style>
      </head>
      <body>
        <div class="receipt-wrap">
          <div class="header">
            <div class="header-row">
              <img class="logo" src="${company.logoSrc}" alt="Kapil Logo" />
              <div class="company">
                <h2>${company.name}</h2>
                <p>${company.addressLine1}</p>
                <p>${company.addressLine2}</p>
                <p>${company.cityLine}</p>
                <p>GST: ${company.gst}</p>
              </div>
            </div>
            <div class="head-meta">
              <strong>Payment Receipt</strong>
              <span>Receipt No: ${receiptNo}</span>
              <span>Date: ${new Date().toLocaleDateString("en-GB")}</span>
              <span>KPI-ID: ${salesOrder.kpiId || "-"}</span>
            </div>
          </div>

          <div class="body">
            <p class="greet">Hi ${billToName},</p>

            <div class="progress-wrap">
              <div class="progress-top">
                <span>Payment Done</span>
                <span>${paidPercent}%</span>
              </div>
              <div class="bar"><span></span></div>
            </div>

            <div class="summary">
              <div class="sum-row"><span>Total Project Cost</span><span>${money(totalProjectCost)}</span></div>
              <div class="sum-row"><span>Payments Received</span><span>${money(totalPaid)}</span></div>
              <div class="sum-row"><span>Payments Due</span><span>${money(pendingAmount)}</span></div>
            </div>

            <div class="title-line">Payment Received</div>
            ${paymentCards}

            <div class="foot">
              <div>
                <div><strong>Address:</strong> ${salesOrder.address || "-"}</div>
                <div><strong>Phone:</strong> ${salesOrder.phone || "-"}</div>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      html,
      filename: `${receiptNo}.pdf`,
    };
  };

  const buildReceiptPdfBlobFromHtml = async (html, filename) => {
    if (!html) return;

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-10000px";
    wrapper.style.top = "0";
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    const element = wrapper.querySelector(".receipt-wrap");
    if (!element) {
      document.body.removeChild(wrapper);
      return alert("Unable to generate payment receipt.");
    }

    try {
      const worker = html2pdf()
        .from(element)
        .set({
          margin: 8,
          filename: filename || "payment-receipt.pdf",
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        });

      if (typeof worker.outputPdf === "function") {
        return await worker.outputPdf("blob");
      }

      const pdf = await worker.toPdf().get("pdf");
      return pdf.output("blob");
    } catch (err) {
      console.error("Payment receipt PDF build failed:", err);
      throw err;
    } finally {
      document.body.removeChild(wrapper);
    }
  };

  const downloadReceiptPdfFromHtml = async (html, filename) => {
    try {
      const blob = await buildReceiptPdfBlobFromHtml(html, filename);
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "payment-receipt.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not download payment receipt. Please try again.");
    }
  };

  const shareReceiptPdfFromHtml = async (html, filename) => {
    if (!navigator?.share) {
      alert("Share is not supported on this device/browser.");
      return;
    }

    setSharingReceipt(true);
    try {
      const blob = await buildReceiptPdfBlobFromHtml(html, filename);
      if (!blob) return;

      const safeFileName = filename || `KPIPL-PR-${activeKpiId}.pdf`;
      const file = new File([blob], safeFileName, { type: "application/pdf" });
      const baseData = {
        title: "Payment Receipt",
        text: `Payment receipt for KPI ${activeKpiId}`,
      };

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ ...baseData, files: [file] });
      } else {
        await navigator.share(baseData);
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.error("Payment receipt share failed:", err);
        alert("Could not share payment receipt.");
      }
    } finally {
      setSharingReceipt(false);
    }
  };

  const createInvoicePdf = (salesOrder) => {
    const built = buildReceiptHtml(salesOrder);
    setReceiptPreview({
      open: true,
      html: built.html,
      filename: built.filename,
    });
  };

  // -------------------------
  // Render UI
  // -------------------------
  const label = { display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13, color: "#800000" };
  const input = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(128,0,0,0.28)", marginBottom: 12, background: canEdit ? "#fff" : "#f6f6f6", fontSize: 13, color: "#111827" };
  const dateText = { fontSize: 12, color: "#555", marginTop: -8, marginBottom: 12 };

  // dynamic input renderer
  const renderDynamicInput = (fd) => {
    const val = form[fd.name] ?? "";
    const commonStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(128,0,0,0.28)", marginBottom: 12, background: canEdit ? "#fff" : "#f6f6f6", fontSize: 13, color: "#111827" };
    const t = (fd.type || "text").toLowerCase();

    const fieldKey = String(fd.name || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    const isStateField = fieldKey === "state";
    const isZoneField = fieldKey === "saleszone" || fieldKey === "zone";
    const isAreaField = fieldKey === "salesarea";

    if (isStateField) {
      const states = getStateOptions();
      return (
        <select value={val ?? ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update}>
          <option value="">Select</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      );
    }

    if (isZoneField) {
      const zones = getZoneOptions(form.state);
      return (
        <select value={val ?? ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update || !form.state}>
          <option value="">Select</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      );
    }

    if (isAreaField) {
      const areas = getAreaOptions(form.state, form.sales_zone);
      return (
        <select value={val ?? ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update || !form.state || !form.sales_zone}>
          <option value="">Select</option>
          {areas.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      );
    }

    switch (t) {
      case "textarea":
        return <textarea value={val} onChange={(e) => handleChange(fd.name, e.target.value)} rows={3} style={{ ...commonStyle, minHeight: 80 }} disabled={!perm.update} />;
      case "date":
        return <input type="date" value={val ? String(val).split("T")[0] : ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update} />;
      case "checkbox":
        return <input type="checkbox" checked={!!val} onChange={(e) => handleChange(fd.name, e.target.checked)} disabled={!perm.update} />;
      case "select":
      case "picklist":
        if (isZonalManagerField(fd.name)) {
          return (
            <select value={val ?? ""} onChange={(e) => handleChange(fd.name, e.target.value)} style={commonStyle} disabled={!perm.update}>
              <option value="">Select</option>
              {ZONAL_MANAGER_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          );
        }

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
    width: isMobileView ? "100%" : "min(620px, 100vw)",
    height: "100vh",
    background: "#fff",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.2)",
    padding: isMobileView ? 12 : 16,
    overflowY: "auto",
    overscrollBehavior: "contain",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    zIndex: 999999,
    paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
  }}
>
      <h2 style={{ color: "#800000", marginRight: 88, marginBottom: 8 }}>Sales Order Details</h2>

      <button onClick={onClose} style={{ position: "absolute", right: 16, top: 16, padding: "6px 10px", border: "1px solid #800000", color: "#800000", background: "#fff", borderRadius: 6 }}>
        Close
      </button>

      <div
        style={{
          display: "inline-block",
          marginBottom: 14,
          background: "#fff7e6",
          color: "#800000",
          border: "1px solid #f3d7a8",
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        KPI ID: {activeKpiId}
      </div>

      <label style={label}>Customer Name</label>
      <input style={input} value={form.name} onChange={(e) => handleChange("name", e.target.value)} disabled={!canEdit} />

      <label style={label}>Phone</label>
      <input style={input} value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} disabled={!canEdit} />

      <label style={label}>Tele-Sales</label>
      <SearchableSelect
        options={teleUsers}
        value={form.teleSale || ""}
        onChange={(next) => handleChange("teleSale", next || "")}
        placeholder="Search Tele-Caller / Team Lead"
        getOptionValue={(u) => u.name || u.email || u.id}
        getOptionLabel={(u) => `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}`}
        getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""}`}
        allowClear
      />

      <label style={label}>Consultant Name</label>
      <input style={input} value={form.consultantName} onChange={(e) => handleChange("consultantName", e.target.value)} disabled={!canEdit} />

      <label style={label}>Assigned Consultant</label>
      <SearchableSelect
        options={consultants}
        value={form.assignedConsultant || ""}
        onChange={(next) => handleChange("assignedConsultant", next || "")}
        placeholder="Search consultant by name or email"
        getOptionValue={(c) => c.email || c.name || c.id}
        getOptionLabel={(c) => `${c.name || c.email}${c.email && c.name ? ` (${c.email})` : ""}`}
        getOptionSearchText={(c) => `${c.name || ""} ${c.email || ""}`}
        allowClear
      />

      <label style={label}>Address</label>
      <input style={input} value={form.address} onChange={(e) => handleChange("address", e.target.value)} disabled={!canEdit} />

      <label style={label}>Capacity (kW)</label>
      <input style={input} type="number" value={form.capacity} onChange={(e) => handleChange("capacity", e.target.value)} disabled={!canEdit} />

      <label style={label}>Project Type</label>
      <select
        style={input}
        value={form.projectType || "Residential"}
        onChange={(e) => handleChange("projectType", e.target.value)}
        disabled={!canEdit}
      >
        <option value="Residential">Residential</option>
        <option value="Commercial">Commercial</option>
      </select>

      <label style={label}>Invoice Amount</label>
      <input style={input} type="number" value={form.invoiceAmount} onChange={(e) => handleChange("invoiceAmount", e.target.value)} disabled={!canEdit} />

      <h3 style={{ marginTop: 20 }}>Payments</h3>
      {[
        ["1st Payment", "firstPayment", "firstPaymentDate", "firstPaymentMode"],
        ["2nd Payment", "secondPayment", "secondPaymentDate", "secondPaymentMode"],
        ["3rd Payment", "thirdPayment", "thirdPaymentDate", "thirdPaymentMode"],
        ["4th Payment", "fourthPayment", "fourthPaymentDate", "fourthPaymentMode"],
      ].map(([labelText, field, dateField, modeField]) => (
        <div key={field}>
          <label style={label}>{labelText}</label>
          <input style={input} type="number" value={form[field]} onChange={(e) => handleChange(field, e.target.value)} disabled={!canEdit} />
          <input
            style={input}
            type="date"
            value={
              form[dateField]?.seconds
                ? new Date(form[dateField].seconds * 1000).toISOString().split("T")[0]
                : form[dateField]
                  ? String(form[dateField]).split("T")[0]
                  : ""
            }
            onChange={(e) => handleChange(dateField, e.target.value)}
            disabled={!canEdit}
          />
          <select
            style={input}
            value={form[modeField] || ""}
            onChange={(e) => handleChange(modeField, e.target.value)}
            disabled={!canEdit}
          >
            <option value="">Select payment mode</option>
            {INSTALLMENT_PAYMENT_MODE_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
          {formatDateValue(form[dateField]) && (
            <p style={dateText}>Date: {formatDateValue(form[dateField])}</p>
          )}
        </div>
      ))}

      <label style={{ ...label, marginTop: 10 }}>60% Received Date</label>
      <input
        style={input}
        type="date"
        value={
          form.sixtyPercentReceivedDate?.seconds
            ? new Date(form.sixtyPercentReceivedDate.seconds * 1000).toISOString().split("T")[0]
            : form.sixtyPercentReceivedDate
              ? String(form.sixtyPercentReceivedDate).split("T")[0]
              : ""
        }
        onChange={(e) => handleChange("sixtyPercentReceivedDate", e.target.value)}
        disabled={!canEdit}
      />

      <label style={{ ...label, marginTop: 12 }}>Payment Mode</label>
      <select
        style={input}
        value={form.paymentMode || form.payment_mode || ""}
        onChange={(e) => handleChange("paymentMode", e.target.value)}
        disabled={!canEdit}
      >
        <option value="">Select payment mode</option>
        {OVERALL_PAYMENT_MODE_OPTIONS.map((mode) => (
          <option key={mode} value={mode}>{mode}</option>
        ))}
      </select>

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
          {[...fieldsDef]
            .sort((a, b) => {
              const key = (x) =>
                String(x?.name || "")
                  .trim()
                  .toLowerCase()
                  .replace(/[\s_-]+/g, "");
              const tailOrder = ["salesarea", "saleszone", "state", "zonalmanager"];
              const ai = tailOrder.indexOf(key(a));
              const bi = tailOrder.indexOf(key(b));
              const aTail = ai !== -1;
              const bTail = bi !== -1;
              if (aTail !== bTail) return aTail ? 1 : -1;
              if (!aTail && !bTail) return 0;
              return ai - bi;
            })
            .map((fd) => (
            <div key={fd.name} style={{ marginTop: 8 }}>
              <label style={label}>{fd.label}{fd.required ? " *" : ""}</label>
              {renderDynamicInput(fd)}
            </div>
          ))}
        </div>
      )}

      {/* Convert to Project (keeps your existing behavior) */}
      {canEdit && (
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

      {/* Create Payment Receipt button (under Convert to Project) */}
      {canEdit && (
        <button
          onClick={() => createInvoicePdf(form)}
          style={{ marginTop: 12, width: "100%", padding: 12, background: "#800000", color: "#fff", border: "none", borderRadius: 6, fontWeight: "bold" }}
        >
          Preview Payment Receipt
        </button>
      )}

      <label style={label}>Description / Notes</label>
      <textarea
        rows={3}
        style={{ ...input, minHeight: 88, resize: "vertical" }}
        value={form.description || ""}
        onChange={(e) => handleChange("description", e.target.value)}
        disabled={!canEdit}
        placeholder="Add notes or payment receipt description"
      />

      {/* Save */}
     {/* Spacer so content doesn't hide behind fixed buttons */}
<div style={{ height: "140px" }}></div>
{/* ATTACHMENTS SECTION */}
<div style={{ marginTop: 30 }}>
  <h3 style={{ color: "#800000" }}>Attachments</h3>
  <AttachmentFolderTiles
    kpiId={form?.kpiId || so?.kpiId}
    customerName={form?.name || so?.name}
    from="salesOrders"
  />
</div>

{/* FIXED BOTTOM BUTTON BAR */}
<div
  style={{
    position: "sticky",
    bottom: 0,
    background: "#fff",
    borderTop: "1px solid #eee",
    padding: 12,
    display: "flex",
    gap: 10,
    marginTop: 20,
    paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
  }}
>
  {canEdit && (
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
      style={styles.deleteBtn}
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

{receiptPreview.open && typeof document !== "undefined" && createPortal(
  <div
    onClick={() => setReceiptPreview({ open: false, html: "", filename: "" })}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.75)",
      zIndex: 2147483647,
      display: "flex",
      alignItems: "stretch",
      justifyContent: "stretch",
      padding: 0,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: "100vw",
        height: "100vh",
        background: "#fff",
        borderRadius: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #eee", background: "#fff" }}>
        <strong style={{ color: "#800000" }}>Payment Receipt Preview</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => shareReceiptPdfFromHtml(receiptPreview.html, receiptPreview.filename)}
            disabled={sharingReceipt}
            style={{ border: "none", borderRadius: 8, background: "#0b7a3e", color: "#fff", padding: "8px 12px", fontWeight: 700, cursor: sharingReceipt ? "not-allowed" : "pointer", opacity: sharingReceipt ? 0.7 : 1 }}
          >
            {sharingReceipt ? "Sharing..." : "Share"}
          </button>
          <button
            onClick={() => downloadReceiptPdfFromHtml(receiptPreview.html, receiptPreview.filename)}
            style={{ border: "none", borderRadius: 8, background: "#800000", color: "#fff", padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
          >
            Download PDF
          </button>
          <button
            onClick={() => setReceiptPreview({ open: false, html: "", filename: "" })}
            style={{ border: "1px solid #800000", borderRadius: 8, background: "#fff", color: "#800000", padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>
      <iframe title="Payment Receipt Preview" srcDoc={receiptPreview.html} style={{ border: 0, width: "100%", flex: 1, background: "#fff" }} />
    </div>
  </div>,
  document.body
)}
    </div>
  );
};

const styles = {
  deleteBtn: {
    flex: 1,
    background: "linear-gradient(135deg, #b91c1c, #dc2626)",
    color: "white",
    padding: "12px 0",
    borderRadius: 8,
    border: "none",
    fontWeight: 700,
    boxShadow: "0 6px 16px rgba(185,28,28,0.25)",
    cursor: "pointer",
  },
};


// small helper for pretty label (same pattern used elsewhere)
function prettyLabel(name) {
  if (!name) return "";
  return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
