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
    const rows = await import('./helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('deals'));
    const seen = new Set();
    let deletedCount = 0;

    for (const r of rows) {
      const data = r || {};
      const id = data.autoId;

      if (!id) continue;

      if (seen.has(id)) {
        await deleteDoc(doc(db, "deals", r.id));
        console.log(`🗑 Deleted duplicate deal: ${id} (Doc ID: ${r.id})`);
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
