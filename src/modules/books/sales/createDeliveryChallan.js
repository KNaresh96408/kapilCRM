import { auth, db, serverTimestamp } from "../../../firebaseConfig";
import {
  collection,
  doc,
  runTransaction,
  query,
  where,
  getDocs,
  limit
} from "firebase/firestore";


/**
 * Create a Delivery Challan with atomic inventory reduction and stockLedger entries.
 * @param {Object} dcData - Delivery Challan data (excluding items, createdBy, createdAt, dcNumber)
 * @param {Array} items - Array of items: [{ productId, productName, variantId, brandName, quantity, unit }]
 * @returns {Promise<{id: string, dcNumber: string, items: Array}>} - Returns created DC metadata
 */
export async function createDeliveryChallan(dcData, items) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("User not authenticated");

  const kpiId = String(dcData?.kpi_id || dcData?.kpiId || "").trim();
  if (!kpiId) {
    throw new Error("KPI-ID is required to create Delivery Challan");
  }
  const dcNumber = `DC/${kpiId.toUpperCase()}`;
  const createdAt = serverTimestamp();
  const createdBy = currentUser.uid;

  try {
    const [existingByKpiId, existingByKpi] = await Promise.all([
      getDocs(query(collection(db, "deliveryChallans"), where("kpi_id", "==", kpiId), limit(1))),
      getDocs(query(collection(db, "deliveryChallans"), where("kpiId", "==", kpiId), limit(1))),
    ]);
    const existingDoc = !existingByKpiId.empty
      ? existingByKpiId.docs[0]
      : !existingByKpi.empty
        ? existingByKpi.docs[0]
        : null;

    const result = await runTransaction(db, async (transaction) => {
      const oldData = existingDoc ? existingDoc.data() : null;
      const oldItemByVariant = new Map();
      for (const oldItem of oldData?.items || []) {
        const id = String(oldItem.variantId || "").trim();
        if (!id) continue;
        const prev = oldItemByVariant.get(id) || { ...oldItem, quantity: 0 };
        oldItemByVariant.set(id, { ...prev, quantity: Number(prev.quantity || 0) + Number(oldItem.quantity || 0) });
      }

      const dispatchItemByVariant = new Map();
      for (const item of items || []) {
        const id = String(item.variantId || "").trim();
        if (!id) continue;
        const prev = dispatchItemByVariant.get(id) || { ...item, quantity: 0 };
        dispatchItemByVariant.set(id, { ...prev, quantity: Number(prev.quantity || 0) + Number(item.quantity || 0) });
      }

      const variantIds = new Set([...oldItemByVariant.keys(), ...dispatchItemByVariant.keys()]);
      const availableByVariant = new Map();

      // Firestore transactions require all reads before writes.
      for (const variantId of variantIds) {
        const dispatchQty = Number(dispatchItemByVariant.get(variantId)?.quantity || 0);
        if (!dispatchQty) continue;

        const variantRef = doc(db, "inventoryVariants", variantId);
        const variantSnap = await transaction.get(variantRef);
        if (!variantSnap.exists()) {
          throw new Error(`Variant not found: ${variantId}`);
        }

        const available = Number(variantSnap.data().availableQuantity || 0);
        if (available < dispatchQty) {
          throw new Error(`Insufficient stock for variant ${variantId}`);
        }
        availableByVariant.set(variantId, available);
      }

      // 1. Inventory update only for current dispatch quantities
      for (const variantId of variantIds) {
        const dispatchQty = Number(dispatchItemByVariant.get(variantId)?.quantity || 0);
        if (!dispatchQty) continue;

        const variantRef = doc(db, "inventoryVariants", variantId);
        const available = Number(availableByVariant.get(variantId) || 0);

        transaction.update(variantRef, {
          availableQuantity: available - dispatchQty,
          lastUpdatedAt: serverTimestamp(),
        });

        const ledgerRef = doc(collection(db, "stockLedger"));
        transaction.set(ledgerRef, {
          productId: (dispatchItemByVariant.get(variantId) || oldItemByVariant.get(variantId) || {}).productId || "",
          variantId,
          quantity: dispatchQty,
          referenceId: dcNumber,
          referenceType: existingDoc ? "DC_UPDATE" : "DC",
          type: "stockOUT",
          createdAt,
          createdBy,
        });
      }

      // 2. Store cumulative net customer-held quantity (previous net + current dispatch)
      const cumulativeItems = Array.from(variantIds)
        .map((variantId) => {
          const oldItem = oldItemByVariant.get(variantId);
          const dispatchItem = dispatchItemByVariant.get(variantId);
          const oldQty = Number(oldItem?.quantity || 0);
          const dispatchQty = Number(dispatchItem?.quantity || 0);
          const quantity = oldQty + dispatchQty;
          if (!quantity) return null;
          return {
            ...(oldItem || dispatchItem || {}),
            ...(dispatchItem || {}),
            quantity,
          };
        })
        .filter(Boolean);

      // 3. Create or update deliveryChallans document
      const dcRef = existingDoc ? doc(db, "deliveryChallans", existingDoc.id) : doc(collection(db, "deliveryChallans"));
      transaction.set(dcRef, {
        ...oldData,
        ...dcData,
        dcNumber,
        items: cumulativeItems,
        createdAt: oldData?.createdAt || createdAt,
        createdBy: oldData?.createdBy || createdBy,
        updatedAt: serverTimestamp(),
        status: existingDoc ? "updated" : "created",
      });

      return { id: dcRef.id, dcNumber, items: cumulativeItems, updated: !!existingDoc };
    });
    return result;
  } catch (err) {
    throw err;
  }
}
