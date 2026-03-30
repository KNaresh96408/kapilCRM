import { runTransaction, doc, collection, serverTimestamp, query, where, getDocs, limit } from "firebase/firestore";

import { db } from "../../../firebaseConfig";

/**
 * Create a credit note for material return or variant exchange.
 * Atomically updates inventory, stockLedger, and creditNotes.
 * @param {Object} params
 * @param {string} params.kpi_id
 * @param {string} params.customerName
 * @param {Array} params.items - [{ variantId, quantity, ... }]
 * @param {number} params.totalCreditAmount
 * @param {string} params.reason
 * @param {string} params.createdBy
 * @returns {Promise<{id: string, creditNoteNumber: string}>}
 */
export async function createCreditNote({
  kpi_id,
  customerName,
  contactNumber,
  address,
  sales_zone,
  sales_area,
  items,
  totalCreditAmount,
  reason,
  createdBy,
}) {
  const kpiId = String(kpi_id || "").trim();
  if (!kpiId) throw new Error("KPI-ID is required for Credit Note");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Credit Note items are required");

  // Generate creditNoteNumber (CN/KPI-001 format)
  const creditNoteNumber = `CN/${kpiId.toUpperCase()}`;

  const [existingCnByKpiId, existingCnByKpi, existingDcByKpiId, existingDcByKpi] = await Promise.all([
    getDocs(query(collection(db, "creditNotes"), where("kpi_id", "==", kpiId), limit(1))),
    getDocs(query(collection(db, "creditNotes"), where("kpiId", "==", kpiId), limit(1))),
    getDocs(query(collection(db, "deliveryChallans"), where("kpi_id", "==", kpiId), limit(1))),
    getDocs(query(collection(db, "deliveryChallans"), where("kpiId", "==", kpiId), limit(1))),
  ]);
  const existingDoc = !existingCnByKpiId.empty
    ? existingCnByKpiId.docs[0]
    : !existingCnByKpi.empty
      ? existingCnByKpi.docs[0]
      : null;
  const existingDcDoc = !existingDcByKpiId.empty
    ? existingDcByKpiId.docs[0]
    : !existingDcByKpi.empty
      ? existingDcByKpi.docs[0]
      : null;

  const result = await runTransaction(db, async (transaction) => {
    const newQtyByVariant = new Map();
    for (const item of items) {
      const id = String(item.variantId || "").trim();
      if (!id) continue;
      newQtyByVariant.set(id, (newQtyByVariant.get(id) || 0) + Number(item.quantity || 0));
    }

    const oldData = existingDoc ? existingDoc.data() : null;
    const oldQtyByVariant = new Map();
    for (const oldItem of oldData?.items || []) {
      const id = String(oldItem.variantId || "").trim();
      if (!id) continue;
      oldQtyByVariant.set(id, (oldQtyByVariant.get(id) || 0) + Number(oldItem.quantity || 0));
    }

    const allVariantIds = new Set([...newQtyByVariant.keys(), ...oldQtyByVariant.keys()]);
    const cnDeltaByVariant = new Map();
    const inventoryByVariant = new Map();

    // 1. Compute deltas and read all required variant docs first
    for (const variantId of allVariantIds) {
      const newQty = Number(newQtyByVariant.get(variantId) || 0);
      const oldQty = Number(oldQtyByVariant.get(variantId) || 0);
      const delta = newQty - oldQty;
      if (!delta) continue;
      cnDeltaByVariant.set(variantId, delta);

      const variantRef = doc(db, "inventoryVariants", variantId);
      const variantSnap = await transaction.get(variantRef);
      if (!variantSnap.exists()) throw new Error("Variant not found");
      const prevQty = Number(variantSnap.data().availableQuantity || 0);

      // Credit note should increase stock. During update, negative delta means reverse previous CN qty.
      if (delta < 0 && prevQty < Math.abs(delta)) {
        throw new Error(`Insufficient stock to reduce for variant ${variantId}`);
      }

      inventoryByVariant.set(variantId, prevQty);
    }

    // 2. Reverse inventory using quantity delta (new - old)
    for (const variantId of allVariantIds) {
      const delta = Number(cnDeltaByVariant.get(variantId) || 0);
      if (!delta) continue;

      const variantRef = doc(db, "inventoryVariants", variantId);
      const prevQty = Number(inventoryByVariant.get(variantId) || 0);

      transaction.update(variantRef, {
        availableQuantity: prevQty + delta,
        lastUpdatedAt: serverTimestamp(),
      });

      const ledgerRef = doc(collection(db, "stockLedger"));
      transaction.set(ledgerRef, {
        type: delta > 0 ? "stockIN" : "stockOUT",
        referenceType: existingDoc ? "CREDIT_NOTE_UPDATE" : "CREDIT_NOTE",
        referenceId: creditNoteNumber,
        variantId,
        quantity: Math.abs(delta),
        items,
        createdAt: serverTimestamp(),
      });
    }

    // 3. Keep Delivery Challan cumulative net quantities in sync: newDcQty = oldDcQty - cnDelta
    if (existingDcDoc) {
      const dcRef = doc(db, "deliveryChallans", existingDcDoc.id);
      const dcData = existingDcDoc.data() || {};
      const dcItemByVariant = new Map();

      for (const dcItem of dcData.items || []) {
        const id = String(dcItem.variantId || "").trim();
        if (!id) continue;
        const prev = dcItemByVariant.get(id) || { ...dcItem, quantity: 0 };
        dcItemByVariant.set(id, {
          ...prev,
          quantity: Number(prev.quantity || 0) + Number(dcItem.quantity || 0),
        });
      }

      for (const [variantId, delta] of cnDeltaByVariant.entries()) {
        const prev = dcItemByVariant.get(variantId) || { variantId, quantity: 0 };
        const nextQty = Math.max(0, Number(prev.quantity || 0) - Number(delta || 0));
        dcItemByVariant.set(variantId, { ...prev, quantity: nextQty });
      }

      const nextDcItems = Array.from(dcItemByVariant.values()).filter((item) => Number(item.quantity || 0) > 0);
      transaction.set(dcRef, {
        ...dcData,
        items: nextDcItems,
        updatedAt: serverTimestamp(),
      });
    }

    // 4. Save creditNotes document (create or update)
    const creditNoteRef = existingDoc ? doc(db, "creditNotes", existingDoc.id) : doc(collection(db, "creditNotes"));
    transaction.set(creditNoteRef, {
      ...oldData,
      creditNoteNumber,
      kpi_id: kpiId,
      kpiId: kpiId,
      customerName,
      contactNumber: contactNumber || oldData?.contactNumber || "",
      address: address || oldData?.address || "",
      sales_zone: sales_zone || oldData?.sales_zone || "",
      sales_area: sales_area || oldData?.sales_area || "",
      items,
      totalCreditAmount,
      creditNoteAmount: totalCreditAmount,
      reason,
      createdBy,
      createdAt: oldData?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: "generating",
    });

    return { id: creditNoteRef.id, creditNoteNumber };
  });
  return result;
}
