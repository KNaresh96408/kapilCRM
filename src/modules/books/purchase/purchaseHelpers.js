import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  collection,
  doc,
  getDoc,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, storage } from '../../../firebaseConfig';
import { PurchaseOrderPDF } from './PurchaseOrderPDF';
import { GrnPdfDocument } from './GRNPDF';
import defaultAuthorizedSignatory from '../../../purchaseAssets/authorized/authorized-signatory.png';
import { getDocsWithFallback } from '../../../helpers/firestoreFetch';

export const MAROON = '#8B0000';
const DEFAULT_AUTH_SIGNATORY_URL = defaultAuthorizedSignatory;

const normalizeApprovalAssetUrl = (url) => {
  const value = String(url || '').trim();
  if (!value) return '';

  // react-pdf in local browser dev fails to load Firebase Storage URLs without bucket CORS.
  // Keep custom configured URLs in production, but use local bundled fallback on localhost.
  if (typeof window !== 'undefined') {
    const host = String(window.location?.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const isFirebaseStorage = /^https?:\/\/firebasestorage\.googleapis\.com\//i.test(value);
    if (isLocal && isFirebaseStorage) return DEFAULT_AUTH_SIGNATORY_URL;
  }

  return value;
};

export const formatMoney = (value) => Number(value || 0).toLocaleString('en-IN');

export const normalizeRole = (role) =>
  String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');

const roleAliasMap = {
  // Finance
  finance: 'dgm',
  financeadmin: 'dgm',
  finance_admin: 'dgm',
  financemanager: 'dgm',
  finance_manager: 'dgm',
  dgm: 'dgm',

  // AGM / HR Ops
  hroperationsmanager: 'agm',
  hr_operations_manager: 'agm',
  agm: 'agm',

  // Sales
  saleshead: 'sales_head',
  sales_head: 'sales_head',

  // Operations
  opsmanager: 'operations_manager',
  operationsmanager: 'operations_manager',
  operation_manager: 'operations_manager',
  opsexecutive: 'operations_executive',
  operationsexecutive: 'operations_executive',
  operation_executive: 'operations_executive',

  // Director (legacy typo)
  firector: 'director',
};

const canonicalRole = (role) => {
  const normalized = normalizeRole(role);
  if (!normalized) return '';
  const compact = normalized.replace(/_/g, '');
  return roleAliasMap[normalized] || roleAliasMap[compact] || normalized;
};

export const extractRoleFromSession = (session = {}) =>
  canonicalRole(
    session?.profile?.role ||
    session?.profile?.Role ||
    session?.role ||
    session?.Role ||
    ''
  );

export const isFinanceOrAdminRole = (role) => {
  const normalized = canonicalRole(role);
  return ['admin', 'dgm', 'agm', 'director', 'sales_head'].includes(normalized);
};

export const getSessionProfile = () => {
  try {
    const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
    const profile = session?.profile || session || {};
    return {
      uid: profile.uid || session?.uid || '',
      role: canonicalRole(profile.role || profile.Role || session?.role || session?.Role || ''),
      name: profile.Name || profile.name || '',
      email: profile.email || '',
    };
  } catch {
    return { uid: '', role: '', name: '', email: '' };
  }
};

export const getApprovalAssets = async () => {
  try {
    const snap = await getDoc(doc(db, 'purchaseConfig', 'materialApproval'));
    if (!snap.exists()) {
      return {
        signatureUrl: DEFAULT_AUTH_SIGNATORY_URL,
        stampUrl: DEFAULT_AUTH_SIGNATORY_URL,
        approvedByName: 'Authorized Signatory',
      };
    }
    const d = snap.data() || {};
    const signatureUrl = normalizeApprovalAssetUrl(d.signatureUrl);
    const stampUrl = normalizeApprovalAssetUrl(d.stampUrl);
    return {
      signatureUrl: signatureUrl || DEFAULT_AUTH_SIGNATORY_URL,
      stampUrl: stampUrl || DEFAULT_AUTH_SIGNATORY_URL,
      approvedByName: d.approvedByName || 'Authorized Signatory',
    };
  } catch {
    return {
      signatureUrl: DEFAULT_AUTH_SIGNATORY_URL,
      stampUrl: DEFAULT_AUTH_SIGNATORY_URL,
      approvedByName: 'Authorized Signatory',
    };
  }
};

export const generateAndUploadPoPdf = async ({
  po,
  vendor,
  terms,
  approved,
  signatureUrl,
  stampUrl,
  approvedByName,
  logoUrl,
  type,
}) => {
  const docNode = React.createElement(PurchaseOrderPDF, {
    po,
    vendor,
    terms,
    approved,
    signatureUrl,
    stampUrl,
    approvedByName,
    logoUrl,
    type,
  });
  const asPdf = pdf([]);
  asPdf.updateContainer(docNode);
  const blob = await asPdf.toBlob();

  const safePo = String(po.poNumber || po.id || Date.now()).replace(/[\\/]/g, '-');
  const folder = approved ? 'approved' : 'draft';
  const storageRef = ref(storage, `purchaseOrders/${type}/${folder}/${safePo}.pdf`);
  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
  return getDownloadURL(storageRef);
};

export const generateAndUploadGrnPdf = async ({
  grn,
  logoUrl = '/brands/kapil_power_logo.png',
}) => {
  const docNode = React.createElement(GrnPdfDocument, {
    grn,
    logoUrl,
  });

  const asPdf = pdf([]);
  asPdf.updateContainer(docNode);
  const blob = await asPdf.toBlob();

  const safeGrn = String(grn?.grnNumber || grn?.id || Date.now()).replace(/[\\/]/g, '-');
  const storageRef = ref(storage, `grn/material/${safeGrn}.pdf`);
  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
  return getDownloadURL(storageRef);
};

export const getNextCounter = async ({ counterDocPath, prefix = '', digits = 3, startFrom = 1 }) => {
  const counterRef = doc(db, counterDocPath);
  const nextVal = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const stored = snap.exists() ? Number(snap.data()?.nextNumber || startFrom) : startFrom;
    const curr = Math.max(Number.isFinite(stored) ? stored : startFrom, startFrom);
    const next = curr + 1;
    transaction.set(counterRef, { nextNumber: next, updatedAt: serverTimestamp() }, { merge: true });
    return curr;
  });

  const serial = String(nextVal).padStart(digits, '0');
  return `${prefix}${serial}`;
};

export const peekNextCounter = async ({ counterDocPath, prefix = '', digits = 3, startFrom = 1 }) => {
  const counterRef = doc(db, counterDocPath);
  const snap = await getDoc(counterRef);
  const stored = snap.exists() ? Number(snap.data()?.nextNumber || startFrom) : startFrom;
  const curr = Math.max(Number.isFinite(stored) ? stored : startFrom, startFrom);
  const serial = String(curr).padStart(digits, '0');
  return `${prefix}${serial}`;
};

export const createNotificationIfNotExists = async ({
  dedupeKey,
  title,
  message,
  type,
  module,
  referenceId,
  referenceType,
  toRole,
  toUserId,
  toEmails,
}) => {
  const q = query(collection(db, 'notifications'), where('dedupeKey', '==', dedupeKey), limit(1));
  const existsRows = await getDocsWithFallback(q, 'notifications', null, 3500);
  if (existsRows.length) return existsRows[0].id;

  const refDoc = doc(collection(db, 'notifications'));
  await setDoc(refDoc, {
    title,
    message,
    type,
    module: module || 'books',
    referenceId: referenceId || '',
    referenceType: referenceType || '',
    toRole: toRole || null,
    toUserId: toUserId || null,
    toEmails: Array.isArray(toEmails)
      ? toEmails.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim())
      : [],
    dedupeKey,
    status: 'unread',
    active: true,
    createdAt: serverTimestamp(),
  });
  return refDoc.id;
};

export const updateVendorTotalsOnMaterialPayment = async ({
  poId,
  newPaymentAmount,
  receiptUrl,
  utrNumber,
  paymentDate,
}) => {
  const poRef = doc(db, 'purchaseOrders', poId);

  await runTransaction(db, async (transaction) => {
    const poSnap = await transaction.get(poRef);
    if (!poSnap.exists()) throw new Error('PO not found');

    const po = poSnap.data() || {};
    const vendorId = po.vendorId;
    if (!vendorId) throw new Error('Vendor missing on PO');

    const vendorRef = doc(db, 'records_materialVendors', vendorId);
    const vendorSnap = await transaction.get(vendorRef);
    const vendor = vendorSnap.exists() ? (vendorSnap.data() || {}) : {};

    const prevPaymentAmount = Number(po.paymentAmount || 0);
    const targetPaymentAmount = Number(newPaymentAmount || 0);
    const deltaPaid = targetPaymentAmount - prevPaymentAmount;

    const totalAmount = Number(po.totalAmount || 0);
    const alreadyBooked = Boolean(po.vendorTotalBooked);
    const currentPurchased = Number(vendor.totalPurchasedValue || 0);
    const currentPaid = Number(vendor.totalPaidAmount || 0);

    const nextPurchased = currentPurchased + (alreadyBooked ? 0 : totalAmount);
    const nextPaid = currentPaid + deltaPaid;
    const nextPending = nextPurchased - nextPaid;

    transaction.update(poRef, {
      paymentAmount: targetPaymentAmount,
      paymentStatus: targetPaymentAmount >= totalAmount ? 'paid' : targetPaymentAmount > 0 ? 'partial' : 'pending',
      receiptUrl: receiptUrl || po.receiptUrl || '',
      utrNumber: utrNumber || po.utrNumber || '',
      paymentDate: paymentDate || serverTimestamp(),
      vendorTotalBooked: true,
      updatedAt: serverTimestamp(),
    });

    transaction.set(vendorRef, {
      totalPurchasedValue: nextPurchased,
      totalPaidAmount: nextPaid,
      pendingAmount: nextPending,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
};

export const updateVendorTotalsOnServicePayment = async ({
  poId,
  newPaymentAmount,
  receiptUrl,
  utrNumber,
  paymentDate,
}) => {
  const poRef = doc(db, 'servicePurchaseOrders', poId);

  await runTransaction(db, async (transaction) => {
    const poSnap = await transaction.get(poRef);
    if (!poSnap.exists()) throw new Error('Service PO not found');

    const po = poSnap.data() || {};
    const vendorId = po.vendorId;
    if (!vendorId) throw new Error('Vendor missing on Service PO');

    const vendorRef = doc(db, 'records_serviceVendors', vendorId);
    const vendorSnap = await transaction.get(vendorRef);
    const vendor = vendorSnap.exists() ? (vendorSnap.data() || {}) : {};

    const prevPaymentAmount = Number(po.paymentAmount || 0);
    const targetPaymentAmount = Number(newPaymentAmount || 0);
    const deltaPaid = targetPaymentAmount - prevPaymentAmount;

    const totalAmount = Number(po.totalAmount || 0);
    const alreadyBooked = Boolean(po.vendorTotalBooked);

    const currentTotalValue = Number(vendor.totalValue || 0);
    const currentPaid = Number(vendor.paid || 0);

    const nextTotalValue = currentTotalValue + (alreadyBooked ? 0 : totalAmount);
    const nextPaid = currentPaid + deltaPaid;

    transaction.update(poRef, {
      paymentAmount: targetPaymentAmount,
      paymentStatus: targetPaymentAmount >= totalAmount ? 'paid' : targetPaymentAmount > 0 ? 'partial' : 'pending',
      receiptUrl: receiptUrl || po.receiptUrl || '',
      utrNumber: utrNumber || po.utrNumber || '',
      paymentDate: paymentDate || serverTimestamp(),
      vendorTotalBooked: true,
      updatedAt: serverTimestamp(),
    });

    transaction.set(vendorRef, {
      totalValue: nextTotalValue,
      paid: nextPaid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
};

export const MATERIAL_TERMS_DEFAULT = {
  shipmentTerms: 'Ex-Works / As agreed',
  paymentTerms: '100% advance against PO unless otherwise agreed',
  deliveryTimeline: 'As per confirmed schedule',
  warranty: 'As per OEM standard terms',
  packing: 'Included',
  orderAcknowledgement: 'Share PI + bank details by email',
  testCertificates: 'Required test certificates to be shared with shipment',
  gstTaxes: 'GST extra as applicable',
};

export const SERVICE_TERMS_DEFAULT = {
  scopeOfWork: 'Installation and commissioning as per assigned projects',
  paymentTerms: 'As per completion milestones',
  completionTimeline: 'As per project allocation',
  penaltyClause: 'Delay penalties as per agreed SLA',
  tdsApplicability: 'TDS as per applicable law',
  invoiceSubmissionTerms: 'Submit invoice with supporting documents',
};
