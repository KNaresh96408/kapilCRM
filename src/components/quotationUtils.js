import { db } from "../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";

/**
 * ✅ Get next sequential Quotation ID (QTN-001, QTN-002, etc.)
 */
export const getNextQuotationId = async () => {
  try {
    const colRef = collection(db, "quotations");
    const q = query(colRef, orderBy("createdAt", "desc"), limit(1));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const lastId = snap.docs[0].data().quotationId || "QTN-000";
      const num = parseInt(lastId.split("-")[1], 10) || 0;
      const next = (num + 1).toString().padStart(3, "0");
      return `QTN-${next}`;
    }
    return "QTN-001";
  } catch (error) {
    console.error("❌ Error fetching next Quotation ID:", error);
    return "QTN-001";
  }
};

/**
 * ✅ Save Quotation to Firestore
 */
export const saveQuotation = async (data) => {
  try {
    const colRef = collection(db, "quotations");
    const qId = await getNextQuotationId();

    console.log("💾 Saving quotation:", qId, data);

    await addDoc(colRef, {
      ...data,
      quotationId: qId,
      createdAt: serverTimestamp(),
    });

    console.log("✅ Quotation saved successfully with ID:", qId);
    return qId;
  } catch (error) {
    console.error("❌ Error saving quotation:", error);
    throw error;
  }
};
