import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../../firebaseConfig";
import { fetchCollectionDocs } from "../../../helpers/firestoreFetch";
import {
  createDocumentREST,
  updateDocumentREST,
  deleteDocumentREST,
} from "../../../helpers/firestoreRest";
import { getAreaOptions, getStateOptions, getZoneOptions } from "../../../helpers/salesRegions";

const PAYMENT_TYPES = [
  { key: "first", label: "1st Payment" },
  { key: "second", label: "2nd Payment" },
  { key: "third", label: "3rd Payment" },
  { key: "fourth", label: "4th Payment" },
];

const RECEIVABLES_COLLECTION = "books_payment_receivables";

const sanitizePathChunk = (v) =>
  String(v || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

function getAmountReceived(order) {
  return (order.payments || []).reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );
}

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

const parseDateSafe = (value) => {
  if (!value) return null;
  if (value?.toDate && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const hiddenDocIdForKpi = (kpiValue) => {
  const safe = String(kpiValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
  return `hidden_${safe || "unknown"}`;
};

const salesOrderToPayments = (so = {}) => {
  const rows = [
    ["first", "1st Payment", "firstPayment", "firstPaymentDate"],
    ["second", "2nd Payment", "secondPayment", "secondPaymentDate"],
    ["third", "3rd Payment", "thirdPayment", "thirdPaymentDate"],
    ["fourth", "4th Payment", "fourthPayment", "fourthPaymentDate"],
  ];

  return rows
    .map(([key, label, amountKey, dateKey]) => {
      const amount = Number(so?.[amountKey] || 0);
      const dateObj = parseDateSafe(so?.[dateKey]);
      if (amount <= 0 && !dateObj) return null;
      return {
        id: `so-${so.id || so.kpiId || "row"}-${key}`,
        type: key,
        label,
        utr: "",
        amount,
        date: dateObj ? dateObj.toISOString().split("T")[0] : "",
        created_at: dateObj ? dateObj.toISOString() : "",
      };
    })
    .filter(Boolean);
};

const normalizePaymentsArray = (payments = []) =>
  (Array.isArray(payments) ? payments : []).map((p, idx) => {
    const key = p?.type || PAYMENT_TYPES[idx]?.key || `custom_${idx + 1}`;
    const label = p?.label || PAYMENT_TYPES.find((t) => t.key === key)?.label || `${idx + 1} Payment`;
    return {
      ...p,
      id: p?.id || `pay-${key}-${idx + 1}`,
      type: key,
      label,
      amount: Number(p?.amount || 0),
      utr: p?.utr || "",
      date: p?.date || "",
      receiptUrl: p?.receiptUrl || "",
    };
  });

const PaymentReceivables = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [drawerError, setDrawerError] = useState("");
  const [filterKpi, setFilterKpi] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [manualDrawerOpen, setManualDrawerOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    kpi_id: "",
    customer_name: "",
    contact_number: "",
    state: "",
    sales_zone: "",
    sales_area: "",
    invoice_amount: "",
  });
  const [manualError, setManualError] = useState("");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    utr: "",
    amount: "",
    date: "",
  });
  const [paymentReceiptFile, setPaymentReceiptFile] = useState(null);
  const [editPaymentId, setEditPaymentId] = useState(null);
  const [paymentEditForm, setPaymentEditForm] = useState({
    utr: "",
    amount: "",
    date: "",
  });
  const [paymentEditReceiptFile, setPaymentEditReceiptFile] = useState(null);
  const [busyPaymentId, setBusyPaymentId] = useState("");
  const [editForm, setEditForm] = useState({
    kpi_id: "",
    customer_name: "",
    contact_number: "",
    state: "",
    sales_zone: "",
    sales_area: "",
    invoice_amount: "",
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const stateOptions = getStateOptions();
  const manualZoneOptions = useMemo(() => getZoneOptions(manualForm.state), [manualForm.state]);
  const manualAreaOptions = useMemo(
    () => getAreaOptions(manualForm.state, manualForm.sales_zone),
    [manualForm.state, manualForm.sales_zone]
  );
  const editZoneOptions = useMemo(() => getZoneOptions(editForm.state), [editForm.state]);
  const editAreaOptions = useMemo(
    () => getAreaOptions(editForm.state, editForm.sales_zone),
    [editForm.state, editForm.sales_zone]
  );

  const refreshOrders = async () => {
    setLoading(true);
    try {
      const [salesOrders, manualRows] = await Promise.all([
        fetchCollectionDocs("salesOrders"),
        fetchCollectionDocs(RECEIVABLES_COLLECTION),
      ]);

      const hiddenKpis = new Set(
        (manualRows || [])
          .filter((r) => r?.hidden === true)
          .map((r) => String(r?.kpi_id || "").trim().toLowerCase())
          .filter(Boolean)
      );

      const normalizedFromSO = (salesOrders || []).map((so) => ({
        id: `so-${so.id || so.kpiId || so.autoId || Math.random().toString(36).slice(2, 7)}`,
        source: "sales_order",
        sourceDocId: so.id || "",
        receivableDocId: null,
        kpi_id: so.kpiId || so.autoId || "",
        customer_name: so.name || so.customerName || "",
        contact_number: so.phone || so.contactNumber || "",
        state: pickScopedDisplay(so.state, so.state_label) || "",
        sales_zone: pickScopedDisplay(so.sales_zone, so.sales_zone_label) || so.salesZone || "",
        sales_area: pickScopedDisplay(so.sales_area, so.sales_area_label) || so.salesArea || "",
        invoice_amount: Number(so.invoiceAmount || so.invoice_amount || 0),
        payments: salesOrderToPayments({ ...so, id: so.id }),
        created_at:
          parseDateSafe(so.createdAt)?.toISOString() ||
          parseDateSafe(so.updatedAt)?.toISOString() ||
          new Date().toISOString(),
      }))
      .filter((row) => !hiddenKpis.has(String(row.kpi_id || "").trim().toLowerCase()));

      const normalizedManual = (manualRows || [])
      .filter((r) => r?.hidden !== true)
      .map((r) => ({
        ...r,
        source: "manual",
        receivableDocId: r.id || "",
        state: r.state || "",
        sales_zone: r.sales_zone || "",
        sales_area: r.sales_area || "",
        invoice_amount: Number(r.invoice_amount || 0),
        payments: normalizePaymentsArray(r.payments),
      }));

      const byKpi = new Map();
      normalizedFromSO.forEach((row) => {
        byKpi.set(String(row.kpi_id || "").trim().toLowerCase(), row);
      });

      const extras = [];
      normalizedManual.forEach((row) => {
        const key = String(row.kpi_id || "").trim().toLowerCase();
        const base = key ? byKpi.get(key) : null;
        if (base) {
          const mergedPayments = [...(base.payments || []), ...(row.payments || [])];
          byKpi.set(key, {
            ...base,
            payments: mergedPayments,
            invoice_amount: base.invoice_amount > 0 ? base.invoice_amount : Number(row.invoice_amount || 0),
            receivableDocId: row.receivableDocId || base.receivableDocId || null,
          });
          return;
        }
        extras.push(row);
      });

      const normalized = [...Array.from(byKpi.values()), ...extras].sort((a, b) => {
        const at = new Date(a.created_at || 0).getTime();
        const bt = new Date(b.created_at || 0).getTime();
        return bt - at;
      });

      setOrders(normalized);
    } catch {
      setDrawerError("Failed to load records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshOrders();
  }, []);

  const activeOrder = useMemo(
    () => orders.find((o) => o.id === activeOrderId) || null,
    [orders, activeOrderId]
  );

  const handleOpenDrawer = (order) => {
    setActiveOrderId(order.id);
    setEditForm({
      kpi_id: order.kpi_id || "",
      customer_name: order.customer_name || "",
      contact_number: order.contact_number || "",
      state: order.state || "",
      sales_zone: order.sales_zone || "",
      sales_area: order.sales_area || "",
      invoice_amount: String(order.invoice_amount || ""),
    });
    setDrawerError("");
    setShowPaymentForm(false);
    setPaymentForm({ utr: "", amount: "", date: "" });
    setPaymentReceiptFile(null);
    setEditPaymentId(null);
    setPaymentEditForm({ utr: "", amount: "", date: "" });
    setPaymentEditReceiptFile(null);
  };

  const handleCloseDrawer = () => {
    setActiveOrderId(null);
    setDrawerError("");
    setShowPaymentForm(false);
    setPaymentForm({ utr: "", amount: "", date: "" });
    setPaymentReceiptFile(null);
    setEditPaymentId(null);
    setPaymentEditForm({ utr: "", amount: "", date: "" });
    setPaymentEditReceiptFile(null);
  };

  const getReceivableDocId = (order, fallbackKpi) => {
    if (order?.receivableDocId) return order.receivableDocId;
    const kpiRaw = fallbackKpi || order?.kpi_id || order?.sourceDocId || "";
    const safe = sanitizePathChunk(kpiRaw).toLowerCase();
    return `recv_${safe || "unknown"}`;
  };

  const buildReceivablePayload = (order, overrides = {}) => {
    const nextKpi = overrides.kpi_id ?? order?.kpi_id ?? "";
    const nextPayments = Array.isArray(overrides.payments)
      ? overrides.payments
      : Array.isArray(order?.payments)
        ? order.payments
        : [];

    return {
      kpi_id: nextKpi,
      customer_name: overrides.customer_name ?? order?.customer_name ?? "",
      contact_number: overrides.contact_number ?? order?.contact_number ?? "",
      state: overrides.state ?? order?.state ?? "",
      state_label: overrides.state_label ?? overrides.state ?? order?.state ?? "",
      sales_zone: overrides.sales_zone ?? order?.sales_zone ?? "",
      sales_zone_label: overrides.sales_zone_label ?? overrides.sales_zone ?? order?.sales_zone ?? "",
      sales_area: overrides.sales_area ?? order?.sales_area ?? "",
      sales_area_label: overrides.sales_area_label ?? overrides.sales_area ?? order?.sales_area ?? "",
      invoice_amount: Number(overrides.invoice_amount ?? order?.invoice_amount ?? 0),
      payments: nextPayments,
      source: "manual",
      updated_at: new Date().toISOString(),
      ...(order?.created_at ? {} : { created_at: new Date().toISOString() }),
      ...overrides,
    };
  };

  const uploadReceiptForPayment = async ({ order, paymentType, file }) => {
    if (!file) return "";
    const kpi = sanitizePathChunk(order?.kpi_id || order?.sourceDocId || "record");
    const type = sanitizePathChunk(paymentType || "payment");
    const filename = sanitizePathChunk(file.name || `receipt_${Date.now()}`);
    const fileRef = ref(storage, `books/payment-receivables/${kpi}/${type}/${Date.now()}_${filename}`);
    await uploadBytes(fileRef, file, { contentType: file.type || undefined });
    return getDownloadURL(fileRef);
  };

  const persistOrderPayments = async (order, payments, extra = {}) => {
    const docId = getReceivableDocId(order);
    const payload = buildReceivablePayload(order, {
      ...extra,
      payments,
    });

    if (order?.receivableDocId) {
      await updateDocumentREST(RECEIVABLES_COLLECTION, docId, payload);
      return docId;
    }

    await createDocumentREST(RECEIVABLES_COLLECTION, payload, null, docId);
    return docId;
  };

  const handleCreateRecord = async (e) => {
    e.preventDefault();
    setManualError("");
    if (
      !manualForm.kpi_id ||
      !manualForm.customer_name ||
      !manualForm.contact_number ||
      !manualForm.state ||
      !manualForm.sales_zone ||
      !manualForm.sales_area ||
      !manualForm.invoice_amount
    ) {
      setManualError("All fields are required.");
      return;
    }
    const invoiceAmount = Number(manualForm.invoice_amount || 0);
    if (invoiceAmount <= 0) {
      setManualError("Invoice Amount must be greater than 0.");
      return;
    }
    const docId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRecord = {
      kpi_id: manualForm.kpi_id,
      customer_name: manualForm.customer_name,
      contact_number: manualForm.contact_number,
      state: manualForm.state,
      state_label: manualForm.state,
      sales_zone: manualForm.sales_zone,
      sales_zone_label: manualForm.sales_zone,
      sales_area: manualForm.sales_area,
      sales_area_label: manualForm.sales_area,
      invoice_amount: invoiceAmount,
      payments: [],
      created_at: new Date().toISOString(),
    };
    try {
      await createDocumentREST(RECEIVABLES_COLLECTION, newRecord, null, docId);
      await deleteDocumentREST(RECEIVABLES_COLLECTION, hiddenDocIdForKpi(manualForm.kpi_id)).catch(() => {});
      setManualDrawerOpen(false);
      setManualForm({
        kpi_id: "",
        customer_name: "",
        contact_number: "",
        state: "",
        sales_zone: "",
        sales_area: "",
        invoice_amount: "",
      });
      await refreshOrders();
    } catch {
      setManualError("Failed to save record. Please try again.");
    }
  };

  const handleSaveRecord = async () => {
    if (!activeOrder) return;
    setDrawerError("");
    if (
      !editForm.kpi_id ||
      !editForm.customer_name ||
      !editForm.contact_number ||
      !editForm.state ||
      !editForm.sales_zone ||
      !editForm.sales_area ||
      !editForm.invoice_amount
    ) {
      setDrawerError("All record fields are required.");
      return;
    }
    const invoiceAmount = Number(editForm.invoice_amount || 0);
    const received = getAmountReceived(activeOrder);
    if (invoiceAmount < received) {
      setDrawerError("Invoice Amount cannot be less than Amount Received.");
      return;
    }

    try {
      const docId = getReceivableDocId(activeOrder, editForm.kpi_id);
      const payload = buildReceivablePayload(activeOrder, {
        kpi_id: editForm.kpi_id,
        customer_name: editForm.customer_name,
        contact_number: editForm.contact_number,
        state: editForm.state,
        state_label: editForm.state,
        sales_zone: editForm.sales_zone,
        sales_zone_label: editForm.sales_zone,
        sales_area: editForm.sales_area,
        sales_area_label: editForm.sales_area,
        invoice_amount: invoiceAmount,
      });

      if (activeOrder.receivableDocId) {
        await updateDocumentREST(RECEIVABLES_COLLECTION, docId, payload);
      } else {
        await createDocumentREST(RECEIVABLES_COLLECTION, payload, null, docId);
      }

      await refreshOrders();
      handleCloseDrawer();
    } catch {
      setDrawerError("Failed to save record.");
    }
  };

  const handleDeleteRecord = async () => {
    if (!activeOrder) return;

    const orderToDelete = activeOrder;
    setOrders((prev) => prev.filter((row) => row.id !== orderToDelete.id));
    handleCloseDrawer();

    try {
      if (orderToDelete.source === "sales_order") {
        const kpi = String(orderToDelete.kpi_id || "").trim();
        if (!kpi) throw new Error("Missing KPI for delete");

        await createDocumentREST(
          RECEIVABLES_COLLECTION,
          {
            kpi_id: kpi,
            hidden: true,
            hidden_at: new Date().toISOString(),
            source: "receivables_hide",
          },
          null,
          hiddenDocIdForKpi(kpi)
        );
      } else {
        await deleteDocumentREST(RECEIVABLES_COLLECTION, orderToDelete.id);
      }

      await refreshOrders();
    } catch {
      await refreshOrders();
      setDrawerError("Failed to delete record.");
    }
  };

  const handleAddPayment = async (e) => {
    e.preventDefault();
    if (!activeOrder) return;
    setDrawerError("");

    const nextType = PAYMENT_TYPES[(activeOrder.payments || []).length];
    if (!nextType) {
      setDrawerError("Maximum 4 payments reached.");
      return;
    }

    const amount = Number(paymentForm.amount || 0);
    const pendingAmount = Number(activeOrder.invoice_amount || 0) - getAmountReceived(activeOrder);

    if (!paymentForm.utr || !paymentForm.date || amount <= 0) {
      setDrawerError("Payment UTR, amount, and date are required.");
      return;
    }
    if (amount > pendingAmount) {
      setDrawerError("Payment exceeds pending amount.");
      return;
    }

    const newPayment = {
      id: `pay-${Date.now()}`,
      type: nextType.key,
      label: nextType.label,
      utr: paymentForm.utr,
      amount,
      date: paymentForm.date,
      receiptUrl: "",
      created_at: new Date().toISOString(),
    };

    try {
      let receiptUrl = "";
      if (paymentReceiptFile) {
        receiptUrl = await uploadReceiptForPayment({
          order: activeOrder,
          paymentType: nextType.key,
          file: paymentReceiptFile,
        });
      }

      const nextPayments = [...(activeOrder.payments || []), { ...newPayment, receiptUrl }];
      await persistOrderPayments(activeOrder, nextPayments);
      await refreshOrders();
      setPaymentForm({ utr: "", amount: "", date: "" });
      setPaymentReceiptFile(null);
      setShowPaymentForm(false);
    } catch {
      setDrawerError("Failed to save payment.");
    }
  };

  const startEditPayment = (payment) => {
    setEditPaymentId(payment.id);
    setPaymentEditForm({
      utr: payment.utr || "",
      amount: String(payment.amount ?? ""),
      date: payment.date || "",
    });
    setPaymentEditReceiptFile(null);
    setDrawerError("");
  };

  const cancelEditPayment = () => {
    setEditPaymentId(null);
    setPaymentEditForm({ utr: "", amount: "", date: "" });
    setPaymentEditReceiptFile(null);
  };

  const saveEditedPayment = async (payment) => {
    if (!activeOrder) return;
    setDrawerError("");

    const nextAmount = Number(paymentEditForm.amount || 0);
    if (!paymentEditForm.utr || !paymentEditForm.date || nextAmount <= 0) {
      setDrawerError("UTR, amount, and date are required to update payment.");
      return;
    }

    const otherTotal = (activeOrder.payments || [])
      .filter((p) => p.id !== payment.id)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const invoiceAmount = Number(editForm.invoice_amount || activeOrder.invoice_amount || 0);
    if (otherTotal + nextAmount > invoiceAmount) {
      setDrawerError("Updated payment exceeds invoice amount.");
      return;
    }

    try {
      setBusyPaymentId(payment.id);
      let receiptUrl = payment.receiptUrl || "";
      if (paymentEditReceiptFile) {
        receiptUrl = await uploadReceiptForPayment({
          order: activeOrder,
          paymentType: payment.type,
          file: paymentEditReceiptFile,
        });
      }

      const updatedPayments = (activeOrder.payments || []).map((p) => {
        if (p.id !== payment.id) return p;
        return {
          ...p,
          utr: paymentEditForm.utr,
          amount: nextAmount,
          date: paymentEditForm.date,
          receiptUrl,
          updated_at: new Date().toISOString(),
        };
      });

      await persistOrderPayments(activeOrder, updatedPayments);
      await refreshOrders();
      cancelEditPayment();
    } catch {
      setDrawerError("Failed to update payment.");
    } finally {
      setBusyPaymentId("");
    }
  };

  let filteredOrders = orders;
  if (filterKpi) {
    filteredOrders = filteredOrders.filter((o) =>
      (o.kpi_id || "").toLowerCase().includes(filterKpi.toLowerCase())
    );
  }
  if (filterDate) {
    filteredOrders = filteredOrders.filter((o) =>
      (o.payments || []).some((p) => p.date === filterDate)
    );
  }

  const totals = filteredOrders.reduce(
    (acc, order) => {
      const invoice = Number(order.invoice_amount || 0);
      const received = getAmountReceived(order);
      const pending = Math.max(0, invoice - received);
      acc.received += received;
      acc.pending += pending;
      return acc;
    },
    { received: 0, pending: 0 }
  );

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedOrders = filteredOrders.slice(startIdx, startIdx + perPage);

  // Export to Excel
  const handleExport = () => {
    setExporting(true);
    const data = filteredOrders.map((order) => {
      const amountReceived = getAmountReceived(order);
      const pendingAmount = Number(order.invoice_amount || 0) - amountReceived;
      return {
        "KPI-ID": order.kpi_id,
        "Customer Name": order.customer_name,
        "Contact Number": order.contact_number,
        "Sales Zone": order.sales_zone,
        "Sales Area": order.sales_area,
        "Invoice Amount": order.invoice_amount,
        "Amount Received": amountReceived,
        "Pending Amount": pendingAmount,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Receivables");
    XLSX.writeFile(wb, "PaymentReceivables.xlsx");
    setExporting(false);
  };

  return (
    <div style={{ paddingLeft: 16 }}>
      <style>{`
        .kp-scroll-hide {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .kp-scroll-hide::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ color: "#800000", marginBottom: 0 }}>Payment Receivables</h2>
        <button
          style={{ background: "#800000", color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          onClick={() => setManualDrawerOpen(true)}
        >
          + Add Manual Payment
        </button>
      </div>
      <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="Filter by KPI-ID"
          value={filterKpi}
          onChange={(e) => setFilterKpi(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: "1px solid #800000" }}
        />
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: "1px solid #800000" }}
        />
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            background: "#800000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "6px 16px",
          }}
        >
          Export
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            border: "1px solid rgba(128,0,0,0.2)",
            borderRadius: 10,
            background: "linear-gradient(135deg, #fff, #fff7f7)",
            padding: "12px 14px",
            boxShadow: "0 6px 16px rgba(128,0,0,0.08)",
          }}
        >
          <div style={{ color: "#9a3a3a", fontSize: 12, fontWeight: 700 }}>Total Receivables (Received)</div>
          <div style={{ color: "#800000", fontWeight: 800, fontSize: 24, marginTop: 4 }}>
            ₹{totals.received.toLocaleString()}
          </div>
        </div>

        <div
          style={{
            border: "1px solid rgba(128,0,0,0.2)",
            borderRadius: 10,
            background: "linear-gradient(135deg, #fff, #fff7f7)",
            padding: "12px 14px",
            boxShadow: "0 6px 16px rgba(128,0,0,0.08)",
          }}
        >
          <div style={{ color: "#9a3a3a", fontSize: 12, fontWeight: 700 }}>Pending Receivables</div>
          <div style={{ color: "#800000", fontWeight: 800, fontSize: 24, marginTop: 4 }}>
            ₹{totals.pending.toLocaleString()}
          </div>
        </div>
      </div>

      {manualDrawerOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: 380,
            height: "100vh",
            background: "#fff",
            boxShadow: "-2px 0 16px rgba(0,0,0,0.15)",
            zIndex: 2000,
            padding: 24,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h3 style={{ color: "#800000", marginTop: 0 }}>Add Manual Record</h3>
          <form onSubmit={handleCreateRecord} style={{ overflowY: "auto", paddingRight: 4 }}>
            <label style={{ fontWeight: 500 }}>KPI-ID<br /><input value={manualForm.kpi_id} onChange={(e) => setManualForm((f) => ({ ...f, kpi_id: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} required /></label>
            <label style={{ fontWeight: 500 }}>Customer Name<br /><input value={manualForm.customer_name} onChange={(e) => setManualForm((f) => ({ ...f, customer_name: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} required /></label>
            <label style={{ fontWeight: 500 }}>Contact Number<br /><input value={manualForm.contact_number} onChange={(e) => setManualForm((f) => ({ ...f, contact_number: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} required /></label>
            <label style={{ fontWeight: 500 }}>
              State
              <br />
              <select
                value={manualForm.state}
                onChange={(e) =>
                  setManualForm((f) => ({
                    ...f,
                    state: e.target.value,
                    sales_zone: "",
                    sales_area: "",
                  }))
                }
                style={{ width: "100%", marginBottom: 8 }}
                required
              >
                <option value="">Select State</option>
                {stateOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontWeight: 500 }}>
              Sales Zone
              <br />
              <select
                value={manualForm.sales_zone}
                onChange={(e) =>
                  setManualForm((f) => ({
                    ...f,
                    sales_zone: e.target.value,
                    sales_area: "",
                  }))
                }
                style={{ width: "100%", marginBottom: 8 }}
                disabled={!manualForm.state}
                required
              >
                <option value="">Select Zone</option>
                {manualZoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontWeight: 500 }}>
              Sales Area
              <br />
              <select
                value={manualForm.sales_area}
                onChange={(e) => setManualForm((f) => ({ ...f, sales_area: e.target.value }))}
                style={{ width: "100%", marginBottom: 8 }}
                disabled={!manualForm.state || !manualForm.sales_zone}
                required
              >
                <option value="">Select Area</option>
                {manualAreaOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontWeight: 500 }}>Invoice Amount<br /><input type="number" value={manualForm.invoice_amount} onChange={(e) => setManualForm((f) => ({ ...f, invoice_amount: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} required /></label>
            {manualError && <div style={{ color: "red", marginBottom: 8 }}>{manualError}</div>}
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button type="button" onClick={() => setManualDrawerOpen(false)} style={{ background: "#eee", padding: "8px 20px", borderRadius: 4, border: "none" }}>Cancel</button>
              <button type="submit" style={{ background: "#800000", color: "#fff", padding: "8px 20px", borderRadius: 4, border: "none", fontWeight: 600 }}>Save</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ height: 8 }} />
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="kp-scroll-hide" style={{ width: "100%", overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 980,
            borderCollapse: "collapse",
            background: "#fff",
            color: "#222",
          }}
        >
          <thead>
            <tr style={{ background: "#800000", color: "#fff" }}>
              <th>KPI-ID</th>
              <th>Customer Name</th>
              <th>Contact Number</th>
              <th>Sales Zone</th>
              <th>Sales Area</th>
              <th>Invoice Amount</th>
              <th>Amount Received</th>
              <th>Pending Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pagedOrders.map((order) => {
              const amountReceived = getAmountReceived(order);
              const pendingAmount = Number(order.invoice_amount || 0) - amountReceived;
              return (
                <tr key={order.id}>
                  <td>{order.kpi_id}</td>
                  <td>{order.customer_name}</td>
                  <td>{order.contact_number}</td>
                  <td>{order.sales_zone}</td>
                  <td>{order.sales_area}</td>
                  <td>{order.invoice_amount}</td>
                  <td>{amountReceived}</td>
                  <td>{pendingAmount}</td>
                  <td>
                    <button
                      style={{
                        background: '#800000',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleOpenDrawer(order)}
                    >
                      View / Add Payment
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {!loading && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, color: "#800000", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>
              {filteredOrders.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, filteredOrders.length)} of {filteredOrders.length}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>Records per page</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #800000", color: "#800000" }}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ background: "#fff", border: "1px solid #800000", color: "#800000", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ background: "#fff", border: "1px solid #800000", color: "#800000", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {activeOrder && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: 460,
            height: "100vh",
            background: "#fff",
            boxShadow: "-2px 0 16px rgba(0,0,0,0.15)",
            zIndex: 2200,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: 20, borderBottom: "1px solid #eee" }}>
            <h3 style={{ color: "#800000", margin: 0 }}>Payment Drawer</h3>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <label style={{ fontWeight: 500 }}>KPI-ID<br /><input value={editForm.kpi_id} onChange={(e) => setEditForm((f) => ({ ...f, kpi_id: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} /></label>
            <label style={{ fontWeight: 500 }}>Customer Name<br /><input value={editForm.customer_name} onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} /></label>
            <label style={{ fontWeight: 500 }}>Contact Number<br /><input value={editForm.contact_number} onChange={(e) => setEditForm((f) => ({ ...f, contact_number: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} /></label>
            <label style={{ fontWeight: 500 }}>
              State
              <br />
              <select
                value={editForm.state}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    state: e.target.value,
                    sales_zone: "",
                    sales_area: "",
                  }))
                }
                style={{ width: "100%", marginBottom: 8 }}
              >
                <option value="">Select State</option>
                {stateOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontWeight: 500 }}>
              Sales Zone
              <br />
              <select
                value={editForm.sales_zone}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    sales_zone: e.target.value,
                    sales_area: "",
                  }))
                }
                style={{ width: "100%", marginBottom: 8 }}
                disabled={!editForm.state}
              >
                <option value="">Select Zone</option>
                {editZoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontWeight: 500 }}>
              Sales Area
              <br />
              <select
                value={editForm.sales_area}
                onChange={(e) => setEditForm((f) => ({ ...f, sales_area: e.target.value }))}
                style={{ width: "100%", marginBottom: 8 }}
                disabled={!editForm.state || !editForm.sales_zone}
              >
                <option value="">Select Area</option>
                {editAreaOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontWeight: 500 }}>Invoice Amount<br /><input type="number" value={editForm.invoice_amount} onChange={(e) => setEditForm((f) => ({ ...f, invoice_amount: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} /></label>

            <div style={{ marginBottom: 10 }}><b>Amount Received:</b> {getAmountReceived(activeOrder)}</div>
            <div style={{ marginBottom: 16 }}><b>Pending Amount:</b> {Number(activeOrder.invoice_amount || 0) - getAmountReceived(activeOrder)}</div>

            <button
              style={{ background: "#800000", color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontWeight: 600, cursor: "pointer", marginBottom: 14 }}
              onClick={() => {
                setShowPaymentForm((prev) => !prev);
                setDrawerError("");
              }}
            >
              Add Payment
            </button>

            {showPaymentForm && (
              <form onSubmit={handleAddPayment} style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, marginBottom: 16 }}>
                <div style={{ marginBottom: 8 }}>
                  <b>Payment Type:</b> {PAYMENT_TYPES[(activeOrder.payments || []).length]?.label || "All used"}
                </div>
                <label style={{ display: "block", marginBottom: 8 }}>UTR<br /><input value={paymentForm.utr} onChange={(e) => setPaymentForm((f) => ({ ...f, utr: e.target.value }))} style={{ width: "100%" }} required /></label>
                <label style={{ display: "block", marginBottom: 8 }}>Amount<br /><input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} style={{ width: "100%" }} required /></label>
                <label style={{ display: "block", marginBottom: 8 }}>Date<br /><input type="date" value={paymentForm.date} onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))} style={{ width: "100%" }} required /></label>
                <label style={{ display: "block", marginBottom: 8 }}>
                  Upload Receipt
                  <br />
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setPaymentReceiptFile(e.target.files?.[0] || null)}
                    style={{ width: "100%" }}
                  />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPaymentForm(false);
                      setPaymentReceiptFile(null);
                    }}
                    style={{ background: "#eee", border: "none", borderRadius: 4, padding: "6px 12px" }}
                  >
                    Cancel
                  </button>
                  <button type="submit" style={{ background: "#800000", color: "#fff", border: "none", borderRadius: 4, padding: "6px 12px" }}>Save Payment</button>
                </div>
              </form>
            )}

            <div>
              <b>Payment History</b>
              {(activeOrder.payments || []).length === 0 && (
                <div style={{ color: "#777", marginTop: 8 }}>No payments yet.</div>
              )}
              {(activeOrder.payments || []).map((p, idx) => {
                const key = p.id || `${p.type || "payment"}-${idx}`;
                const isEditing = editPaymentId === p.id;

                return (
                  <div key={key} style={{ border: "1px solid #eee", borderRadius: 6, padding: 10, marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <b>{p.label || `${idx + 1} Payment`}</b>
                      <button
                        type="button"
                        onClick={() => startEditPayment(p)}
                        style={{ background: "#fff", color: "#800000", border: "1px solid #800000", borderRadius: 4, padding: "4px 10px", fontWeight: 600, cursor: "pointer" }}
                      >
                        Edit
                      </button>
                    </div>

                    <div>Amount: {Number(p.amount || 0)}</div>
                    <div>Date: {p.date || "-"}</div>
                    <div>UTR: {p.utr || "-"}</div>
                    <div>
                      Receipt: {p.receiptUrl ? (
                        <a href={p.receiptUrl} target="_blank" rel="noreferrer" style={{ color: "#800000", fontWeight: 600 }}>
                          View Receipt
                        </a>
                      ) : "-"}
                    </div>

                    {isEditing && (
                      <div style={{ borderTop: "1px dashed #ddd", marginTop: 10, paddingTop: 10 }}>
                        <label style={{ display: "block", marginBottom: 8 }}>
                          UTR
                          <br />
                          <input
                            value={paymentEditForm.utr}
                            onChange={(e) => setPaymentEditForm((f) => ({ ...f, utr: e.target.value }))}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label style={{ display: "block", marginBottom: 8 }}>
                          Amount
                          <br />
                          <input
                            type="number"
                            value={paymentEditForm.amount}
                            onChange={(e) => setPaymentEditForm((f) => ({ ...f, amount: e.target.value }))}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label style={{ display: "block", marginBottom: 8 }}>
                          Date
                          <br />
                          <input
                            type="date"
                            value={paymentEditForm.date}
                            onChange={(e) => setPaymentEditForm((f) => ({ ...f, date: e.target.value }))}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label style={{ display: "block", marginBottom: 8 }}>
                          Upload / Replace Receipt
                          <br />
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => setPaymentEditReceiptFile(e.target.files?.[0] || null)}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={cancelEditPayment}
                            style={{ background: "#eee", border: "none", borderRadius: 4, padding: "6px 12px" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={busyPaymentId === p.id}
                            onClick={() => saveEditedPayment(p)}
                            style={{ background: "#800000", color: "#fff", border: "none", borderRadius: 4, padding: "6px 12px" }}
                          >
                            {busyPaymentId === p.id ? "Saving..." : "Save Payment"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {drawerError && <div style={{ color: "red", marginTop: 12 }}>{drawerError}</div>}
          </div>

          <div style={{ padding: 16, borderTop: "1px solid #eee", display: "flex", gap: 10, justifyContent: "flex-end", background: "#fff" }}>
            <button onClick={handleDeleteRecord} style={{ background: "#d00000", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600 }}>Delete</button>
            <button onClick={handleCloseDrawer} style={{ background: "#eee", border: "none", borderRadius: 4, padding: "8px 16px" }}>Cancel</button>
            <button onClick={handleSaveRecord} style={{ background: "#800000", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600 }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentReceivables;