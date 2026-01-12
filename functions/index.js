// ============================================================
// CRM AUTOMATION - Lead → Deal → Consultant → Survey System
// ============================================================

import {
  onDocumentUpdated,
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import cors from "cors";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import nodemailer from "nodemailer";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const db = getFirestore();
const corsHandler = cors({ origin: true });

// ============================================================
// 🔐 SMTP SECRETS
// ============================================================
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");

function getTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: SMTP_USER.value(),
      pass: SMTP_PASS.value(),
    },
  });
}
// ============================================================
// 🛑 SYSTEM BLOCKER — DELETE INVALID DEALS (NO KPI MISMATCH)
// ============================================================
export const blockInvalidDeals = onDocumentCreated(
  "deals/{dealId}",
  async (event) => {
    const data = event.data?.data();
    const dealId = event.params.dealId;

    if (!data) return;

    // 🔥 KPI-ID MUST MATCH DOCUMENT ID
    if (data.kpiId && data.kpiId !== dealId) {
      console.error("❌ Invalid deal detected. Deleting:", dealId);

      await event.data.ref.update({
        _systemDelete: true, // marker for rules
      });

      await event.data.ref.delete();
      return;
    }
  }
);

export const moveDealAttachmentsToSalesOrder = onDocumentCreated(
  "salesOrders/{soId}",
  async (event) => {
    try {
      const soId = event.params.soId;
      const so = event.data?.data();
      if (!so) return;

      const dealId = so.dealRef || so.dealId || null;
      if (!dealId) {
        console.log("❌ No deal reference found in Sales Order");
        return;
      }

      const dealRef = db.collection("deals").doc(dealId);
      const attSnap = await dealRef.collection("attachments").get();

      if (attSnap.empty) {
        console.log("ℹ No attachments in deal");
        return;
      }

      const soRef = db.collection("salesOrders").doc(soId);
      const batch = db.batch();

      attSnap.docs.forEach((doc) => {
        const data = doc.data();
        const newRef = soRef.collection("attachments").doc();

        batch.set(newRef, {
          ...data,
          movedFromDeal: dealId,
          movedAt: new Date().toISOString(),
        });
      });

      await batch.commit();

      console.log(`✔ Attachments moved from Deal ${dealId} → SalesOrder ${soId}`);
    } catch (err) {
      console.error("❌ Move Attachments Error", err);
    }
  }
);


// ============================================================
// 📨 CONSULTANT MAIL — WHEN DEAL CREATED
// ============================================================
export const notifyConsultantOnDealCreate = onDocumentCreated(
  { document: "deals/{dealId}", secrets: [SMTP_USER, SMTP_PASS] },
  async (event) => {
    const transporter = getTransporter();
    const deal = event.data?.data();
const dealId = event.params.dealId;

// 🛑 HARD SAFETY CHECK — ONLY KPI-ID DOCS
if (!deal || deal.kpiId !== dealId) {
  console.log("⛔ Skipping mail for invalid deal:", dealId);
  return;
}

    try {
      const consultantName = deal.consultantName || "";
      if (!consultantName) {
        console.log("No consultant assigned — skipping");
        return;
      }

      // Get consultant email
      const usersSnap = await db
        .collection("Users")
        .where("Name", "==", consultantName)
        .get();

      if (usersSnap.empty) {
        console.log("Consultant not found");
        return;
      }

      const consultantEmail = usersSnap.docs[0].data().email;
      if (!consultantEmail) {
        console.log("Consultant has no email");
        return;
      }

      // ---- NO TOKEN GENERATION HERE ----
      // This mail is ONLY notification

      const siteVisitDate = deal.siteVisitArrangedDate || "Not Provided";

      await transporter.sendMail({
        from: `"Kapil Power CRM" <${SMTP_USER.value()}>`,
        to: consultantEmail,
        subject: `New KPI Assigned: ${deal.autoId || ""}`,
        html: `
          <h3>Hello,</h3>
          <p>A new KPI has been assigned to you.</p>

          <p><b>KPI:</b> ${deal.autoId || ""}</p>
          <p><b>Customer:</b> ${deal.name || ""}</p>
          <p><b>Phone:</b> ${deal.phone || ""}</p>
          <p><b>Location:</b> ${deal.address || deal.location || ""}</p>

          <p><b>Site Visit Scheduled On:</b> ${siteVisitDate}</p>

          <br>

          <p>Please be prepared for the site visit.<br>
          This is only an information update, survey submission link is already shared separately.</p>

          <p>Thank You,<br>
          Kapil Power CRM</p>
        `,
      });

      console.log("Deal Create INFO Mail Sent");
    } catch (err) {
      console.error("Deal create mail failed:", err);
    }
  }
);

// ============================================================
// 📨 CONSULTANT MAIL — WHEN ASSIGNED
// ============================================================
export const notifyConsultantOnAssignment = onDocumentWritten(
  { document: "deals/{dealId}", secrets: [SMTP_USER, SMTP_PASS] },
  async (event) => {
    const transporter = getTransporter();
    const before = event.data.before?.data() || null;
    const after = event.data.after?.data() || null;
    if (!after) return;

    const newConsultant = after.assignedConsultant || "";
    const oldConsultant = before?.assignedConsultant || "";

    if (before && newConsultant === oldConsultant) return;
    if (!newConsultant) return;

    // Token
    const token = Math.random().toString(36).substring(2) + Date.now();
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    await db.collection("deals").doc(event.params.dealId).update({
      siteSurveyToken: token,
      siteSurveyActive: true,
      siteSurveyExpiresAt: expires.toISOString(),
    });

    const dealId = event.params.dealId;

    const link = `https://crm.kapilpower.com/site-survey/start/${dealId}/${token}`;

    const siteVisitDate = after.siteVisitArrangedDate || "Not Provided";

    await transporter.sendMail({
      from: `"Kapil Power CRM" <${SMTP_USER.value()}>`,
      to: newConsultant,
      subject: `New KPI Assigned: ${after.autoId || dealId}`,
      html: `
        <h3>Hello,</h3>
        <p>A new KPI has been assigned to you.</p>

        <p><b>KPI:</b> ${after.autoId || dealId}</p>
        <p><b>Customer:</b> ${after.name || ""}</p>

        <p><b>${after.name || "Customer"}</b> will be available for the site visit on 
        <b>${siteVisitDate}</b></p>

        <p><b>Survey Link:</b></p>
        <p><a href="${link}">${link}</a></p>

        <p>Valid for 7 Days</p>
      `,
    });

    console.log("Assignment Mail Sent 🎯");
  }
);
// ============================================================
// 🔁 ADMIN — REGENERATE LINK
// ============================================================
export const regenerateSurveyLink = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      const { dealId } = req.query;
      if (!dealId) return res.status(400).send("Missing dealId");

      const token = Math.random().toString(36).substring(2) + Date.now();
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      await db.collection("deals").doc(dealId).update({
        siteSurveyToken: token,
        siteSurveyActive: true,
        siteSurveyExpiresAt: expires.toISOString(),
      });

      const link =
 `https://crm.kapilpower.com/site-survey/start/${dealId}/${token}`;

      return res.send({ message: "Regenerated", link, expires });
    } catch (e) {
      console.error(e);
      return res.status(500).send("Error");
    }
  }
);

// ============================================================
// 📌 GET DEAL DETAILS FOR SITE SURVEY FORM
// ============================================================
export const getDealForSurvey = onRequest(
  { cors: true, region: "us-central1" },
  async (req, res) => {
    try {
      const { dealId, token } = req.query;

      if (!dealId || !token) {
        return res.status(400).send({ error: "Missing dealId or token" });
      }

      const dealRef = db.collection("deals").doc(dealId);
      const dealSnap = await dealRef.get();

      if (!dealSnap.exists) {
        return res.status(404).send({ error: "Deal Not Found" });
      }

      const deal = dealSnap.data();

      // Token Check
      if (!deal.siteSurveyToken || deal.siteSurveyToken !== token) {
        return res.status(403).send({ error: "Invalid Token" });
      }

      // Expiry Check
      if (deal.siteSurveyExpiresAt) {
        const now = new Date();
        const exp =
          deal.siteSurveyExpiresAt?.toDate
            ? deal.siteSurveyExpiresAt.toDate()
            : new Date(deal.siteSurveyExpiresAt);

        if (now > exp) {
          return res.status(403).send({ error: "Link Expired" });
        }
      }

    return res.send({
  success: true,
  deal: {
    id: dealId,

    // KPI
    kpi: deal.kpiId || deal.autoId || "",

    // Customer Details
    customer: deal.name || "",
    phone: deal.phone || "",
    location: deal.location || "",
    googleMaps: deal.locationLink || "",

    // Team
    telesales: deal.teleSale || "",
    consultant: deal.consultantName || deal.assignedConsultant || "",

    visitDate: deal.siteVisitArrangedDate || "",
  },
});
    } catch (e) {
      console.error("Survey Fetch Error:", e);
      return res.status(500).send({ error: "Server Error" });
    }
  }
);


// ============================================================
// 📝 SITE SURVEY SUBMIT API
// ============================================================
export const submitSiteSurvey = onRequest(
  { cors: true, region: "us-central1", secrets: [SMTP_USER, SMTP_PASS] },
  async (req, res) => {
    try {
      const { dealId, token, formData, attachments } = req.body;

      if (!dealId || !token || !formData)
        return res.status(400).send({ error: "Missing data" });

      const dealRef = db.collection("deals").doc(dealId);
      const dealSnap = await dealRef.get();
      if (!dealSnap.exists)
        return res.status(404).send({ error: "Deal not found" });

      const deal = dealSnap.data();

      if (deal.siteSurveyToken !== token)
        return res.status(403).send({ error: "Invalid token" });

      if (deal.siteSurveyActive === false)
        return res.status(403).send({ error: "Already submitted" });

      if (deal.siteSurveyExpiresAt) {
        const now = new Date();
        const exp = new Date(deal.siteSurveyExpiresAt);
        if (now > exp) return res.status(403).send({ error: "Expired" });
      }

      await dealRef.update({
        siteSurveyData: formData,
        siteSurveyCompleted: true,
        siteSurveyCompletedAt: new Date().toISOString(),
        siteSurveyActive: false,
      });

      if (attachments && attachments.length > 0) {
        const batch = db.batch();
        attachments.forEach((file) => {
          const ref = dealRef.collection("attachments").doc();
          batch.set(ref, {
            name: file.label || "Survey File",
            fileName: file.fileName,
            url: file.url,
            uploadedAt: new Date().toISOString(),
            type: "siteSurvey",
          });
        });
        await batch.commit();
      }
      // ===============================
// CREATE SITE SURVEY REPORT ENTRY
// ===============================
await dealRef
  .collection("attachments")
  .doc("siteSurveyReport")
  .set({
    type: "siteSurvey",
    title: "Site Survey Report",
    url: `https://crm.kapilpower.com/survey-report/${dealId}`,
    createdAt: FieldValue.serverTimestamp()
  });

console.log("📎 Site Survey Attachment Added");

      return res.send({ success: true });
    } catch (e) {
      console.error(e);
      return res.status(500).send({ error: "Server Error" });
    }
  }
);

// ============================================================
// 📩 EMAIL TO DESIGN TEAM
// ============================================================
export const notifyDesignTeamOnSurveyUpload = onDocumentWritten(
  {
    document: "deals/{dealId}",
    secrets: [SMTP_USER, SMTP_PASS],
  },
  async (event) => {
    const after = event.data.after.data();
    const before = event.data.before?.data();
    const dealId = event.params.dealId;
    const kpi =
      after.kpiId ||
      after.kpid ||
      after.id ||
      after.autoId ||
      "Unknown-KPI";

    if (!after || !after.siteSurveyStatus) return;

    // Prevent duplicate sends
// Run ONLY when status becomes completed
if (after.siteSurveyStatus === "completed" && before?.siteSurveyStatus !== "completed") {

      // Save Design Link in Deals
await db.collection("deals").doc(dealId).update({
  designlink: `https://crm.kapilpower.com/survey-report/${dealId}`
});

console.log("✔ Design link stored in deal");


      const transporter = getTransporter();

await transporter.sendMail({
  from: `"Kapil Power CRM" <${SMTP_USER.value()}>`,
  to: "design@kapilpower.com",
  subject: `New Site Survey Submitted - ${kpi}`,
  html: `
    <h2>New Site Survey Submitted</h2>

    <p><b>KPI:</b> ${after.kpiId}</p>
    <p><b>Customer:</b> ${after.name || after.customerName}</p>
    <p><b>Phone:</b> ${after.phone || after.customerPhone}</p>

    <p>
      <b>Open Survey Report</b><br>
      <a href="https://crm.kapilpower.com/survey-report/${dealId}">
        View Full Report
      </a>
    </p>

    <p>This report is safely stored in CRM and can be accessed anytime.</p>
  `,
});

      console.log("Design Team Mail Sent 👍");
    }
  }
);

// ============================================================
// 🔍 SEARCH INDEXERS
// ============================================================
function buildIndex(module, id, data) {
  return {
    module,
    refId: id,
    kpi:
      data.kpiId || data.autoId || data.KPIID || data.projectId || id,
    title: `${module.toUpperCase()} → ${
      data.kpiId || data.autoId || data.KPIID || data.projectId || id
    }`,
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

export const indexAttendance = registerIndexer("attendance");
export const indexLeaveRequests = registerIndexer("leaveRequests");
export const indexHolidays = registerIndexer("holidays");
export const indexUsers = registerIndexer("Users");
export const indexWorkingDays = registerIndexer("attendance_workingDays");
export const indexDeals = onDocumentWritten(
  { region: "asia-south1", document: "deals/{docId}" },
  async (event) => {
    const beforeExists = event.data.before.exists;
    const afterExists = event.data.after.exists;
    const id = event.params.docId;

    if (beforeExists && !afterExists) {
      await db.collection("search_index").doc(`deals_${id}`).delete();
      return;
    }

    const data = event.data.after.data();
    const indexData = buildIndex("deals", id, data);

    await db.collection("search_index").doc(`deals_${id}`).set(indexData);
  }
);

export const indexLeads = registerIndexer("leads");
export const indexProjects = registerIndexer("projects");
export const indexSalesOrders = registerIndexer("salesOrders");
