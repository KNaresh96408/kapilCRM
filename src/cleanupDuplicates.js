// ============================================================
// 🧹 Firestore Duplicate Cleanup Script
// ============================================================
// Purpose: Removes duplicate deals (same KPI ID) in the "deals" collection
// Author: Kapil Power CRM
// Safe to run ONCE. It will NOT affect unique deals.
// ============================================================

import { db } from "./firebaseConfig";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";

async function removeDuplicateDeals() {
  console.log("🚀 Starting duplicate cleanup in 'deals' collection...");

  try {
    const snapshot = await getDocs(collection(db, "deals"));
    const seen = new Set();
    let deletedCount = 0;

    for (const dealDoc of snapshot.docs) {
      const data = dealDoc.data();
      const id = data.autoId;

      if (!id) continue; // skip documents without KPI ID

      if (seen.has(id)) {
        // Duplicate detected — delete it
        await deleteDoc(doc(db, "deals", dealDoc.id));
        console.log(`🗑 Deleted duplicate deal: ${id} (Doc ID: ${dealDoc.id})`);
        deletedCount++;
      } else {
        seen.add(id);
      }
    }

    console.log(`✅ Cleanup complete. Removed ${deletedCount} duplicate deals.`);
    console.log("🎯 All unique KPI IDs retained safely.");
  } catch (err) {
    console.error("❌ Cleanup failed. Check Firestore permissions:", err);
  }
}

// ============================================================
// 🔧 Execute Immediately (Only Once)
// ============================================================
removeDuplicateDeals();
