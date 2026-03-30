import { pdf } from "@react-pdf/renderer";
import React from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where, limit } from "firebase/firestore";
import { db, storage } from "../../../firebaseConfig";
import { InvoicePDF } from "./InvoicePDF";
import defaultAuthorizedSignatory from "../../../purchaseAssets/authorized/authorized-signatory.png";

function buildInvoiceItems(order, invoiceAmount) {
  const rawItems = Array.isArray(order?.items) ? order.items : [];

  if (rawItems.length > 0) {
    const qtyTotal = rawItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 1;
    return rawItems.map((item) => {
      const qty = Number(item.quantity || 0) || 1;
      const unitPrice = Number(item.unitPrice || item.rate || item.price || invoiceAmount / qtyTotal || 0);
      const total = Number(item.total || qty * unitPrice || 0);
      return {
        productName: item.productName || item.product || "Product",
        brandName: item.brandName || item.brand || "-",
        variantName: item.variantName || item.variant || item.variantId || "-",
        quantity: qty,
        unit: item.unit || "Nos",
        unitPrice,
        total,
      };
    });
  }

  return [
    {
      productName: "Solar System",
      brandName: "-",
      variantName: order?.capacity ? `${order.capacity} KW` : "Standard",
      quantity: 1,
      unit: "Set",
      unitPrice: Number(invoiceAmount || 0),
      total: Number(invoiceAmount || 0),
    },
  ];
}

const yieldToMainThread = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function createAndUploadInvoice(order) {
  const kpiId = String(order?.kpi_id || order?.kpiId || "").trim();
  if (!kpiId) throw new Error("KPI-ID is missing for invoice creation.");

  const invoiceAmount = Number(order?.invoice_amount ?? order?.invoiceAmount ?? 0);
  if (!invoiceAmount) throw new Error("Invoice amount is missing or zero.");

  const invoiceNumber = `INV/${kpiId.toUpperCase()}`;
  const invoiceDate = new Date();

  const [dcSnapByKpiId, dcSnapByKpi] = await Promise.all([
    getDocs(query(collection(db, "deliveryChallans"), where("kpi_id", "==", kpiId), limit(10))),
    getDocs(query(collection(db, "deliveryChallans"), where("kpiId", "==", kpiId), limit(10))),
  ]);

  const dcRows = [...dcSnapByKpiId.docs, ...dcSnapByKpi.docs]
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ad = a.updatedAt?.toDate ? a.updatedAt.toDate() : a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.updatedAt || a.createdAt || 0);
      const bd = b.updatedAt?.toDate ? b.updatedAt.toDate() : b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.updatedAt || b.createdAt || 0);
      return bd - ad;
    });

  const latestDc = dcRows[0] || null;
  const customerNameFromDc = latestDc?.customerName || latestDc?.customer_name || "";
  const contactFromDc = latestDc?.contactNumber || latestDc?.contact_number || latestDc?.customerPhone || "";
  const addressFromDc = latestDc?.address || latestDc?.location || "";
  const zoneFromDc = latestDc?.sales_zone || latestDc?.salesZone || "";
  const areaFromDc = latestDc?.sales_area || latestDc?.salesArea || "";

  const [existingInvByKpiId, existingInvByKpi] = await Promise.all([
    getDocs(query(collection(db, "invoices"), where("kpi_id", "==", kpiId), limit(1))),
    getDocs(query(collection(db, "invoices"), where("kpiId", "==", kpiId), limit(1))),
  ]);
  const existingInvDoc = !existingInvByKpiId.empty
    ? existingInvByKpiId.docs[0]
    : !existingInvByKpi.empty
      ? existingInvByKpi.docs[0]
      : null;

  const invoicePayload = {
    invoiceNumber,
    kpi_id: kpiId,
    kpiId,
    salesOrderId: order?.id || "",
    deliveryChallanId: latestDc?.id || "",
    dcNumber: latestDc?.dcNumber || "",
    customerName: customerNameFromDc || order?.customer_name || order?.customerName || "",
    contactNumber: contactFromDc || order?.contact_number || order?.customerPhone || order?.phone || "",
    address: addressFromDc || order?.address || order?.location || "",
    sales_zone: zoneFromDc || order?.sales_zone || order?.salesZone || "",
    sales_area: areaFromDc || order?.sales_area || order?.salesArea || "",
    invoice_amount: invoiceAmount,
    subTotal: invoiceAmount,
    gstPercent: Number(order?.gstPercent || order?.gst_percentage || 0),
    gstAmount: 0,
    grandTotal: invoiceAmount,
    createdAt: serverTimestamp(),
    created_at: invoiceDate.toISOString(),
    date: invoiceDate.toISOString(),
    status: "generating",
  };

  const invoiceRef = existingInvDoc
    ? { id: existingInvDoc.id }
    : await addDoc(collection(db, "invoices"), invoicePayload);

  if (existingInvDoc) {
    await updateDoc(doc(db, "invoices", existingInvDoc.id), {
      ...invoicePayload,
      updatedAt: serverTimestamp(),
    });
  }

  const items = buildInvoiceItems(latestDc || order, invoiceAmount);

  try {
    await yieldToMainThread();
    const logoUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/brands/kapil_power_logo.png`
        : undefined;

    const invoiceDoc = {
      ...invoicePayload,
      id: invoiceRef.id,
      date: invoiceDate.toISOString(),
      created_at: invoiceDate.toISOString(),
      createdAt: invoiceDate.toISOString(),
      gstAmount: Number((invoiceAmount * Number(invoicePayload.gstPercent || 0)) / 100),
      grandTotal: Number(invoiceAmount + (invoiceAmount * Number(invoicePayload.gstPercent || 0)) / 100),
    };

    const docInstance = React.createElement(InvoicePDF, {
      invData: invoiceDoc,
      items,
      logoUrl,
      signatureUrl: defaultAuthorizedSignatory,
    });
    const asPdf = pdf([]);
    asPdf.updateContainer(docInstance);
    const blob = await asPdf.toBlob();

    const filePath = `invoices/${invoiceNumber}-${invoiceRef.id}.pdf`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, blob);
    const invoicePdfUrl = await getDownloadURL(storageRef);

    await updateDoc(doc(db, "invoices", invoiceRef.id), {
      invoiceNumber,
      invoicePdfUrl,
      items,
      gstAmount: invoiceDoc.gstAmount,
      grandTotal: invoiceDoc.grandTotal,
      status: "generated",
      updatedAt: serverTimestamp(),
    });

    return { id: invoiceRef.id, invoicePdfUrl, invoiceNumber };
  } catch (err) {
    await updateDoc(doc(db, "invoices", invoiceRef.id), {
      status: "failed",
      errorMessage: err?.message || "PDF generation failed",
      updatedAt: serverTimestamp(),
    });
    throw err;
  }
}
