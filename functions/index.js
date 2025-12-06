// ============================================================
// CRM AUTOMATION - Lead → Deal → Customer
// ============================================================

import {
  onDocumentUpdated,
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import cors from "cors";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

initializeApp();
const db = getFirestore();
const corsHandler = cors({ origin: true });

// ============================================================
// 1. Lead → Deal Conversion
// ============================================================

export const convertLeadToDeal = onDocumentUpdated("leads/{leadId}", async (event) => {
  const before = event.data.before?.data();
  const after = event.data.after?.data();
  if (!before || !after) return;

  if (before.siteVisitArranged === "no" && after.siteVisitArranged === "yes") {
    const dealData = {
      ...after,
      leadRef: event.params.leadId,
      stage: "Qualification",
      movedFrom: "leads",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: after.createdBy || "system",
    };

    try {
      await db.collection("deals").add(dealData);
      await db.collection("leads").doc(event.params.leadId).delete();
      console.log(`Lead ${event.params.leadId} moved to deals`);
    } catch (err) {
      console.error("Error converting lead:", err);
    }
  }
});

// ============================================================
// 2. Deal → Customer Conversion
// ============================================================

export const convertDealToCustomer = onDocumentUpdated("deals/{dealId}", async (event) => {
  const before = event.data.before?.data();
  const after = event.data.after?.data();
  if (!before || !after) return;

  if (before.stage !== "Closed-Won" && after.stage === "Closed-Won") {
    const customerData = {
      customerName: after.leadName || after.name || null,
      email: after.email || null,
      dealRef: event.params.dealId,
      dealAmount: after.amount || 0,
      joinedOn: FieldValue.serverTimestamp(),
      createdBy: after.createdBy || "system",
      movedFrom: "deals",
    };

    try {
      await db.collection("customers").add(customerData);
      console.log(`Deal ${event.params.dealId} converted to customer`);
    } catch (err) {
      console.error("Error converting deal:", err);
    }
  }
});

// ============================================================
// 3. Auto Tag Lead Source
// ============================================================

export const autoTagLeadSource = onDocumentCreated("leads/{leadId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;

  if (!data.source) {
    try {
      await event.data.ref.update({ source: "Manual" });
    } catch (err) {
      console.error("Error tagging lead source:", err);
    }
  }
});

// ============================================================
// UNIVERSAL SEARCH INDEXER
// ============================================================

function buildIndex(module, id, data) {
  return {
    module,
    refId: id,
    kpi:
      data.kpiId ||
      data.autoId ||
      data.KPIID ||
      data.projectId ||
      id,
    title: `${module.toUpperCase()} → ${data.kpiId || data.autoId || data.KPIID || data.projectId || id}`,
    keywords: [
      (data.kpiId || "").toLowerCase(),
      (data.autoId || "").toLowerCase(),
      (data.KPIID || "").toLowerCase(),
      (data.projectId || "").toLowerCase(),
      (data.customerName || data.name || data.leadName || "").toLowerCase(),
      (data.customerPhone || data.phone || "").toLowerCase(),
      id.toLowerCase(),
    ],
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function registerIndexer(moduleName) {
  return onDocumentWritten(`${moduleName}/{docId}`, async (event) => {
    const beforeExists = event.data.before.exists;
    const afterExists = event.data.after.exists;
    const id = event.params.docId;

    if (beforeExists && !afterExists) {
      await db.collection("search_index").doc(`${moduleName}_${id}`).delete();
      return;
    }

    const data = event.data.after.data();
    const indexData = buildIndex(moduleName, id, data);

    await db
      .collection("search_index")
      .doc(`${moduleName}_${id}`)
      .set(indexData);
  });
}

// ============================================================
// PASSWORD RESET (HTTP VERSION WITH FULL CORS SUPPORT)
// ============================================================
export const resetUserPassword = onRequest(
  { region: "asia-south1" },
  (req, res) => {
    corsHandler(req, res, async () => {
      try {
        const { email, newPassword } = req.body;

        if (!email || !newPassword) {
          return res.status(400).json({ error: "Missing email or newPassword" });
        }

        const auth = getAuth();
        const userRecord = await auth.getUserByEmail(email);

        await auth.updateUser(userRecord.uid, { password: newPassword });

        const snap = await db
          .collection("Users")
          .where("email", "==", email)
          .get();

        if (!snap.empty) {
          await snap.docs[0].ref.update({
            password: newPassword,
            lastPasswordReset: FieldValue.serverTimestamp(),
          });
        }

        return res.status(200).json({ success: true });

      } catch (err) {
        console.error("Password reset error:", err);
        return res.status(500).json({ error: err.message });
      }
    });
  }
);
// ============================================================
// EXPORT INDEXERS
// ============================================================
// ⭐ ADD THESE NEW INDEXERS ⭐
export const indexAttendance = registerIndexer("attendance");
export const indexLeaveRequests = registerIndexer("leaveRequests");
export const indexHolidays = registerIndexer("holidays");
export const indexUsers = registerIndexer("Users");
export const indexWorkingDays = registerIndexer("attendance_workingDays");
