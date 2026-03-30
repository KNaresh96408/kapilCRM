// ============================================================
// CRM AUTOMATION - Lead → Deal → Consultant → Survey System
// ============================================================

import {
  onDocumentUpdated,
  onDocumentCreated,
  onDocumentWritten,
  onDocumentDeleted,
} from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import cors from "cors";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

initializeApp();
const db = getFirestore();
const corsHandler = cors({ origin: true });

// ============================================================
// ⚡️ In-memory cache (best-effort)
// ============================================================
const attendanceTodayCache = new Map();
const attendanceRangeCache = new Map();
const holidaysCache = { data: null, expires: 0 };
const workingDaysCache = { data: null, expires: 0 };
const crmListCache = new Map();

const getCacheEntry = (map, key) => {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expires > Date.now()) return hit.value;
  map.delete(key);
  return null;
};

const setCacheEntry = (map, key, value, ttlMs) => {
  map.set(key, { value, expires: Date.now() + ttlMs });
};

const getObjectCache = (bucket) => {
  if (bucket?.expires > Date.now()) return bucket.data;
  return null;
};

const setObjectCache = (bucket, value, ttlMs) => {
  bucket.data = value;
  bucket.expires = Date.now() + ttlMs;
};

const extractUidFromToken = (authHeader) => {
  if (!authHeader || typeof authHeader !== "string") return "";
  const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const parts = raw.split(".");
  if (parts.length < 2) return "";
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const json = JSON.parse(decoded);
    return String(json?.user_id || json?.sub || "").trim();
  } catch {
    return "";
  }
};

const resolveUid = (req) => {
  const headerUid = req.headers.uid || req.headers["x-user-id"] || req.query.uid;
  if (headerUid) return String(headerUid).trim();
  const auth = req.headers.authorization || req.headers.Authorization;
  return extractUidFromToken(auth);
};

const requireAuth = async (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  if (!raw) throw new Error("Missing Authorization token");
  const decoded = await getAuth().verifyIdToken(raw);
  return decoded || null;
};

const LOADTEST_COLLECTIONS = new Set([
  "attendance_loadtest",
  "crm_loadtest",
]);

const getLoadtestCollection = (raw, fallback) => {
  const name = String(raw || fallback || "").trim();
  if (!LOADTEST_COLLECTIONS.has(name)) return fallback;
  return name;
};

// ============================================================
// 🔐 SMTP SECRETS
// ============================================================
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_INBOUND_TOKEN = defineSecret("MAIL_INBOUND_TOKEN");
const MAILGUN_SIGNING_KEY = defineSecret("MAILGUN_SIGNING_KEY");
const PASSWORD_OTP_SECRET = defineSecret("PASSWORD_OTP_SECRET");
const WHATSAPP_ACCESS_TOKEN = defineSecret("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_SENDER_NUMBER = defineSecret("WHATSAPP_SENDER_NUMBER");

const normalizeRole = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[\s-]+/g, "_")
  .replace(/_+/g, "_");

const roleAlias = {
  saleshead: "sales_head",
  hroperationsmanager: "agm",
  hr_operations_manager: "agm",
  financemanager: "dgm",
  finance_manager: "dgm",
  hrexecutive: "hr_executive",
  tele_sales: "telesales",
  tele_sale: "telesales",
  telecaller: "telesales",
  tele_caller: "telesales",
};

function canonicalRole(value) {
  const normalized = normalizeRole(value);
  if (!normalized) return "";
  const compact = normalized.replace(/_/g, "");
  return roleAlias[normalized] || roleAlias[compact] || normalized;
}

function isBulkImportRecord(data) {
  return (
    data?._bulkImport === true ||
    data?.skipAutomation === true ||
    data?.source === "excel_import" ||
    data?.importMeta?.skipAutomation === true
  );
}

async function getUsersByRoleLoose(role) {
  const target = canonicalRole(role);
  if (!target) return [];
  const snap = await db.collection("Users").get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((u) => canonicalRole(u.role || u.Role || u.designation || u.Designation) === target);
}

async function getUserEmailsByRoleLoose(role) {
  const users = await getUsersByRoleLoose(role);
  return users
    .map((u) => String(u.email || "").trim())
    .filter(Boolean);
}

async function findUserByEmailOrNameLoose(rawValue, roleHint = "") {
  const needle = String(rawValue || "").trim().toLowerCase();
  if (!needle) return null;

  const snap = await db.collection("Users").get();
  const users = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const match = users.find((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    const name = String(u.Name || u.name || "").trim().toLowerCase();
    const role = canonicalRole(u.role || u.Role || u.designation || u.Designation);

    const valueMatched = email === needle || name === needle;
    if (!valueMatched) return false;
    if (!roleHint) return true;
    return role === canonicalRole(roleHint);
  });

  return match || null;
}

async function createNotificationIfMissing({ dedupeKey, payload }) {
  if (!dedupeKey) return null;
  const existing = await db.collection("notifications").where("dedupeKey", "==", dedupeKey).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  const ref = await db.collection("notifications").add({
    ...payload,
    dedupeKey,
    active: payload?.active !== false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

const MEETING_CREATOR_ROLES = new Set([
  "admin",
  "sales_head",
  "state_head",
  "team_lead",
  "zonal_manager",
]);

const MEETING_BASE_URL = String(process.env.MEETING_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const MEETING_TIME_ZONE = String(process.env.MEETING_TIME_ZONE || "Asia/Kolkata").trim() || "Asia/Kolkata";
const ENABLE_MEETING_MAINTENANCE_ALERTS = String(process.env.ENABLE_MEETING_MAINTENANCE_ALERTS || "false")
  .trim()
  .toLowerCase() === "true";

const sanitizeMeetingBaseUrl = (rawUrl = "") => {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname || "").toLowerCase();
    // Defensive fallback: CRM app host currently serves SPA and not a meeting bridge path.
    if (host === "crm.kapilpower.com") return "";
    return value.replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const SAFE_MEETING_BASE_URL = sanitizeMeetingBaseUrl(MEETING_BASE_URL);

const sanitizeMeetingRoomName = (rawRoomName = "") => {
  const normalized = String(rawRoomName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized;
};

const extractRoomFromMeetingLink = (rawLink = "") => {
  const value = String(rawLink || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const roomSegment = decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, ""));
    return sanitizeMeetingRoomName(roomSegment);
  } catch {
    return "";
  }
};

const resolveMeetingRoomName = (meeting = {}) => {
  const roomFromDoc = sanitizeMeetingRoomName(String(meeting.roomName || ""));
  if (roomFromDoc) return roomFromDoc;
  return extractRoomFromMeetingLink(String(meeting.meetingLink || ""));
};

const buildMeetingLink = (roomName) => {
  const room = sanitizeMeetingRoomName(roomName);
  if (!room || !SAFE_MEETING_BASE_URL) return "";
  return `${SAFE_MEETING_BASE_URL}/${encodeURIComponent(room)}`;
};

const resolveMeetingLink = (meeting = {}) => {
  const roomName = resolveMeetingRoomName(meeting);
  if (roomName && SAFE_MEETING_BASE_URL) {
    return `${SAFE_MEETING_BASE_URL}/${encodeURIComponent(roomName)}`;
  }

  const directLink = String(meeting.meetingLink || "").trim();
  if (/^https?:\/\//i.test(directLink)) return directLink.replace(/\/+$/, "");

  return "";
};

const normalizeScopeToken = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "")
  .replace(/[^a-z0-9]/g, "");

const toMillisSafe = (value) => {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
};

const TERMINAL_MEETING_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "ended",
  "deleted",
  "inactive",
]);

const isMeetingOperationalCandidate = (meeting = {}, nowMs = Date.now()) => {
  if (!meeting || meeting.active === false) return false;

  const status = String(meeting.status || "scheduled").trim().toLowerCase();
  if (TERMINAL_MEETING_STATUSES.has(status)) return false;

  const startAtMillis = toMillisSafe(meeting.startAtMillis || meeting.startAt);
  const endAtMillis = toMillisSafe(meeting.endAtMillis || meeting.endAt);

  if (endAtMillis && endAtMillis < nowMs - (15 * 60 * 1000)) return false;
  if (!endAtMillis && startAtMillis && startAtMillis < nowMs - (4 * 60 * 60 * 1000)) return false;

  return true;
};

const formatMeetingTime = (ms) => {
  if (!ms) return "-";
  try {
    return new Date(ms).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: MEETING_TIME_ZONE,
    });
  } catch {
    return "-";
  }
};

const toAbsoluteCrmLink = (rawValue = "") => {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;

  const appBase = "https://crm.kapilpower.com";
  if (value.startsWith("#/")) return `${appBase}/${value}`;
  if (value.startsWith("/")) return `${appBase}/#${value}`;
  return `${appBase}/#/${value.replace(/^\/+/, "")}`;
};

const resolveMeetingRecipients = async (meeting = {}) => {
  const targetType = String(meeting.targetType || "all").trim().toLowerCase();
  const targetValueNorm = normalizeScopeToken(meeting.targetValueNorm || meeting.targetValue || "");

  const snap = await db.collection("Users").get();
  const recipients = [];

  snap.docs.forEach((docSnap) => {
    const u = docSnap.data() || {};
    const email = normalizeEmail(u.email || u.Email || "");
    if (!email) return;

    const userStateNorm = normalizeScopeToken(u.state || u.state_label || "");
    const userZoneNorm = normalizeScopeToken(u.sales_zone || u.salesZone || u.sales_zone_label || "");

    const include =
      targetType === "all" ||
      (targetType === "state" && targetValueNorm && userStateNorm === targetValueNorm) ||
      (targetType === "zone" && targetValueNorm && userZoneNorm === targetValueNorm);

    if (!include) return;

    recipients.push({
      uid: docSnap.id,
      email,
      name: String(u.Name || u.name || u.displayName || "").trim(),
    });
  });

  return recipients;
};

const notifyMeetingMaintenanceAlert = async ({ stage, meetingId, errorMessage }) => {
  if (!ENABLE_MEETING_MAINTENANCE_ALERTS) {
    logger.info("meeting maintenance alert suppressed", {
      stage: String(stage || ""),
      meetingId: String(meetingId || ""),
    });
    return null;
  }

  const safeStage = String(stage || "meeting_pipeline").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "meeting_pipeline";
  const safeMeetingId = String(meetingId || "unknown").trim() || "unknown";
  const safeError = String(errorMessage || "unknown_error").trim().slice(0, 500);
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const dedupeKey = `meeting_maintenance_${safeStage}_${safeMeetingId}_${hourBucket}`;

  await createNotificationIfMissing({
    dedupeKey,
    payload: {
      type: "meeting_maintenance_alert",
      module: "crm",
      referenceType: "meeting",
      referenceId: safeMeetingId,
      title: `Meeting pipeline alert (${safeStage})`,
      subject: `Meeting pipeline alert (${safeStage})`,
      body: `Meeting ${safeMeetingId}: ${safeError}`,
      message: `Meeting ${safeMeetingId}: ${safeError}`,
      route: "/crm/meetings",
      link: "/crm/meetings",
      url: "/crm/meetings",
      toRole: "admin",
      status: "unread",
      active: true,
      source: "meeting_maintenance_alert",
    },
  });
};

const dispatchMeetingInvites = async ({ meetingId, meeting = {}, mode = "invite", cycleKey = "" }) => {
  const recipientsFromDoc = Array.isArray(meeting.recipientUids) && meeting.recipientUids.length
    ? meeting.recipientUids.map((uid, idx) => ({
      uid: String(uid || "").trim(),
      email: normalizeEmail(Array.isArray(meeting.recipientEmails) ? meeting.recipientEmails[idx] : ""),
      name: "",
    })).filter((x) => x.uid || x.email)
    : [];

  let recipients = recipientsFromDoc;
  if (!recipients.length) {
    recipients = await resolveMeetingRecipients(meeting);
  }

  if (!recipients.length) {
    await db.collection("meetings").doc(meetingId).set({
      recipientUids: [],
      recipientEmails: [],
      inviteDispatchState: mode === "invite" ? "no_recipients" : (meeting.inviteDispatchState || "unknown"),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { recipients: [] };
  }

  const meetingLink = resolveMeetingLink(meeting);
  const meetingRoute = `/crm/meetings?join=${encodeURIComponent(String(meetingId || "").trim())}`;
  const startMs = toMillisSafe(meeting.startAtMillis || meeting.startAt);
  const endMs = toMillisSafe(meeting.endAtMillis || meeting.endAt);
  const title = String(meeting.title || "Internal Meeting").trim();
  const agenda = String(meeting.agenda || "").trim();
  const targetLabel = String(meeting.targetValueLabel || (meeting.targetType === "all" ? "All Internal Members" : meeting.targetValue || "")).trim();
  const hostEmail = normalizeEmail(meeting.createdByEmail || "");
  const hostUser = meeting.createdByUid
    ? await db.collection("Users").doc(String(meeting.createdByUid)).get().catch(() => null)
    : null;
  const hostName = String(hostUser?.exists ? (hostUser.data()?.Name || hostUser.data()?.name || hostUser.data()?.displayName || "") : "").trim() || hostEmail || "CRM";

  for (const recipient of recipients) {
    const uid = String(recipient.uid || "").trim();
    const email = normalizeEmail(recipient.email || "");
    if (!uid && !email) continue;

    const isReminder = mode === "reminder";
    const isResend = mode === "resend";
    const dedupeCycle = String(cycleKey || "v1").trim();
    const dedupeKey = `meeting_${mode}_${meetingId}_${uid || email}_${dedupeCycle}`;
    const subject = isReminder
      ? `Reminder: ${title} starts in 1 hour`
      : isResend
        ? `Meeting Invite (Resent): ${title}`
      : `Meeting Invite: ${title}`;
    const body = isReminder
      ? `${title} starts at ${formatMeetingTime(startMs)}. Please join on time.`
      : `You are invited to ${title} from ${formatMeetingTime(startMs)} to ${formatMeetingTime(endMs)}.`;

    await createNotificationIfMissing({
      dedupeKey,
      payload: {
        type: isReminder ? "meeting_reminder" : "meeting_invite",
        module: "crm",
        referenceType: "meeting",
        referenceId: meetingId,
        title: subject,
        subject,
        body,
        message: body,
        route: meetingRoute,
        link: meetingLink || "/crm/meetings",
        url: meetingLink || "/crm/meetings",
        toUserId: uid || null,
        toEmails: email ? [email] : [],
        status: "unread",
        active: true,
      },
    });

    if (!uid) continue;

    const mailDocId = `${meetingId}_${mode}_${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
    const mailRef = db.collection("mailboxes").doc(uid).collection("messages").doc(mailDocId);

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h3 style="margin: 0 0 10px; color: #6f0f29;">${subject}</h3>
        <p><b>Title:</b> ${title}</p>
        <p><b>From:</b> ${hostName}${hostEmail ? ` &lt;${hostEmail}&gt;` : ""}</p>
        <p><b>When:</b> ${formatMeetingTime(startMs)} to ${formatMeetingTime(endMs)}</p>
        <p><b>Target:</b> ${targetLabel || "All Internal Members"}</p>
        ${agenda ? `<p><b>Agenda:</b> ${agenda}</p>` : ""}
        ${meetingLink ? `<p><a href="${meetingLink}" target="_blank" rel="noreferrer">Join meeting (Audio/Video)</a></p>` : ""}
      </div>
    `;

    await mailRef.set({
      id: mailDocId,
      sourceMeetingId: meetingId,
      ownerUid: uid,
      folder: "inbox",
      fromUid: String(meeting.createdByUid || "") || null,
      fromEmail: hostEmail || "crm@kapilpower.com",
      fromName: hostName || "CRM",
      toEmails: email ? [email] : [],
      toUids: [uid],
      ccEmails: [],
      bccEmails: [],
      subject,
      body,
      bodyHtml,
      attachments: [],
      preview: body.slice(0, 180),
      isRead: false,
      isStarred: false,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      kind: "mail",
      isSystemGenerated: true,
    }, { merge: true });
  }

  return {
    recipients,
    recipientUids: recipients.map((r) => String(r.uid || "").trim()).filter(Boolean),
    recipientEmails: recipients.map((r) => normalizeEmail(r.email)).filter(Boolean),
  };
};

async function mirrorSystemMailToInternalMailbox({ mailOptions = {}, smtpInfo = null }) {
  try {
    const toEmails = parseEmailInput(mailOptions.to || []);
    const ccEmails = parseEmailInput(mailOptions.cc || []);
    const bccEmails = parseEmailInput(mailOptions.bcc || []);
    const allTargets = Array.from(new Set([
      ...toEmails,
      ...ccEmails,
      ...bccEmails,
    ].map((x) => normalizeEmail(x)).filter(Boolean)));

    if (!allTargets.length) return;

    const usersByEmail = await getUsersByEmails(allTargets);
    const recipients = allTargets
      .map((email) => usersByEmail.get(email))
      .filter(Boolean)
      .slice(0, 120);

    if (!recipients.length) return;

    const fromRaw = String(mailOptions.from || "").trim();
    const fromMatch = fromRaw.match(/^(.*)<([^>]+)>$/);
    const fromName = String(fromMatch ? fromMatch[1] : fromRaw)
      .replace(/^"|"$/g, "")
      .trim() || "Kapil Power CRM";
    const fromEmail = normalizeEmail(fromMatch ? fromMatch[2] : fromRaw) || normalizeEmail(SMTP_USER.value() || "");

    const subject = sanitizeMailText(mailOptions.subject || "", 250) || "CRM Notification";
    const bodyText = sanitizeMailText(mailOptions.text || "", 40000);
    const bodyHtml = sanitizeMailText(mailOptions.html || "", 120000);
    const body = bodyText || stripHtml(bodyHtml);
    const preview = stripHtml(bodyHtml || body).replace(/\s+/g, " ").trim().slice(0, 180);

    const sourceMailId = db.collection("mail_meta").doc().id;
    const ts = FieldValue.serverTimestamp();
    const accepted = extractEmailsLoose(smtpInfo?.accepted || []);
    const rejected = extractEmailsLoose(smtpInfo?.rejected || []);

    const batch = db.batch();
    recipients.forEach((recipient, idx) => {
      const uid = String(recipient.uid || recipient.id || recipient.docId || "").trim();
      if (!uid) return;

      const recipientEmail = normalizeEmail(recipient.email || "");
      const deliveryType = bccEmails.includes(recipientEmail)
        ? "bcc"
        : ccEmails.includes(recipientEmail)
          ? "cc"
          : "to";

      const docId = idx === 0 ? sourceMailId : `${sourceMailId}_${idx}`;
      const ref = db.collection("mailboxes").doc(uid).collection("messages").doc(docId);

      batch.set(ref, {
        id: docId,
        sourceMailId,
        ownerUid: uid,
        folder: "inbox",
        fromUid: null,
        fromEmail,
        fromName,
        toEmails,
        toUids: [],
        ccEmails,
        bccEmails: [],
        deliveryType,
        subject,
        body,
        bodyHtml,
        attachments: [],
        preview,
        isRead: false,
        isStarred: false,
        createdAt: ts,
        sentAt: ts,
        updatedAt: ts,
        kind: "mail",
        isSystemGenerated: true,
        smtpAccepted: accepted,
        smtpRejected: rejected,
      });
    });

    await batch.commit();
  } catch (e) {
    logger.error("mirrorSystemMailToInternalMailbox failed", e);
  }
}

function getTransporter({ mirrorInternal = true } = {}) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: SMTP_USER.value(),
      pass: SMTP_PASS.value(),
    },
  });

  if (!mirrorInternal) return transporter;

  const originalSendMail = transporter.sendMail.bind(transporter);
  transporter.sendMail = async (mailOptions = {}, callback) => {
    const shouldMirror = mailOptions?.internalMirror !== false;
    const info = await originalSendMail(mailOptions, callback);
    if (shouldMirror) {
      await mirrorSystemMailToInternalMailbox({
        mailOptions,
        smtpInfo: info,
      });
    }
    return info;
  };

  return transporter;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function parseEmailInput(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(normalizeEmail).filter(Boolean)));
  }
  return Array.from(
    new Set(
      String(value || "")
        .split(/[;,\s]+/g)
        .map(normalizeEmail)
        .filter(Boolean)
    )
  );
}

async function getUsersByEmails(emails = []) {
  const targets = Array.from(new Set((emails || []).map(normalizeEmail).filter(Boolean)));
  const byEmail = new Map();
  if (!targets.length) return byEmail;

  const chunkSize = 10; // Firestore `in` limit
  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);

    const [lowerSnap, upperSnap] = await Promise.all([
      db.collection("Users").where("email", "in", chunk).get().catch(() => null),
      db.collection("Users").where("Email", "in", chunk).get().catch(() => null),
    ]);

    [lowerSnap, upperSnap].forEach((snap) => {
      if (!snap) return;
      snap.docs.forEach((docSnap) => {
        const d = docSnap.data() || {};
        const email = normalizeEmail(d.email || d.Email || "");
        if (email) byEmail.set(email, { ...d, uid: docSnap.id, email });
      });
    });
  }

  // Fallback: some legacy user docs have inconsistent casing/fields that may
  // miss strict indexed lookups above. Resolve any unresolved recipients by
  // scanning users once and normalizing email values.
  const unresolved = targets.filter((email) => !byEmail.has(email));
  if (unresolved.length) {
    const unresolvedSet = new Set(unresolved);
    const allUsersSnap = await db.collection("Users").get().catch(() => null);
    if (allUsersSnap) {
      allUsersSnap.docs.forEach((docSnap) => {
        const d = docSnap.data() || {};
        const candidates = [
          d.email,
          d.Email,
          d.officeEmail,
          d.workEmail,
        ].map((value) => normalizeEmail(value));

        const matched = candidates.find((email) => email && unresolvedSet.has(email));
        if (!matched) return;

        byEmail.set(matched, {
          ...d,
          uid: docSnap.id,
          email: matched,
        });
      });
    }
  }

  return byEmail;
}

function buildReplyAlias(baseEmail, uid) {
  const email = normalizeEmail(baseEmail);
  const cleanUid = String(uid || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!email || !cleanUid || !email.includes("@")) return email;

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return email;

  return `${localPart}+kpuid_${cleanUid}@${domain}`;
}

function extractUidFromReplyAlias(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  const match = normalized.match(/\+kpuid_([a-zA-Z0-9_-]+)@/i);
  return match ? String(match[1] || "").trim() : "";
}

function extractEmailsLoose(value) {
  const set = new Set();

  const visit = (input) => {
    if (!input) return;

    if (Array.isArray(input)) {
      input.forEach((item) => visit(item));
      return;
    }

    if (typeof input === "object") {
      const objectEmail = normalizeEmail(
        input.email || input.address || input.mail || input.value || ""
      );
      if (objectEmail) {
        set.add(objectEmail);
      }

      const objectValues = [
        input.from,
        input.to,
        input.cc,
        input.bcc,
        input.sender,
        input.recipient,
        input.recipients,
      ];
      objectValues.forEach((item) => visit(item));
      return;
    }

    const raw = String(input || "");
    const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    matches.forEach((email) => {
      const normalized = normalizeEmail(email);
      if (normalized) set.add(normalized);
    });
  };

  visit(value);
  return Array.from(set);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeInboundAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 10)
    .map((item, idx) => {
      const name = sanitizeMailText(
        item?.name || item?.filename || item?.fileName || `attachment_${idx + 1}`,
        160
      );
      const contentType = sanitizeMailText(item?.contentType || item?.type || "", 120);
      const size = Number(item?.size || item?.length || 0);
      return {
        name,
        contentType,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      };
    })
    .filter(Boolean);
}

function sanitizeMailText(value, maxLen = 12000) {
  return String(value || "").replace(/\u0000/g, "").slice(0, maxLen);
}

function isValidEmailAddress(value) {
  const email = normalizeEmail(value);
  if (!email) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email);
}

function randomNumericOtp(length = 6) {
  const size = Number(length) > 0 ? Number(length) : 6;
  const max = 10 ** size;
  const num = Math.floor(Math.random() * max);
  return String(num).padStart(size, "0");
}

function hashPasswordResetOtp({ email, otp, nonce, secret }) {
  const payload = `${normalizeEmail(email)}|${String(otp || "").trim()}|${String(nonce || "").trim()}`;
  return crypto
    .createHmac("sha256", String(secret || ""))
    .update(payload)
    .digest("hex");
}

function safeCompareHex(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function verifyMailgunSignature({ timestamp, token, signature, signingKey }) {
  const ts = String(timestamp || "").trim();
  const tk = String(token || "").trim();
  const sig = String(signature || "").trim();
  const key = String(signingKey || "").trim();
  if (!ts || !tk || !sig || !key) return false;

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${ts}${tk}`)
    .digest("hex");

  return safeCompareHex(sig, expected);
}

function isFreshMailgunTimestamp(timestamp, toleranceSec = 15 * 60) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - ts) <= toleranceSec;
}

function sanitizeMailAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 10)
    .map((item) => {
      const name = sanitizeMailText(item?.name || "attachment", 160);
      const url = String(item?.url || "").trim();
      const path = String(item?.path || "").trim();
      const contentType = sanitizeMailText(item?.contentType || item?.type || "", 120);
      const size = Number(item?.size || 0);
      if (!url) return null;
      return {
        name,
        url,
        path,
        contentType,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      };
    })
    .filter(Boolean);
}

function normalizeWhatsappPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  // India-first normalization: 10-digit local -> 91XXXXXXXXXX
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  // Fallback for already international formats without +
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return "";
}

function pickUserOfficePhone(user = {}) {
  return String(
    user.officePhone ||
    user.officepohone || // legacy typo in some docs
    user.office_phone ||
    user.phone ||
    user.personalPhone ||
    ""
  ).trim();
}

async function resolveNotificationUsers(n = {}) {
  let users = [];
  const targetUid = String(n.toUserId || n.toUid || "").trim();
  const targetEmail = String(n.toEmail || "").trim();

  if (targetUid) {
    const u = await db.collection("Users").doc(targetUid).get();
    if (u.exists) users = [{ id: u.id, ...(u.data() || {}) }];
    return users;
  }

  if (targetEmail) {
    const snap = await db.collection("Users").where("email", "==", targetEmail).limit(1).get();
    if (!snap.empty) {
      users = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    }
    return users;
  }

  if (n.toRole) {
    return getUsersByRoleLoose(String(n.toRole));
  }

  if (Array.isArray(n.toEmails) && n.toEmails.length) {
    const emailUsers = [];
    for (const rawEmail of n.toEmails) {
      const email = String(rawEmail || "").trim();
      if (!email) continue;
      const snap = await db.collection("Users").where("email", "==", email).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0];
        emailUsers.push({ id: d.id, ...(d.data() || {}) });
      }
    }
    return emailUsers;
  }

  return users;
}

async function sendWhatsAppCloudMessage({ to, text }) {
  const token = String(WHATSAPP_ACCESS_TOKEN.value() || "").trim();
  const phoneNumberId = String(WHATSAPP_PHONE_NUMBER_ID.value() || "").trim();
  if (!token || !phoneNumberId) {
    return { ok: false, skipped: true, reason: "missing_whatsapp_config" };
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  let parsed = null;
  try {
    parsed = await resp.json();
  } catch {
    parsed = null;
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      error: parsed?.error?.message || "whatsapp_send_failed",
      raw: parsed,
    };
  }

  return { ok: true, data: parsed };
}

function pickCanonicalDealId(data = {}) {
  const kpi = String(data?.kpiId || "").trim();
  const auto = String(data?.autoId || "").trim();
  const legacy = String(data?.kpid || "").trim();
  return kpi || auto || legacy || "";
}

function isCanonicalDealDoc(dealId, data = {}) {
  const canonical = pickCanonicalDealId(data);
  if (!canonical) return true;
  return canonical === String(dealId || "").trim();
}

function hasSiteVisitArranged(data = {}) {
  const raw = data?.siteVisitArrangedDate ?? data?.siteVisitDate ?? data?.siteVisitArranged;
  if (raw === true) return true;
  if (raw === false || raw === null || typeof raw === "undefined") return false;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return false;
  if (["no", "n", "false", "0", "na", "n/a", "none", "null"].includes(normalized)) return false;
  return true;
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

    // 🔥 KPI/AUTO-ID MUST MATCH DOCUMENT ID
    const canonical = pickCanonicalDealId(data);
    if (canonical && canonical !== dealId) {
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
if (!deal || !isCanonicalDealDoc(dealId, deal)) {
  console.log("⛔ Skipping mail for invalid deal:", dealId);
  return;
}

    if (!hasSiteVisitArranged(deal)) {
      console.log("⏭️ Skipping consultant info mail (site visit not arranged):", dealId);
      return;
    }

    if (isBulkImportRecord(deal)) {
      console.log("⏭️ Skipping consultant mail for bulk-import deal:", dealId);
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

    // ✅ Only allow for lead -> deal creation moment.
    // Do not trigger for consultant assigned later from deals screen.
    if (before) return;

    if (isBulkImportRecord(after) || isBulkImportRecord(before)) {
      console.log("⏭️ Skipping assignment mail for bulk-import deal:", event.params.dealId);
      return;
    }

    if (!hasSiteVisitArranged(after)) {
      console.log("⏭️ Skipping assignment mail (site visit not arranged):", event.params.dealId);
      return;
    }

    const newConsultant = after.assignedConsultant || "";
    if (!newConsultant) return;

    const canonicalDealId = pickCanonicalDealId(after) || event.params.dealId;
    if (canonicalDealId !== event.params.dealId) {
      console.log("⏭️ Skipping assignment mail for non-canonical deal doc:", event.params.dealId, "→", canonicalDealId);
      return;
    }

    // Token
    const token = Math.random().toString(36).substring(2) + Date.now();
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    await db.collection("deals").doc(canonicalDealId).update({
      siteSurveyToken: token,
      siteSurveyActive: true,
      siteSurveyExpiresAt: expires.toISOString(),
    });

    const dealId = canonicalDealId;

    const link = `https://crm.kapilpower.com/#/site-survey/start/${dealId}/${token}`;

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
     `https://crm.kapilpower.com/#/site-survey/start/${dealId}/${token}`;

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
      const surveyReportUrl = `https://crm.kapilpower.com/#/survey-report/${dealId}`;

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
        siteSurveyStatus: "completed",
        siteSurveyCompletedAt: new Date().toISOString(),
        siteSurveyActive: false,
        siteSurveyLink: surveyReportUrl,
      });

      if (attachments && attachments.length > 0) {
        const batch = db.batch();
        attachments.forEach((file) => {
          const ref = dealRef.collection("attachments").doc();
          const ext = String(file.fileName || file.name || "")
            .split(".")
            .pop()
            .toLowerCase();
          const isVideo = ["mp4", "mov", "avi", "mkv", "webm", "3gp", "m4v"].includes(ext);
          batch.set(ref, {
            name: file.label || "Survey File",
            fileName: file.fileName,
            url: file.url,
            uploadedAt: new Date().toISOString(),
            type: isVideo ? "siteSurveyVideo" : "siteSurveyImage",
            category: "Site Survey Documents",
            folderName: "Site Survey Documents",
            source: "siteSurvey",
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
    category: "Site Survey Documents",
    folderName: "Site Survey Documents",
    url: surveyReportUrl,
    source: "siteSurvey",
    formData: formData || {},
    createdAt: FieldValue.serverTimestamp()
  });

await dealRef
  .collection("attachments")
  .doc("siteSurveyFormPrint")
  .set({
    type: "siteSurveyPrint",
    title: "Site Survey Form Print",
    category: "Site Survey Documents",
    folderName: "Site Survey Documents",
    url: surveyReportUrl,
    source: "siteSurvey",
    formData: formData || {},
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });

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

      const surveyReportUrl = `https://crm.kapilpower.com/#/survey-report/${dealId}`;

      // Save Site Survey Link in Deals
await db.collection("deals").doc(dealId).update({
  siteSurveyLink: surveyReportUrl
});

console.log("✔ Site survey link stored in deal");

      const attachmentBatch = db.batch();
      const attachmentsCol = db.collection("deals").doc(dealId).collection("attachments");

      attachmentBatch.set(
        attachmentsCol.doc("siteSurveyReport"),
        {
          type: "siteSurvey",
          title: "Site Survey Report",
          category: "Site Survey Documents",
          folderName: "Site Survey Documents",
          url: surveyReportUrl,
          source: "siteSurvey",
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      attachmentBatch.set(
        attachmentsCol.doc("siteSurveyFormPrint"),
        {
          type: "siteSurveyPrint",
          title: "Site Survey Form Print",
          category: "Site Survey Documents",
          folderName: "Site Survey Documents",
          url: surveyReportUrl,
          source: "siteSurvey",
          formData: after.siteSurveyForm || after.siteSurveyData || {},
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const surveyFiles = after?.siteSurveyFiles && typeof after.siteSurveyFiles === "object"
        ? after.siteSurveyFiles
        : {};

      const toReadableLabel = (key) => String(key || "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase());

      Object.entries(surveyFiles).forEach(([key, url]) => {
        const cleanUrl = String(url || "").trim();
        if (!cleanUrl) return;
        const lower = cleanUrl.toLowerCase();
        const isVideo = /\.(mp4|mov|avi|mkv|webm|3gp|m4v)(\?|$)/i.test(lower);

        attachmentBatch.set(
          attachmentsCol.doc(`siteSurveyDoc_${String(key || "file").replace(/[^a-zA-Z0-9_-]/g, "_")}`),
          {
            type: isVideo ? "siteSurveyVideo" : "siteSurveyImage",
            title: toReadableLabel(key),
            name: toReadableLabel(key),
            key,
            category: "Site Survey Documents",
            folderName: "Site Survey Documents",
            url: cleanUrl,
            source: "siteSurvey",
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      await attachmentBatch.commit();


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
      <a href="https://crm.kapilpower.com/#/survey-report/${dealId}">
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
// ============================================================
// 📅 ATTENDANCE READ APIs (FOR iOS / WebView SAFE)
// ============================================================

export const getAttendanceToday = onRequest(
  { cors: true, region: "asia-south1" },
  async (req, res) => {
    try {
      const uid = resolveUid(req);

      if (!uid) {
        return res.status(400).send({ error: "Missing uid" });
      }

      const today = new Date().toISOString().split("T")[0];
      const cacheKey = `${uid}_${today}`;
      const cached = getCacheEntry(attendanceTodayCache, cacheKey);
      if (cached !== null) {
        res.set("Cache-Control", "private, max-age=15");
        return res.send(cached);
      }

      const doc = await db
        .collection("attendance")
        .doc(`${uid}_${today}`)
        .get();
      const payload = doc.exists ? doc.data() : null;
      setCacheEntry(attendanceTodayCache, cacheKey, payload, 15 * 1000);
      res.set("Cache-Control", "private, max-age=15");
      return res.send(payload);
    } catch (e) {
      console.error("getAttendanceToday error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

export const getAttendanceRange = onRequest(
  { cors: true, region: "asia-south1" },
  async (req, res) => {
    try {
      const { from, to } = req.query;
      const uid = req.query.uid || req.headers.uid || req.headers["x-user-id"];

      if (!from || !to) {
        return res.status(400).send({ error: "Missing from/to" });
      }

      const cacheKey = `${uid || "all"}|${from}|${to}`;
      const cached = getCacheEntry(attendanceRangeCache, cacheKey);
      if (cached !== null) {
        res.set("Cache-Control", "private, max-age=30");
        return res.send(cached);
      }

      let ref = db
        .collection("attendance")
        .where("date", ">=", from)
        .where("date", "<=", to);

      if (uid) {
        ref = ref.where("userId", "==", String(uid));
      }

      const snap = await ref.get();

      const rows = snap.docs.map((d) => d.data());
      setCacheEntry(attendanceRangeCache, cacheKey, rows, 30 * 1000);
      res.set("Cache-Control", "private, max-age=30");
      return res.send(rows);
    } catch (e) {
      console.error("getAttendanceRange error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

export const getHolidays = onRequest(
  { cors: true, region: "asia-south1" },
  async (_, res) => {
    try {
      const cached = getObjectCache(holidaysCache);
      if (cached) {
        res.set("Cache-Control", "private, max-age=300");
        return res.send(cached);
      }
      const snap = await db.collection("holidays").get();
      const payload = snap.docs.map((d) => d.data());
      setObjectCache(holidaysCache, payload, 5 * 60 * 1000);
      res.set("Cache-Control", "private, max-age=300");
      return res.send(payload);
    } catch (e) {
      console.error("getHolidays error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

export const getWorkingDays = onRequest(
  { cors: true, region: "asia-south1" },
  async (_, res) => {
    try {
      const cached = getObjectCache(workingDaysCache);
      if (cached) {
        res.set("Cache-Control", "private, max-age=300");
        return res.send(cached);
      }
      const snap = await db
        .collection("attendance_workingDays")
        .get();
      const payload = snap.docs.map((d) => d.data());
      setObjectCache(workingDaysCache, payload, 5 * 60 * 1000);
      res.set("Cache-Control", "private, max-age=300");
      return res.send(payload);
    } catch (e) {
      console.error("getWorkingDays error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

// ============================================================
// 📊 CRM LIST API (AUTH + CACHE)
// ============================================================
export const getCrmList = onRequest(
  { cors: true, region: "asia-south1" },
  async (req, res) => {
    try {
      await requireAuth(req);
      const module = String(req.query.module || "").trim();
      const limit = Math.min(Number(req.query.limit || 25), 50);

      const allowed = new Set(["leads", "deals", "salesOrders", "projects"]);
      if (!allowed.has(module)) {
        return res.status(400).send({ error: "Invalid module" });
      }

      const cacheKey = `${module}|${limit}`;
      const cached = getCacheEntry(crmListCache, cacheKey);
      if (cached !== null) {
        res.set("Cache-Control", "private, max-age=20");
        return res.send(cached);
      }

      const snap = await db
        .collection(module)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCacheEntry(crmListCache, cacheKey, rows, 20 * 1000);
      res.set("Cache-Control", "private, max-age=20");
      return res.send(rows);
    } catch (e) {
      const msg = String(e?.message || e || "error");
      if (msg.toLowerCase().includes("auth")) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      console.error("getCrmList error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

// ============================================================
// 🧪 LOADTEST WRITE APIs (AUTH)
// ============================================================
export const loadtestAttendanceCheckIn = onRequest(
  { cors: true, region: "asia-south1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });
      const decoded = await requireAuth(req);

      const body = req.body || {};
      const uid = String(body.uid || decoded?.uid || "").trim();
      if (!uid) return res.status(400).send({ error: "Missing uid" });

      const date = String(body.date || new Date().toISOString().slice(0, 10)).trim();
      const docId = String(body.docId || `${uid}_${date}`).trim();
      const collectionName = getLoadtestCollection(body.collection, "attendance_loadtest");

      await db.collection(collectionName).doc(docId).set(
        {
          userId: uid,
          date,
          status: "present",
          checkIn: FieldValue.serverTimestamp(),
          _loadtest: true,
        },
        { merge: true }
      );

      return res.send({ ok: true, id: docId, collection: collectionName });
    } catch (e) {
      const msg = String(e?.message || e || "error");
      if (msg.toLowerCase().includes("auth")) return res.status(401).send({ error: "Unauthorized" });
      console.error("loadtestAttendanceCheckIn error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

export const loadtestAttendanceCheckOut = onRequest(
  { cors: true, region: "asia-south1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });
      const decoded = await requireAuth(req);

      const body = req.body || {};
      const uid = String(body.uid || decoded?.uid || "").trim();
      if (!uid) return res.status(400).send({ error: "Missing uid" });

      const date = String(body.date || new Date().toISOString().slice(0, 10)).trim();
      const docId = String(body.docId || `${uid}_${date}`).trim();
      const collectionName = getLoadtestCollection(body.collection, "attendance_loadtest");

      await db.collection(collectionName).doc(docId).set(
        {
          userId: uid,
          date,
          checkOut: FieldValue.serverTimestamp(),
          _loadtest: true,
        },
        { merge: true }
      );

      return res.send({ ok: true, id: docId, collection: collectionName });
    } catch (e) {
      const msg = String(e?.message || e || "error");
      if (msg.toLowerCase().includes("auth")) return res.status(401).send({ error: "Unauthorized" });
      console.error("loadtestAttendanceCheckOut error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

export const loadtestCrmUpdate = onRequest(
  { cors: true, region: "asia-south1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });
      const decoded = await requireAuth(req);

      const body = req.body || {};
      const collectionName = getLoadtestCollection(body.collection, "crm_loadtest");
      const docId = String(body.docId || `loadtest_${decoded?.uid || "anon"}`).trim();
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

      await db.collection(collectionName).doc(docId).set(
        {
          ...payload,
          updatedAt: FieldValue.serverTimestamp(),
          _loadtest: true,
        },
        { merge: true }
      );

      return res.send({ ok: true, id: docId, collection: collectionName });
    } catch (e) {
      const msg = String(e?.message || e || "error");
      if (msg.toLowerCase().includes("auth")) return res.status(401).send({ error: "Unauthorized" });
      console.error("loadtestCrmUpdate error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

// ============================================================
// 🔔 CREATE NOTIFICATION — HTTP (CORS SAFE)
// ============================================================
export const createNotification = onRequest(
  { region: "asia-south1" },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).send({ error: "Method not allowed" });
      }

      try {
        const {
          dealId,
          type,
          toRole,
          toEmails,
          subject,
          body,
          notifyAt,
          active,
          assignedTo,
        } = req.body || {};

        if (!dealId) {
          return res.status(400).send({ error: "dealId is required" });
        }

        const payload = {
          dealId,
          type: type || "update",
          toRole: toRole || null,
          toEmails: Array.isArray(toEmails)
            ? toEmails
            : toEmails
              ? [toEmails]
              : [],
          subject: subject || "CRM Notification",
          body: body || "You have an update",
          notifyAt: notifyAt || null,
          active: active !== false,
          assignedTo: assignedTo || "",
          createdAt: FieldValue.serverTimestamp(),
        };

        const ref = await db.collection("notifications").add(payload);

        return res.send({ ok: true, id: ref.id });
      } catch (e) {
        console.error("createNotification error", e);
        return res.status(500).send({ error: "Server error" });
      }
    });
  }
);

// ============================================================
// 🔐 FORGOT PASSWORD — REQUEST OTP
// Sends OTP request to admin email and stores secure hashed OTP in Firestore.
// ============================================================
export const passwordForgotRequest = onRequest(
  { region: "asia-south1", secrets: [SMTP_USER, SMTP_PASS, PASSWORD_OTP_SECRET] },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

      try {
        const email = normalizeEmail(req.body?.email || "");
        if (!isValidEmailAddress(email)) {
          return res.status(400).send({ error: "Please enter a valid email" });
        }

        const otpSecret = String(PASSWORD_OTP_SECRET.value() || "").trim();
        if (!otpSecret) {
          return res.status(503).send({ error: "OTP secret is not configured" });
        }

        const genericOk = {
          ok: true,
          message: "If this email is registered, OTP request has been sent to admin.",
        };

        const usersByEmail = await getUsersByEmails([email]);
        const appUser = usersByEmail.get(email) || null;
        let authUser = null;
        try {
          authUser = await getAuth().getUserByEmail(email);
        } catch {
          authUser = null;
        }

        if (!authUser && !appUser) {
          return res.send(genericOk);
        }

        const now = Date.now();
        const limiterSnap = await db
          .collection("password_reset_otps")
          .where("email", "==", email)
          .limit(30)
          .get();

        const recentOtpCount = limiterSnap.docs
          .map((docSnap) => Number(docSnap.data()?.createdAtMs || 0))
          .filter((createdAtMs) => createdAtMs >= now - (15 * 60 * 1000))
          .length;

        if (recentOtpCount >= 3) {
          return res.status(429).send({ error: "Too many OTP requests. Please wait 15 minutes." });
        }

        const otp = randomNumericOtp(6);
        const nonce = crypto.randomBytes(12).toString("hex");
        const otpHash = hashPasswordResetOtp({ email, otp, nonce, secret: otpSecret });
        const expiresAtMs = now + (10 * 60 * 1000);
        const otpRef = db.collection("password_reset_otps").doc();
        const userUid = String(authUser?.uid || appUser?.uid || "").trim() || null;
        const adminEmail = "loan@kapilpower.com";

        await otpRef.set({
          id: otpRef.id,
          email,
          userUid,
          otpHash,
          nonce,
          purpose: "forgot_password",
          attempts: 0,
          maxAttempts: 6,
          used: false,
          expiresAtMs,
          createdAtMs: now,
          createdAt: FieldValue.serverTimestamp(),
          deliveryStatus: "pending",
        });

        const expiresAtText = new Date(expiresAtMs).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        });

        try {
          const transporter = getTransporter({ mirrorInternal: false });
          await transporter.sendMail({
            from: `"Kapil Power CRM" <${SMTP_USER.value()}>`,
            to: adminEmail,
            subject: "Password reset OTP request (Admin Action Required)",
            text: `User Email: ${email}\nUser UID: ${userUid || "N/A"}\nOTP: ${otp}\nExpires: ${expiresAtText}\n\nShare OTP only after validating the user.`,
            html: `
              <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6">
                <h2 style="margin:0 0 8px;color:#6f0f29">Password reset OTP request</h2>
                <p>Admin OTP request received for user:</p>
                <p><b>Email:</b> ${email}</p>
                <p><b>UID:</b> ${userUid || "N/A"}</p>
                <p><b>OTP to share:</b></p>
                <p style="font-size:24px;font-weight:800;letter-spacing:3px;margin:10px 0">${otp}</p>
                <p><b>Expires:</b> ${expiresAtText}</p>
                <p style="margin-top:14px">Share this OTP with user only after manual verification.</p>
              </div>
            `,
          });

          await otpRef.set({
            deliveryStatus: "sent",
            sentAt: FieldValue.serverTimestamp(),
            deliveredTo: adminEmail,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (mailErr) {
          await otpRef.set({
            deliveryStatus: "failed",
            deliveryError: String(mailErr?.message || "smtp_send_failed").slice(0, 500),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return res.status(502).send({ error: "Unable to send OTP right now. Please try again." });
        }

        return res.send(genericOk);
      } catch (e) {
        logger.error("passwordForgotRequest failed", e);
        return res.status(500).send({ error: "Server error" });
      }
    });
  }
);

// ============================================================
// 🔐 FORGOT PASSWORD — VERIFY OTP + RESET PASSWORD
// ============================================================
export const passwordForgotReset = onRequest(
  { region: "asia-south1", secrets: [PASSWORD_OTP_SECRET] },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

      try {
        const email = normalizeEmail(req.body?.email || "");
        const otp = String(req.body?.otp || "").trim();
        const newPassword = String(req.body?.newPassword || "");

        if (!isValidEmailAddress(email)) {
          return res.status(400).send({ error: "Please enter a valid email" });
        }
        if (!/^\d{6}$/.test(otp)) {
          return res.status(400).send({ error: "OTP must be 6 digits" });
        }
        if (newPassword.length < 6) {
          return res.status(400).send({ error: "Password must be at least 6 characters" });
        }

        const otpSecret = String(PASSWORD_OTP_SECRET.value() || "").trim();
        if (!otpSecret) {
          return res.status(503).send({ error: "OTP secret is not configured" });
        }

        const snap = await db
          .collection("password_reset_otps")
          .where("email", "==", email)
          .limit(50)
          .get();

        const now = Date.now();
        const activeDocs = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, ...(docSnap.data() || {}) }))
          .filter((row) => row.purpose === "forgot_password" && row.used !== true)
          .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

        if (!activeDocs.length) {
          return res.status(400).send({ error: "Invalid or expired OTP" });
        }

        let matched = null;
        for (const row of activeDocs) {
          const expiresAtMs = Number(row.expiresAtMs || 0);
          if (!expiresAtMs || expiresAtMs < now) continue;

          const maxAttempts = Number(row.maxAttempts || 6);
          const attempts = Number(row.attempts || 0);
          if (attempts >= maxAttempts) continue;

          const expectedHash = hashPasswordResetOtp({
            email,
            otp,
            nonce: row.nonce || "",
            secret: otpSecret,
          });

          if (safeCompareHex(expectedHash, row.otpHash || "")) {
            matched = row;
            break;
          }
        }

        if (!matched) {
          const latest = activeDocs[0];
          if (latest?.ref) {
            await latest.ref.set({
              attempts: Number(latest.attempts || 0) + 1,
              updatedAt: FieldValue.serverTimestamp(),
              lastFailedAttemptAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
          return res.status(400).send({ error: "Invalid or expired OTP" });
        }

        const targetUid = String(matched.userUid || "").trim();
        if (targetUid) {
          await getAuth().updateUser(targetUid, { password: newPassword });
        } else {
          const userRecord = await getAuth().getUserByEmail(email);
          await getAuth().updateUser(userRecord.uid, { password: newPassword });
        }

        const batch = db.batch();
        batch.set(matched.ref, {
          used: true,
          usedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        activeDocs.forEach((row) => {
          if (row.id === matched.id) return;
          batch.set(row.ref, {
            revoked: true,
            revokedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });

        await batch.commit();

        return res.send({ ok: true, message: "Password reset successful" });
      } catch (e) {
        logger.error("passwordForgotReset failed", e);
        return res.status(500).send({ error: "Server error" });
      }
    });
  }
);

// ============================================================
// 📬 MAIL SEND — HTTP (AUTH + CORS SAFE)
// Writes sender copy to Sent and recipient copies to Inbox.
// ============================================================
export const mailSend = onRequest(
  { region: "asia-south1", secrets: [SMTP_USER, SMTP_PASS] },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

      try {
        const decoded = await requireAuth(req);
        const senderUid = String(decoded?.uid || "").trim();
        const senderEmail = normalizeEmail(decoded?.email || "");

        if (!senderUid) return res.status(401).send({ error: "Unauthorized" });

        const toEmails = parseEmailInput(req.body?.toEmails || req.body?.to || "").slice(0, 50);
        const ccEmails = parseEmailInput(req.body?.ccEmails || req.body?.cc || "").slice(0, 50);
        const bccEmails = parseEmailInput(req.body?.bccEmails || req.body?.bcc || "").slice(0, 50);

        if (!toEmails.length) {
          return res.status(400).send({ error: "At least one recipient is required" });
        }

        const subject = sanitizeMailText(req.body?.subject || "", 250);
        const body = sanitizeMailText(req.body?.body || "", 40000);
        const bodyHtml = sanitizeMailText(req.body?.bodyHtml || "", 120000);
        const attachments = sanitizeMailAttachments(req.body?.attachments || []);
        const preview = stripHtml(bodyHtml || body).replace(/\s+/g, " ").trim().slice(0, 180);

        const senderSnap = await db.collection("Users").doc(senderUid).get();
        const senderData = senderSnap.exists ? (senderSnap.data() || {}) : {};
        const senderName = String(
          senderData.Name || senderData.name || senderData.displayName || decoded?.name || "User"
        ).trim();
        const senderProfileEmail = normalizeEmail(senderData.email || senderData.Email || "");
        const senderEffectiveEmail = senderEmail || senderProfileEmail;

        const allRecipientEmails = Array.from(new Set([
          ...toEmails,
          ...ccEmails,
          ...bccEmails,
        ].map((x) => normalizeEmail(x)).filter(Boolean)));

        const userByEmail = await getUsersByEmails(allRecipientEmails);

        const recipientUsers = allRecipientEmails
          .map((email) => userByEmail.get(email))
          .filter(Boolean)
          .slice(0, 100);

        const shouldDeliverSelfInbox = !!senderEffectiveEmail && allRecipientEmails.includes(senderEffectiveEmail);
        if (shouldDeliverSelfInbox && !recipientUsers.some((u) => String(u.uid || "").trim() === senderUid)) {
          recipientUsers.push({
            uid: senderUid,
            email: senderEffectiveEmail,
            Name: senderName,
            name: senderName,
          });
        }

        const recipientUids = Array.from(new Set(
          recipientUsers
            .map((u) => String(u.uid || u.id || u.docId || "").trim())
            .filter(Boolean)
        ));
        const internalRecipientEmails = Array.from(new Set(recipientUsers.map((u) => normalizeEmail(u.email)).filter(Boolean)));
  const externalRecipientEmails = allRecipientEmails.filter((email) => !internalRecipientEmails.includes(email));

        const mailId = db.collection("mail_meta").doc().id;
        const ts = FieldValue.serverTimestamp();

        const senderDocRef = db
          .collection("mailboxes")
          .doc(senderUid)
          .collection("messages")
          .doc(mailId);

        const batch = db.batch();

        batch.set(senderDocRef, {
          id: mailId,
          ownerUid: senderUid,
          folder: "sent",
          fromUid: senderUid,
          fromEmail: senderEmail,
          fromName: senderName,
          toEmails,
          toUids: recipientUids,
          ccEmails,
          bccEmails,
          externalToEmails: externalRecipientEmails,
          subject,
          body,
          bodyHtml,
          attachments,
          preview,
          isRead: true,
          isStarred: false,
          createdAt: ts,
          sentAt: ts,
          updatedAt: ts,
          kind: "mail",
        });

        let deliveredInternalCount = 0;

        recipientUsers.forEach((recipient) => {
          const recipientUid = String(recipient.uid || recipient.id || recipient.docId || "").trim();
          if (!recipientUid) return;

          const recipientDocId = recipientUid === senderUid
            ? `${mailId}_self_inbox`
            : mailId;

          const recipientRef = db
            .collection("mailboxes")
            .doc(recipientUid)
            .collection("messages")
            .doc(recipientDocId);

          const recipientEmail = normalizeEmail(recipient.email || "");
          const recipientDeliveryType = bccEmails.includes(recipientEmail)
            ? "bcc"
            : ccEmails.includes(recipientEmail)
              ? "cc"
              : toEmails.includes(recipientEmail)
                ? "to"
                : "to";

          batch.set(recipientRef, {
            id: recipientDocId,
            sourceMailId: mailId,
            ownerUid: recipientUid,
            folder: "inbox",
            fromUid: senderUid,
            fromEmail: senderEmail,
            fromName: senderName,
            toEmails,
            toUids: recipientUids,
            ccEmails,
            // Keep BCC private from all recipients. Sender copy still retains full BCC.
            bccEmails: [],
            deliveryType: recipientDeliveryType,
            subject,
            body,
            bodyHtml,
            attachments,
            preview,
            isRead: false,
            isStarred: false,
            createdAt: ts,
            sentAt: ts,
            updatedAt: ts,
            kind: "mail",
          });

          deliveredInternalCount += 1;
        });

        await batch.commit();
        let smtpDelivered = false;
        let smtpError = "";
        let smtpRejected = [];
        let smtpAccepted = [];

        try {
          const smtpMailbox = normalizeEmail(SMTP_USER.value() || "");
          const replyToAddress = buildReplyAlias(smtpMailbox, senderUid) || smtpMailbox;
          const smtpRecipients = Array.from(new Set([
            ...toEmails,
            ...ccEmails,
            ...bccEmails,
          ].map((x) => normalizeEmail(x)).filter(Boolean)));

          // `mailSend` already writes recipient inbox docs directly.
          // Keep transporter mirror OFF here to avoid duplicate internal mails.
          const transporter = getTransporter({ mirrorInternal: false });
          const basePayload = {
            from: `${senderName || "Kapil CRM"} <${SMTP_USER.value()}>`,
            to: toEmails.join(", "),
            cc: ccEmails.length ? ccEmails.join(", ") : undefined,
            bcc: bccEmails.length ? bccEmails.join(", ") : undefined,
            replyTo: replyToAddress || undefined,
            subject: subject || "(No Subject)",
            text: body || stripHtml(bodyHtml || "") || "",
            html: bodyHtml || undefined,
            attachments: attachments.map((file) => ({
              filename: file.name || "attachment",
              path: file.url,
              contentType: file.contentType || undefined,
            })),
          };

          const smtpInfo = await transporter.sendMail({
            ...basePayload,
            envelope: {
              from: SMTP_USER.value(),
              to: smtpRecipients,
            },
          });

          const acceptedSet = new Set(extractEmailsLoose(smtpInfo?.accepted || []));
          const rejectedSet = new Set(extractEmailsLoose(smtpInfo?.rejected || []));

          const missingRecipients = smtpRecipients.filter((email) => !acceptedSet.has(email));

          for (const recipientEmail of missingRecipients) {
            try {
              const retryInfo = await transporter.sendMail({
                ...basePayload,
                // one-by-one fallback for providers that may not deliver some CC/external
                // recipients from mixed recipient envelopes.
                envelope: {
                  from: SMTP_USER.value(),
                  to: [recipientEmail],
                },
                // keep BCC hidden in fallback retries too.
                bcc: undefined,
              });

              const retryAccepted = extractEmailsLoose(retryInfo?.accepted || []);
              if (retryAccepted.includes(recipientEmail)) {
                acceptedSet.add(recipientEmail);
                rejectedSet.delete(recipientEmail);
              } else {
                rejectedSet.add(recipientEmail);
              }
            } catch {
              rejectedSet.add(recipientEmail);
            }
          }

          smtpAccepted = Array.from(acceptedSet);
          smtpRejected = Array.from(rejectedSet);
          smtpDelivered = smtpRecipients.length > 0 && smtpRejected.length === 0;
          if (!smtpDelivered) {
            smtpError = `smtp_partial_or_failed_delivery: ${smtpRejected.join(", ") || "unknown"}`;
          }

        } catch (smtpErr) {
          smtpDelivered = false;
          const responseText = String(smtpErr?.response || "").trim();
          smtpError = responseText || smtpErr?.message || "smtp_send_failed";
          smtpRejected = Array.isArray(smtpErr?.rejected)
            ? smtpErr.rejected.map((email) => normalizeEmail(email)).filter(Boolean)
            : [];
          smtpAccepted = [];
          console.error("mailSend smtp error", smtpErr);
        }

        await senderDocRef.set(
          {
            smtpDelivered,
            smtpAccepted,
            smtpRejected,
            smtpError: smtpError || null,
            smtpUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        await db.collection("mail_outbox").doc(mailId).set({
          id: mailId,
          senderUid,
          senderEmail: senderEmail || senderEffectiveEmail || "",
          senderName,
          toEmails,
          ccEmails,
          bccEmails,
          subject,
          body,
          bodyHtml,
          attachments,
          status: smtpDelivered ? "sent" : "failed",
          attempts: 1,
          smtpDelivered,
          smtpAccepted,
          smtpRejected,
          lastError: smtpError || null,
          queuedAt: FieldValue.serverTimestamp(),
          sentAt: smtpDelivered ? FieldValue.serverTimestamp() : null,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return res.send({
          ok: true,
          id: mailId,
          deliveredInternalCount,
          externalRecipientCount: externalRecipientEmails.length,
          smtpQueued: false,
          smtpDelivered,
          smtpAccepted,
          smtpRejected,
          smtpError: smtpError || null,
        });
      } catch (e) {
        console.error("mailSend error", e);
        return res.status(500).send({ error: e?.message || "Server error" });
      }
    });
  }
);

// ============================================================
// 📤 MAIL OUTBOX DISPATCHER — background SMTP sender
// Keeps HTTP mailSend fast while SMTP runs asynchronously.
// ============================================================
export const mailOutboxDispatcher = onDocumentCreated(
  { document: "mail_outbox/{mailId}", region: "asia-south1", secrets: [SMTP_USER, SMTP_PASS] },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;

    const payload = snap.data() || {};
    const status = String(payload.status || "queued").trim().toLowerCase();
    if (status !== "queued") return;

    const mailId = String(payload.id || event.params.mailId || "").trim();
    const senderUid = String(payload.senderUid || "").trim();
    const senderName = String(payload.senderName || "Kapil CRM").trim();
    const toEmails = parseEmailInput(payload.toEmails || []).slice(0, 50);
    const ccEmails = parseEmailInput(payload.ccEmails || []).slice(0, 50);
    const bccEmails = parseEmailInput(payload.bccEmails || []).slice(0, 50);
    const subject = sanitizeMailText(payload.subject || "", 250);
    const body = sanitizeMailText(payload.body || "", 40000);
    const bodyHtml = sanitizeMailText(payload.bodyHtml || "", 120000);
    const attachments = sanitizeMailAttachments(payload.attachments || []);

    if (!mailId || !senderUid || !toEmails.length) {
      await snap.ref.set(
        {
          status: "failed",
          lastError: "invalid_outbox_payload",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    let smtpDelivered = false;
    let smtpError = "";
    let smtpRejected = [];
    const smtpRecipients = Array.from(new Set([
      ...toEmails,
      ...ccEmails,
      ...bccEmails,
    ].map((x) => normalizeEmail(x)).filter(Boolean)));

    try {
      const smtpMailbox = normalizeEmail(SMTP_USER.value() || "");
      const replyToAddress = buildReplyAlias(smtpMailbox, senderUid) || smtpMailbox;

      const transporter = getTransporter({ mirrorInternal: false });
      await transporter.sendMail({
        from: `${senderName || "Kapil CRM"} <${SMTP_USER.value()}>`,
        envelope: {
          from: SMTP_USER.value(),
          to: smtpRecipients,
        },
        to: toEmails.join(", "),
        cc: ccEmails.length ? ccEmails.join(", ") : undefined,
        bcc: bccEmails.length ? bccEmails.join(", ") : undefined,
        replyTo: replyToAddress || undefined,
        subject: subject || "(No Subject)",
        text: body || stripHtml(bodyHtml || "") || "",
        html: bodyHtml || undefined,
        attachments: attachments.map((file) => ({
          filename: file.name || "attachment",
          path: file.url,
          contentType: file.contentType || undefined,
        })),
      });
      smtpDelivered = true;
    } catch (smtpErr) {
      smtpDelivered = false;
      const responseText = String(smtpErr?.response || "").trim();
      smtpError = responseText || smtpErr?.message || "smtp_send_failed";
      smtpRejected = Array.isArray(smtpErr?.rejected)
        ? smtpErr.rejected.map((email) => normalizeEmail(email)).filter(Boolean)
        : [];
      console.error("mailOutboxDispatcher smtp error", smtpErr);
    }

    const senderMessageRef = db
      .collection("mailboxes")
      .doc(senderUid)
      .collection("messages")
      .doc(mailId);

    await senderMessageRef.set(
      {
        smtpDelivered,
        smtpRejected,
        smtpError: smtpError || null,
        smtpUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await snap.ref.set(
      {
        status: smtpDelivered ? "sent" : "failed",
        attempts: Number(payload.attempts || 0) + 1,
        smtpDelivered,
        smtpRejected,
        lastError: smtpError || null,
        sentAt: smtpDelivered ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

// ============================================================
// 📝 MAIL DRAFT SAVE — HTTP (AUTH + CORS SAFE)
// Upserts current user's draft in their mailbox.
// ============================================================
export const mailSaveDraft = onRequest(
  { region: "asia-south1" },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

      try {
        const decoded = await requireAuth(req);
        const senderUid = String(decoded?.uid || "").trim();
        const senderEmail = normalizeEmail(decoded?.email || "");
        if (!senderUid) return res.status(401).send({ error: "Unauthorized" });

        const draftIdRaw = String(req.body?.draftId || "").trim();
        const draftId = draftIdRaw || db.collection("mail_meta").doc().id;

        const toEmails = parseEmailInput(req.body?.toEmails || req.body?.to || "").slice(0, 50);
        const ccEmails = parseEmailInput(req.body?.ccEmails || req.body?.cc || "").slice(0, 50);
        const bccEmails = parseEmailInput(req.body?.bccEmails || req.body?.bcc || "").slice(0, 50);
        const subject = sanitizeMailText(req.body?.subject || "", 250);
        const body = sanitizeMailText(req.body?.body || "", 40000);
        const bodyHtml = sanitizeMailText(req.body?.bodyHtml || "", 120000);
        const attachments = sanitizeMailAttachments(req.body?.attachments || []);
        const preview = stripHtml(bodyHtml || body).replace(/\s+/g, " ").trim().slice(0, 180);

        const senderSnap = await db.collection("Users").doc(senderUid).get();
        const senderData = senderSnap.exists ? (senderSnap.data() || {}) : {};
        const senderName = String(
          senderData.Name || senderData.name || senderData.displayName || decoded?.name || "User"
        ).trim();

        const draftRef = db
          .collection("mailboxes")
          .doc(senderUid)
          .collection("messages")
          .doc(draftId);

        await draftRef.set(
          {
            id: draftId,
            ownerUid: senderUid,
            folder: "draft",
            fromUid: senderUid,
            fromEmail: senderEmail,
            fromName: senderName,
            toEmails,
            ccEmails,
            bccEmails,
            subject,
            body,
            bodyHtml,
            attachments,
            preview,
            isRead: true,
            isStarred: false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            kind: "mail",
          },
          { merge: true }
        );

        return res.send({ ok: true, id: draftId });
      } catch (e) {
        console.error("mailSaveDraft error", e);
        return res.status(500).send({ error: e?.message || "Server error" });
      }
    });
  }
);

// ============================================================
// 📅 MEETINGS — invite delivery on create
// ============================================================
export const notifyOnMeetingCreated = onDocumentCreated(
  "meetings/{meetingId}",
  async (event) => {
    try {
      const meetingId = String(event.params.meetingId || "").trim();
      const meeting = event.data?.data() || {};
      if (!meetingId || !meeting || meeting.active === false) return;

      const creatorRole = canonicalRole(meeting.createdByRole || "");
      if (creatorRole && !MEETING_CREATOR_ROLES.has(creatorRole)) {
        await db.collection("meetings").doc(meetingId).set({
          status: "blocked",
          blockedReason: "creator_role_not_allowed",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
      }

      const result = await dispatchMeetingInvites({ meetingId, meeting, mode: "invite" });
      await db.collection("meetings").doc(meetingId).set({
        recipientUids: result.recipientUids || [],
        recipientEmails: result.recipientEmails || [],
        inviteSentAt: FieldValue.serverTimestamp(),
        inviteDispatchState: "sent",
        reminderSentAt: meeting.reminderSentAt || null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      logger.error("notifyOnMeetingCreated failed", e);
      await notifyMeetingMaintenanceAlert({
        stage: "create_invite",
        meetingId: event.params.meetingId,
        errorMessage: e?.message || "notifyOnMeetingCreated_failed",
      });
    }
  }
);

// ============================================================
// 🔁 MEETINGS — manual resend invite on update
// ============================================================
export const notifyOnMeetingResendRequested = onDocumentUpdated(
  "meetings/{meetingId}",
  async (event) => {
    const meetingId = String(event.params.meetingId || "").trim();
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!meetingId || !after || after.active === false) return;

    const beforeResendAt = toMillisSafe(before.resendRequestedAt);
    const afterResendAt = toMillisSafe(after.resendRequestedAt);
    if (!afterResendAt || afterResendAt === beforeResendAt) return;

    try {
      await dispatchMeetingInvites({
        meetingId,
        meeting: after,
        mode: "resend",
        cycleKey: String(afterResendAt),
      });

      await db.collection("meetings").doc(meetingId).set({
        resendSentAt: FieldValue.serverTimestamp(),
        resendDispatchState: "sent",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      logger.error("notifyOnMeetingResendRequested failed", e);
      await db.collection("meetings").doc(meetingId).set({
        resendDispatchState: "failed",
        resendError: String(e?.message || "resend_failed").slice(0, 400),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await notifyMeetingMaintenanceAlert({
        stage: "resend_invite",
        meetingId,
        errorMessage: e?.message || "notifyOnMeetingResendRequested_failed",
      });
    }
  }
);

// ============================================================
// ⏰ MEETINGS — 1 hour reminder scheduler
// ============================================================
export const sendMeetingReminders = onSchedule(
  { schedule: "every 5 minutes", region: "asia-south1" },
  async () => {
    const now = Date.now();
    const minStart = now + (55 * 60 * 1000);
    const maxStart = now + (65 * 60 * 1000);

    try {
      const snap = await db.collection("meetings")
        .where("active", "==", true)
        .limit(800)
        .get();

      for (const d of snap.docs) {
        const meetingId = String(d.id || "").trim();
        const meeting = d.data() || {};
        if (!meetingId) continue;
        if (!isMeetingOperationalCandidate(meeting, now)) continue;

        const status = String(meeting.status || "scheduled").trim().toLowerCase();
        if (status !== "scheduled") continue;

        const startAtMillis = toMillisSafe(meeting.startAtMillis || meeting.startAt);
        if (!startAtMillis || startAtMillis < minStart || startAtMillis > maxStart) continue;

        const endAtMillis = toMillisSafe(meeting.endAtMillis || meeting.endAt);
        if (endAtMillis && endAtMillis <= now) continue;

        if (meeting.reminderSentAt) continue;

        await dispatchMeetingInvites({ meetingId, meeting, mode: "reminder" });
        await d.ref.set({
          reminderSentAt: FieldValue.serverTimestamp(),
          reminderDispatchState: "sent",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } catch (e) {
      logger.error("sendMeetingReminders failed", e);

      // Avoid noisy admin alerts when there is no true 1-hour reminder candidate.
      let shouldAlert = true;
      try {
        const probe = await db.collection("meetings")
          .where("active", "==", true)
          .limit(300)
          .get();

        shouldAlert = probe.docs.some((docSnap) => {
          const m = docSnap.data() || {};
          if (!isMeetingOperationalCandidate(m, now)) return false;
          if (String(m.status || "scheduled").trim().toLowerCase() !== "scheduled") return false;
          const startAtMillis = toMillisSafe(m.startAtMillis || m.startAt);
          return !!startAtMillis && startAtMillis >= minStart && startAtMillis <= maxStart;
        });
      } catch {
        shouldAlert = true;
      }

      if (!shouldAlert) return;

      await notifyMeetingMaintenanceAlert({
        stage: "reminder_dispatch",
        meetingId: "scheduler",
        errorMessage: e?.message || "sendMeetingReminders_failed",
      });
    }
  }
);

// ============================================================
// 🩺 MEETINGS — health monitor + admin alerts (reason codes)
// ============================================================
const fetchWithTimeout = async (url, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
      },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

export const monitorMeetingHealth = onSchedule(
  { schedule: "every 10 minutes", region: "asia-south1" },
  async () => {
    const now = Date.now();

    const minStart = now - (2 * 24 * 60 * 60 * 1000);
    const maxStart = now + (2 * 24 * 60 * 60 * 1000);
    let nearTermMeetings = [];

    try {
      // Query by startAtMillis only to avoid composite-index dependency on active+range.
      const snap = await db.collection("meetings")
        .where("startAtMillis", ">=", minStart)
        .where("startAtMillis", "<=", maxStart)
        .limit(300)
        .get();

      nearTermMeetings = snap.docs
        .map((docSnap) => {
          const meetingId = String(docSnap.id || "").trim();
          const meeting = docSnap.data() || {};
          return { meetingId, meeting };
        })
        .filter(({ meetingId, meeting }) => !!meetingId && isMeetingOperationalCandidate(meeting, now));
    } catch (e) {
      logger.error("monitorMeetingHealth failed", e);
      await notifyMeetingMaintenanceAlert({
        stage: "monitor_scheduler_failure",
        meetingId: "scheduler",
        errorMessage: `reason_code=SCHEDULER_FAILURE detail=${String(e?.message || "unknown_error").slice(0, 240)}`,
      });
      return;
    }

    // Nothing actionable -> avoid infra/pipeline noise.
    if (!nearTermMeetings.length) {
      logger.info("monitorMeetingHealth skipped (no actionable meetings in window)");
      return;
    }

    // 1) Infra reachability check for configured Jitsi base URL.
    if (SAFE_MEETING_BASE_URL) {
      try {
        const res = await fetchWithTimeout(SAFE_MEETING_BASE_URL, 8000);
        if (!res?.ok) {
          throw new Error(`http_status_${res?.status || "unknown"}`);
        }
      } catch (e) {
        await notifyMeetingMaintenanceAlert({
          stage: "infra_jitsi_unreachable",
          meetingId: "infrastructure",
          errorMessage: `reason_code=JITSI_UNREACHABLE base_url=${SAFE_MEETING_BASE_URL} detail=${String(e?.message || "unknown_error").slice(0, 240)}`,
        });
      }
    }

    // 2) Pipeline sanity checks for near-term meetings.
    try {
      for (const item of nearTermMeetings) {
        const meetingId = item.meetingId;
        const meeting = item.meeting;

        const status = String(meeting.status || "scheduled").trim().toLowerCase();
        const inviteState = String(meeting.inviteDispatchState || "").trim().toLowerCase();
        const resendState = String(meeting.resendDispatchState || "").trim().toLowerCase();
        const reminderState = String(meeting.reminderDispatchState || "").trim().toLowerCase();
        const meetingLink = String(meeting.meetingLink || "").trim();
        const roomName = String(meeting.roomName || "").trim();
        const startAtMillis = toMillisSafe(meeting.startAtMillis || meeting.startAt);
        const endAtMillis = toMillisSafe(meeting.endAtMillis || meeting.endAt);
        const recipientUids = Array.isArray(meeting.recipientUids) ? meeting.recipientUids : [];
        const recipientEmails = Array.isArray(meeting.recipientEmails) ? meeting.recipientEmails : [];

        if (!meetingLink && !roomName) {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_link_missing",
            meetingId,
            errorMessage: "reason_code=MEETING_LINK_MISSING details=meetingLink_and_roomName_empty",
          });
        }

        if (meetingLink && SAFE_MEETING_BASE_URL && !meetingLink.startsWith(`${SAFE_MEETING_BASE_URL}/`)) {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_link_domain_mismatch",
            meetingId,
            errorMessage: `reason_code=MEETING_LINK_DOMAIN_MISMATCH expected_prefix=${SAFE_MEETING_BASE_URL}/ actual=${meetingLink}`,
          });
        }

        if (status === "blocked") {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_blocked",
            meetingId,
            errorMessage: `reason_code=MEETING_BLOCKED blocked_reason=${String(meeting.blockedReason || "unknown").slice(0, 120)}`,
          });
        }

        if (inviteState === "failed" || inviteState === "no_recipients") {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_invite_dispatch",
            meetingId,
            errorMessage: `reason_code=INVITE_${inviteState === "failed" ? "FAILED" : "NO_RECIPIENTS"}`,
          });
        }

        if (resendState === "failed") {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_resend_dispatch",
            meetingId,
            errorMessage: `reason_code=RESEND_FAILED details=${String(meeting.resendError || "unknown").slice(0, 180)}`,
          });
        }

        const startsInMs = startAtMillis - now;
        const hasReminderSent = !!meeting.reminderSentAt;
        if (startsInMs > 0 && startsInMs <= (35 * 60 * 1000) && !hasReminderSent && reminderState === "failed") {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_reminder_dispatch",
            meetingId,
            errorMessage: "reason_code=REMINDER_FAILED window=within_35m",
          });
        }

        if (startAtMillis && now > startAtMillis + (15 * 60 * 1000) && now < (endAtMillis || Number.MAX_SAFE_INTEGER)) {
          const inviteWasSent = !!meeting.inviteSentAt || inviteState === "sent";
          if (!inviteWasSent) {
            await notifyMeetingMaintenanceAlert({
              stage: "meeting_invite_missing_post_start",
              meetingId,
              errorMessage: "reason_code=INVITE_NOT_SENT_AFTER_START",
            });
          }
        }

        if ((status === "scheduled" || status === "live" || status === "ongoing") && recipientUids.length === 0 && recipientEmails.length === 0) {
          await notifyMeetingMaintenanceAlert({
            stage: "meeting_recipients_empty",
            meetingId,
            errorMessage: "reason_code=RECIPIENTS_EMPTY",
          });
        }
      }
    } catch (e) {
      logger.error("monitorMeetingHealth failed", e);
      await notifyMeetingMaintenanceAlert({
        stage: "monitor_scheduler_failure",
        meetingId: "scheduler",
        errorMessage: `reason_code=SCHEDULER_FAILURE detail=${String(e?.message || "unknown_error").slice(0, 240)}`,
      });
    }
  }
);

// ============================================================
// 📥 MAIL INBOUND — HTTP (WEBHOOK + TOKEN)
// Accepts provider webhooks and writes Inbox copies for internal users.
// ============================================================
export const mailInbound = onRequest(
  { region: "asia-south1", secrets: [MAIL_INBOUND_TOKEN, MAILGUN_SIGNING_KEY] },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

      try {
        const requestMarker = `in_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const expectedSecretToken = String(MAIL_INBOUND_TOKEN.value() || "").trim();
        const expectedEnvToken = String(process.env.MAIL_INBOUND_TOKEN_FALLBACK || "").trim();
        const expectedTokens = new Set([
          expectedSecretToken,
          expectedEnvToken,
        ].filter(Boolean));

        const mailgunSigningKey = String(
          MAILGUN_SIGNING_KEY.value() ||
          process.env.MAILGUN_SIGNING_KEY ||
          process.env.MAILGUN_WEBHOOK_SIGNING_KEY ||
          process.env.MAILGUN_API_KEY ||
          ""
        ).trim();

        if (!expectedTokens.size && !mailgunSigningKey) {
          logger.error("mailInbound missing secret", { requestMarker });
          return res.status(503).send({
            error: "Inbound auth is not configured",
            hint: "Set MAIL_INBOUND_TOKEN or MAILGUN_SIGNING_KEY",
          });
        }

        const authHeader = String(req.headers.authorization || "").trim();
        const bearer = authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : "";
        const providedToken = String(
          req.headers["x-mail-inbound-token"] ||
          req.headers["x-inbound-token"] ||
          req.query.token ||
          req.body?.token ||
          bearer ||
          ""
        ).trim();

        const hasStaticTokenAuth = !!providedToken && expectedTokens.has(providedToken);

        const signature = String(req.body?.signature || "").trim();
        const timestamp = String(req.body?.timestamp || "").trim();
        const mailgunToken = String(req.body?.token || "").trim();
        const hasFreshTimestamp = isFreshMailgunTimestamp(timestamp);
        const hasMailgunAuth = !!mailgunSigningKey &&
          hasFreshTimestamp &&
          verifyMailgunSignature({
            timestamp,
            token: mailgunToken,
            signature,
            signingKey: mailgunSigningKey,
          });

        if (!hasStaticTokenAuth && !hasMailgunAuth) {
          logger.warn("mailInbound invalid token", {
            requestMarker,
            hasProvidedToken: !!providedToken,
            hasSignature: !!signature,
            hasTimestamp: !!timestamp,
            hasMailgunToken: !!mailgunToken,
            hasFreshTimestamp,
            method: req.method,
            userAgent: String(req.headers["user-agent"] || "").slice(0, 180),
          });
          return res.status(401).send({
            error: "Invalid inbound token",
            hint: "Provide x-mail-inbound-token or valid Mailgun signature",
          });
        }

        const payload = req.body || {};
        logger.info("mailInbound request accepted", {
          requestMarker,
          method: req.method,
          payloadKeys: Object.keys(payload || {}).slice(0, 40),
        });

        const fromEmails = extractEmailsLoose(
          payload.from ||
          payload.sender ||
          payload.fromEmail ||
          payload.from_email ||
          payload?.envelope?.from ||
          payload?.From ||
          payload?.FromFull ||
          payload?.headers?.from
        );

        const toEmails = extractEmailsLoose([
          payload.to,
          payload.recipient,
          payload.recipients,
          payload.toEmails,
          payload?.envelope?.to,
          payload?.To,
          payload?.ToFull,
          payload?.headers?.to,
        ]).slice(0, 100);

        const ccEmails = extractEmailsLoose([
          payload.cc,
          payload.ccEmails,
          payload?.Cc,
          payload?.headers?.cc,
        ]).slice(0, 100);

        const bccEmails = extractEmailsLoose([
          payload.bcc,
          payload.bccEmails,
          payload?.Bcc,
          payload?.headers?.bcc,
        ]).slice(0, 100);

        const deliveredToEmails = extractEmailsLoose([
          payload.deliveredTo,
          payload.delivered_to,
          payload?.headers?.["delivered-to"],
          payload?.headers?.["x-original-to"],
          payload?.headers?.["x-forwarded-to"],
          payload?.headers?.["envelope-to"],
          payload?.headers?.["x-envelope-to"],
        ]).slice(0, 100);

        const routeTargetEmails = Array.from(new Set([
          ...toEmails,
          ...ccEmails,
          ...bccEmails,
          ...deliveredToEmails,
        ].map((x) => normalizeEmail(x)).filter(Boolean)));

        if (!routeTargetEmails.length) {
          return res.status(400).send({ error: "No recipient found in payload" });
        }

        const subject = sanitizeMailText(
          payload.subject || payload.Subject || payload?.headers?.subject || "",
          250
        );

        const htmlBody = sanitizeMailText(
          payload.html || payload["body-html"] || payload.HtmlBody || payload?.strippedHtml || "",
          200000
        );

        const plainBody = sanitizeMailText(
          payload.text || payload["body-plain"] || payload.TextBody || payload.body || "",
          40000
        );

        const body = plainBody || stripHtml(htmlBody);
        const preview = body.replace(/\s+/g, " ").trim().slice(0, 180);

        const attachments = sanitizeInboundAttachments(
          payload.attachments || payload.Attachments || payload.files || []
        );

        const allUsersSnap = await db.collection("Users").get();
        const usersByEmail = new Map();
        const validUserIds = new Set();
        allUsersSnap.docs.forEach((docSnap) => {
          const user = docSnap.data() || {};
          const email = normalizeEmail(
            user.email || user.Email || user.officeEmail || user.workEmail || ""
          );
          validUserIds.add(docSnap.id);
          if (!email) return;
          usersByEmail.set(email, {
            uid: docSnap.id,
            email,
            name: String(user.Name || user.name || user.displayName || "").trim(),
          });
        });

        const recipientUsers = routeTargetEmails
          .map((email) => usersByEmail.get(email))
          .filter(Boolean);

        const recipientAliasUids = routeTargetEmails
          .map((email) => extractUidFromReplyAlias(email))
          .filter((uid) => !!uid && validUserIds.has(uid));

        const recipientUids = Array.from(
          new Set([
            ...recipientUsers.map((u) => String(u.uid || "").trim()).filter(Boolean),
            ...recipientAliasUids,
          ])
        );

        if (!recipientUids.length) {
          logger.info("mailInbound no internal recipients", {
            requestMarker,
            routeTargetEmails,
            toEmails,
            ccEmails,
            bccEmails,
            deliveredToEmails,
          });
          return res.send({
            ok: true,
            deliveredInternalCount: 0,
            skipped: "No matching internal recipients",
            toEmails: routeTargetEmails,
          });
        }

        const baseMailId = String(
          payload.messageId ||
          payload.MessageID ||
          payload["message-id"] ||
          payload["Message-Id"] ||
          db.collection("mail_meta").doc().id
        )
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 160) || db.collection("mail_meta").doc().id;

        const inboundSentAtRaw =
          payload.date ||
          payload.Date ||
          payload.sentAt ||
          payload?.headers?.date ||
          null;
        const inboundSentAt = inboundSentAtRaw ? new Date(inboundSentAtRaw) : null;
        const sentAtValid = inboundSentAt && !Number.isNaN(inboundSentAt.getTime());
        const sentAt = sentAtValid ? inboundSentAt : new Date();

        const fromEmail = fromEmails[0] || "";
        const fromName = sanitizeMailText(payload.fromName || payload?.FromName || "", 180);

        logger.info("mailInbound parsed", {
          requestMarker,
          fromEmail,
          toEmails,
          ccEmails,
          bccEmails,
          routeTargetEmails,
          subject,
        });

        await db.collection("mail_inbound_raw").add({
          requestMarker,
          provider: "mailgun",
          authMode: hasMailgunAuth ? "mailgun_signature" : "inbound_token",
          fromEmail,
          fromName,
          toEmails,
          ccEmails,
          bccEmails,
          deliveredToEmails,
          routeTargetEmails,
          subject,
          bodyPreview: preview,
          payloadKeys: Object.keys(payload || {}).slice(0, 150),
          rawPayload: payload,
          createdAt: FieldValue.serverTimestamp(),
        });

        await db.collection("leads").add({
          email: fromEmail,
          name: fromName || fromEmail,
          subject,
          message: body,
          source: "email",
          sourceProvider: "mailgun",
          inboundRequestMarker: requestMarker,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const ts = FieldValue.serverTimestamp();
        const batch = db.batch();

        recipientUids.forEach((uid, idx) => {
          const docId = idx === 0 ? baseMailId : `${baseMailId}_${idx}`;
          const ref = db
            .collection("mailboxes")
            .doc(uid)
            .collection("messages")
            .doc(docId);

          batch.set(ref, {
            id: docId,
            sourceMailId: baseMailId,
            ownerUid: uid,
            folder: "inbox",
            fromUid: null,
            fromEmail,
            fromName,
            toEmails,
            toUids: recipientUids,
            ccEmails,
            bccEmails,
            subject,
            body,
            bodyHtml: htmlBody || "",
            attachments,
            preview,
            isRead: false,
            isStarred: false,
            createdAt: ts,
            sentAt,
            updatedAt: ts,
            kind: "mail",
            isInbound: true,
          });
        });

        await batch.commit();

        logger.info("mailInbound delivered", {
          requestMarker,
          messageId: baseMailId,
          fromEmail,
          routeTargetEmails,
          recipientUids,
          deliveredInternalCount: recipientUids.length,
        });

        return res.send({
          ok: true,
          id: baseMailId,
          deliveredInternalCount: recipientUids.length,
          toEmails,
        });
      } catch (e) {
        console.error("mailInbound error", e);
        return res.status(500).send({ error: e?.message || "Server error" });
      }
    });
  }
);

// ============================================================
// 🔔 NOTIFICATIONS — Send email when notification doc created
// ============================================================
export const onNotificationCreated = onDocumentCreated(
  {
    document: "notifications/{nid}",
    secrets: [
      SMTP_USER,
      SMTP_PASS,
      WHATSAPP_ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_SENDER_NUMBER,
    ],
  },
  async (event) => {
    try {
      const n = event.data?.data();
      if (!n || !n.active) return;
      const type = String(n.type || "").trim().toLowerCase();

      if (type === "meeting_maintenance_alert") {
        await event.data.ref.update({
          active: false,
          status: "resolved",
          read: true,
          readAt: FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
          emailSuppressed: true,
          emailSuppressedAt: FieldValue.serverTimestamp(),
          whatsappDispatchState: "suppressed",
          whatsappAttemptedAt: FieldValue.serverTimestamp(),
          channelsSuppressed: ["email", "whatsapp", "push"],
          channelsSuppressedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const senderOfficePhone = normalizeWhatsappPhone(
        String(WHATSAPP_SENDER_NUMBER.value() || "9247507145").trim()
      );

      // 📲 WhatsApp channel (always attempt when recipients + config are available)
      try {
        const users = await resolveNotificationUsers(n);
        const phoneSet = new Set();
        users.forEach((u) => {
          const normalized = normalizeWhatsappPhone(pickUserOfficePhone(u));
          if (normalized) phoneSet.add(normalized);
        });

        const waNumbers = Array.from(phoneSet);
        if (waNumbers.length > 0) {
          const subjectText = String(n.subject || n.title || "CRM Notification").trim();
          const bodyText = String(n.body || n.message || "You have an update").trim();
          const link = toAbsoluteCrmLink(String(
            n.link || n.url || n.surveyLink ||
            (n.dealId ? `https://crm.kapilpower.com/#/crm/deals?open=${n.dealId}` : "")
          ));

          const text = [
            `*${subjectText}*`,
            bodyText,
            link ? `\nOpen: ${link}` : "",
            senderOfficePhone ? `\nSender: +${senderOfficePhone}` : "",
          ].filter(Boolean).join("\n");

          const waResults = await Promise.allSettled(
            waNumbers.map((to) => sendWhatsAppCloudMessage({ to, text }))
          );

          const failed = waResults.filter(
            (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value?.ok)
          );

          await event.data.ref.update({
            whatsappAttemptedAt: FieldValue.serverTimestamp(),
            whatsappRecipients: waNumbers,
            whatsappSender: senderOfficePhone ? `+${senderOfficePhone}` : "",
            whatsappDispatchState: failed.length ? "partial_or_failed" : "sent",
            whatsappFailureCount: failed.length,
          });
        }
      } catch (waErr) {
        logger.error("onNotificationCreated WhatsApp dispatch failed", waErr);
        await event.data.ref.update({
          whatsappAttemptedAt: FieldValue.serverTimestamp(),
          whatsappDispatchState: "failed",
          whatsappError: String(waErr?.message || waErr),
        });
      }

      // ✅ User requested to stop CRM "View Update" emails.
      // Keep notification docs + mobile push, suppress only email channel.
      const moduleName = String(n.module || "").trim().toLowerCase();
      const suppressEmailTypes = new Set([
        "site_survey_link",
        "deal_created",
        "deal_created_update",
        "site_visit_update",
      ]);
      const subject = String(n.subject || n.title || "").toLowerCase();
      const isDealCreatedSubject = subject.includes("new deal created") || subject.includes("deal created:");

      if (moduleName === "crm" || suppressEmailTypes.has(type) || isDealCreatedSubject) {
        await event.data.ref.update({
          emailSuppressed: true,
          emailSuppressedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const now = new Date();
      const notifyAt = n.notifyAt ? new Date(n.notifyAt) : null;

      // If notifyAt is set in future, skip now
      if (notifyAt && notifyAt > now) return;

      const transporter = getTransporter();

      // Determine recipients: byRole or explicit emails
      let to = n.toEmails || [];

      if ((!to || to.length === 0) && n.toRole) {
        to = await getUserEmailsByRoleLoose(n.toRole);
      }

      if (!to || to.length === 0) return;

      const route = String(n.route || "").trim();
      const routeLink = route ? toAbsoluteCrmLink(route) : "";
      const openLink = toAbsoluteCrmLink(String(
        n.link ||
        n.url ||
        n.surveyLink ||
        routeLink ||
        (n.dealId ? `https://crm.kapilpower.com/#/crm/deals?open=${n.dealId}` : "https://crm.kapilpower.com/#/notifications")
      ));

      await transporter.sendMail({
        from: `"Kapil Power CRM" <${SMTP_USER.value()}>`,
        to: to.join(","),
        subject: n.subject || "CRM Notification",
        html: `<p>${n.body || "You have an update"}</p><p><a href=\"${openLink}\">Open in CRM</a></p>`,
      });

      // mark notification sent
      await event.data.ref.update({ sentAt: FieldValue.serverTimestamp() });
    } catch (e) {
      console.error("Notification send error:", e);
    }
  }
);

// ============================================================
// ⚠️ ESCALATION PROCESS — HTTP endpoint to process stale notifications
// Use Cloud Scheduler to call this daily
// ============================================================
export const processEscalations = onRequest(
  { cors: true, region: "asia-south1", secrets: [SMTP_USER, SMTP_PASS] },
  async (req, res) => {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);

      const snap = await db.collection("notifications").where("active", "==", true).get();

      for (const d of snap.docs) {
        const n = d.data();
        // only consider site_visit_pending
        if (n.type !== "site_visit_pending") continue;

        const created = n.createdAt ? new Date(n.createdAt) : null;
        const lastEscalation = n.escalationLevel || 0;

        // If notification created more than 7 days ago and not escalated yet
        if (created && created <= sevenDaysAgo && lastEscalation === 0) {
          // escalate to zonal & state head
          const dealRef = db.collection("deals").doc(n.dealId);
          const dealSnap = await dealRef.get();
          if (!dealSnap.exists) continue;
          const deal = dealSnap.data();

          // try extract zonal/state emails from deal
          const recipients = [];
          if (deal.zonal_manager) recipients.push(deal.zonal_manager);
          if (deal.state_head) recipients.push(deal.state_head);

          // fallback: query Users by role
          if (recipients.length === 0) {
            const zq = await db.collection("Users").where("role", "==", "zonal_manager").get();
            zq.docs.forEach((u) => { if (u.data().email) recipients.push(u.data().email); });
            const sq = await db.collection("Users").where("role", "==", "state_head").get();
            sq.docs.forEach((u) => { if (u.data().email) recipients.push(u.data().email); });
          }

          if (recipients.length > 0) {
            await db.collection("notifications").add({
              dealId: n.dealId,
              type: "escalation_zonal",
              toEmails: recipients,
              subject: `No action on ${n.dealId} by ${n.assignedTo || "Consultant"}`,
              body: `No action on ${n.dealId} assigned to ${n.assignedTo || "Consultant"}`,
              active: true,
              createdAt: FieldValue.serverTimestamp(),
              escalationLevel: 1,
            });

            // mark original as escalated level 1
            await d.ref.update({ escalationLevel: 1 });
          }
        } else if (created && created <= sevenDaysAgo) {
          // if already escalated once and 7 more days passed — escalate to sales_head & admin
          if (n.escalationLevel === 1) {
            const sRecipients = [];
            const sh = await db.collection("Users").where("role", "==", "sales_head").get();
            sh.docs.forEach((u) => { if (u.data().email) sRecipients.push(u.data().email); });
            const adm = await db.collection("Users").where("role", "==", "admin").get();
            adm.docs.forEach((u) => { if (u.data().email) sRecipients.push(u.data().email); });

            if (sRecipients.length > 0) {
              await db.collection("notifications").add({
                dealId: n.dealId,
                type: "escalation_admin",
                toEmails: sRecipients,
                subject: `No action on ${n.dealId} — Escalation`,
                body: `No action on ${n.dealId} by ${n.assignedTo || "Consultant"} — Escalated to Sales Head & Admin`,
                active: true,
                createdAt: FieldValue.serverTimestamp(),
                escalationLevel: 2,
              });

              await d.ref.update({ escalationLevel: 2 });
            }
          }
        }
      }

      return res.send({ ok: true });
    } catch (e) {
      console.error("Escalation error", e);
      return res.status(500).send({ error: "Server error" });
    }
  }
);

// ============================================================
// 🔔 APP PUSH NOTIFICATIONS (FCM) — ALL ACTIVE NOTIFICATIONS
// ============================================================
export const pushOnPurchaseNotificationCreated = onDocumentCreated(
  "notifications/{nid}",
  async (event) => {
    try {
      const n = event.data?.data();
      if (!n) return;
      if (n.active === false) return;

      const type = String(n.type || "").trim().toLowerCase();
      if (type === "meeting_maintenance_alert") {
        await event.data.ref.update({
          active: false,
          status: "resolved",
          read: true,
          readAt: FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
          pushDispatchState: "suppressed",
          pushSuppressedAt: FieldValue.serverTimestamp(),
          pushFailureCount: 0,
        });
        return;
      }

      const nid = event.params.nid;
      const title = String(n.title || "Notification");
      const body = String(n.message || n.body || "You have an update");

      let users = [];
      const targetUid = String(n.toUserId || n.toUid || "").trim();
      const targetEmail = String(n.toEmail || "").trim();

      if (targetUid) {
        const u = await db.collection("Users").doc(targetUid).get();
        if (u.exists) users = [u.data()];
      } else if (targetEmail) {
        const snap = await db.collection("Users").where("email", "==", targetEmail).limit(1).get();
        if (!snap.empty) users = [snap.docs[0].data()];
      } else if (n.toRole) {
        users = await getUsersByRoleLoose(String(n.toRole));
      } else if (Array.isArray(n.toEmails) && n.toEmails.length) {
        const emailUsers = [];
        for (const rawEmail of n.toEmails) {
          const email = String(rawEmail || "").trim();
          if (!email) continue;
          const snap = await db.collection("Users").where("email", "==", email).limit(1).get();
          if (!snap.empty) emailUsers.push(snap.docs[0].data());
        }
        users = emailUsers;
      }

      const tokenSet = new Set();
      for (const user of users) {
        if (typeof user?.fcmToken === "string" && user.fcmToken.trim()) tokenSet.add(user.fcmToken.trim());
        if (Array.isArray(user?.fcmTokens)) {
          user.fcmTokens.forEach((t) => { if (typeof t === "string" && t.trim()) tokenSet.add(t.trim()); });
        }
        if (Array.isArray(user?.webFcmTokens)) {
          user.webFcmTokens.forEach((t) => { if (typeof t === "string" && t.trim()) tokenSet.add(t.trim()); });
        }
        if (Array.isArray(user?.mobileFcmTokens)) {
          user.mobileFcmTokens.forEach((t) => { if (typeof t === "string" && t.trim()) tokenSet.add(t.trim()); });
        }
      }

      const tokens = Array.from(tokenSet);

      if (tokens.length === 0) {
        logger.warn("No FCM tokens for purchase notification", { nid, type: n.type });
        await event.data.ref.update({
          pushDispatchState: "no_tokens",
          pushSentAt: FieldValue.serverTimestamp(),
          pushFailureCount: 0,
        });
        return;
      }

      const messaging = getMessaging();
      let failureCount = 0;

      for (let i = 0; i < tokens.length; i += 500) {
        const batch = tokens.slice(i, i + 500);
        const resp = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title, body },
          data: {
            notificationId: String(nid),
            type: String(n.type || ""),
            module: String(n.module || "books"),
            referenceId: String(n.referenceId || ""),
            referenceType: String(n.referenceType || ""),
            route: String(n.route || "/notifications"),
          },
          android: { priority: "high" },
          apns: { headers: { "apns-priority": "10" } },
          webpush: { headers: { Urgency: "high" } },
        });

        failureCount += Number(resp.failureCount || 0);
        if (resp.failureCount > 0) {
          resp.responses.forEach((r, idx) => {
            if (!r.success) {
              logger.error("FCM send failed", {
                nid,
                token: batch[idx],
                code: r.error?.code || "unknown",
                message: r.error?.message || "unknown",
              });
            }
          });
        }
      }

      await event.data.ref.update({
        pushDispatchState: failureCount === 0 ? "sent" : "partial",
        pushSentAt: FieldValue.serverTimestamp(),
        pushFailureCount: failureCount,
      });

      if (failureCount > 0) {
        await db.collection("notificationPushRetries").doc(String(nid)).set({
          notificationId: String(nid),
          attempts: 1,
          status: "pending",
          nextAttemptAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          type: String(n.type || ""),
        }, { merge: true });
      }
    } catch (e) {
      logger.error("Purchase notification push error", e);
      try {
        const nid = event.params.nid;
        await db.collection("notificationPushRetries").doc(String(nid)).set({
          notificationId: String(nid),
          attempts: 1,
          status: "pending",
          nextAttemptAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          error: e?.message || "unknown",
        }, { merge: true });
      } catch {}
    }
  }
);

// ============================================================
// 🔔 MANDATORY APP NOTIFICATIONS — DEAL CREATE / SURVEY LINK
// ============================================================
export const notifyOnDealCreatedApp = onDocumentCreated(
  "deals/{dealId}",
  async (event) => {
    try {
      const dealId = event.params.dealId;
      const d = event.data?.data() || {};
      if (!isCanonicalDealDoc(dealId, d)) return;
      if (isBulkImportRecord(d)) return;
      const kpi = d.autoId || d.kpiId || dealId;
      const consultantRaw = String(d.assignedConsultant || "").trim();
      const teleRaw = String(d.teleSale || d.telesales || "").trim();
      const shouldNotifyConsultant = hasSiteVisitArranged(d);

      const [consultantUser, teleUser] = await Promise.all([
        consultantRaw ? findUserByEmailOrNameLoose(consultantRaw, "consultant") : Promise.resolve(null),
        teleRaw ? findUserByEmailOrNameLoose(teleRaw, "telesales") : Promise.resolve(null),
      ]);

      const consultantEmail = String(consultantUser?.email || consultantRaw || "").trim();
      const teleEmail = String(teleUser?.email || "").trim();

      if (consultantEmail && shouldNotifyConsultant) {
        await createNotificationIfMissing({
          dedupeKey: `deal_created_${dealId}_consultant`,
          payload: {
            dealId,
            type: "deal_created",
            module: "crm",
            referenceType: "deal",
            referenceId: dealId,
            title: `New deal created: ${kpi}`,
            subject: `New deal created: ${kpi}`,
            body: `A new deal (${kpi}) has been created and assigned to you.`,
            toUserId: consultantUser?.id || null,
            toEmails: [consultantEmail],
            assignedTo: consultantEmail,
            status: "unread",
            active: true,
          },
        });
      }

      if (teleEmail || teleUser?.id) {
        await createNotificationIfMissing({
          dedupeKey: `deal_created_${dealId}_telesales`,
          payload: {
            dealId,
            type: "deal_created_update",
            module: "crm",
            referenceType: "deal",
            referenceId: dealId,
            title: `Deal created: ${kpi}`,
            subject: `Deal created: ${kpi}`,
            body: `Deal ${kpi} has been created${consultantEmail ? ` and assigned to ${consultantEmail}` : ""}.`,
            toUserId: teleUser?.id || null,
            toEmails: teleEmail ? [teleEmail] : [],
            toRole: teleEmail ? null : "telesales",
            status: "unread",
            active: true,
          },
        });
      }

      // ✅ Requested: no sales_head fallback for new-deal notifications.
    } catch (e) {
      logger.error("notifyOnDealCreatedApp failed", e);
    }
  }
);

export const notifyOnSurveyLinkAssignment = onDocumentWritten(
  "deals/{dealId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || {};
      const after = event.data.after?.data() || {};
      const canonicalDealId = pickCanonicalDealId(after) || event.params.dealId;
      if (canonicalDealId !== event.params.dealId) return;
      const dealId = canonicalDealId;

      if (isBulkImportRecord(after) || isBulkImportRecord(before)) return;

      const newConsultant = String(after.assignedConsultant || "").trim().toLowerCase();
      const oldToken = String(before.siteSurveyToken || "").trim();
      const newToken = String(after.siteSurveyToken || "").trim();
      const tokenForLink = String(newToken || after.siteSurveyToken || oldToken || "").trim();
      const surveyLink = tokenForLink
        ? `https://crm.kapilpower.com/#/site-survey/start/${dealId}/${tokenForLink}`
        : "";

      if (!hasSiteVisitArranged(after)) return;

      const tokenChanged = !!newToken && oldToken !== newToken;
      // ✅ Create app notification only when a fresh token is generated.
      if (!tokenChanged) return;
      if (!surveyLink) return;

      const kpi = after.autoId || after.kpiId || dealId;
      const consultantUser = newConsultant
        ? await findUserByEmailOrNameLoose(newConsultant, "consultant")
        : null;
      const consultantEmail = String(consultantUser?.email || newConsultant || "").trim();

      await createNotificationIfMissing({
        dedupeKey: `survey_link_${dealId}_${newToken || "no-token"}`,
        payload: {
          dealId,
          kpiId: kpi,
          type: "site_survey_link",
          module: "crm",
          referenceType: "deal",
          referenceId: dealId,
          title: `Site survey link shared: ${kpi}`,
          subject: `Site survey link shared: ${kpi}`,
          body: `Site survey link is ready for deal ${kpi}.`,
          surveyLink,
          link: surveyLink,
          url: surveyLink,
          route: surveyLink || "/notifications",
          toUserId: consultantUser?.id || null,
          toEmails: consultantEmail ? [consultantEmail] : [],
          toRole: consultantEmail ? null : "consultant",
          assignedTo: consultantEmail || "",
          status: "unread",
          active: true,
        },
      });
    } catch (e) {
      logger.error("notifyOnSurveyLinkAssignment failed", e);
    }
  }
);

// ============================================================
// 🔔 MANDATORY APP NOTIFICATIONS — LEAVE / COMPOFF / EARLY
// ============================================================
export const notifyOnLeaveRequestLifecycle = onDocumentWritten(
  "leaveRequests/{leaveId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || null;
      const after = event.data.after?.data() || {};
      const leaveId = event.params.leaveId;

      const typeMap = {
        leave: "Leave",
        comp_off: "Comp-Off",
        early_checkin: "Early Check-in",
        early_checkout: "Early Check-out",
      };

      const reqType = String(after.type || "leave");
      const typeLabel = typeMap[reqType] || "Leave";
      const requesterName = after.userName || after.userEmail || "Employee";

      const isCreate = !before;
      if (isCreate) {
        const toEmail = String(after.approverEmail || "").trim();
        const toRole = String(after.approverRole || "").trim();

        await createNotificationIfMissing({
          dedupeKey: `leave_created_${leaveId}`,
          payload: {
            type: "leave_approval",
            module: "attendance",
            referenceType: "leaveRequest",
            referenceId: leaveId,
            title: `${typeLabel} approval required`,
            subject: `${typeLabel} approval required`,
            body: `${requesterName} requested ${typeLabel} (${after.from || ""} → ${after.to || ""}).`,
            toUserId: after.approverUid || null,
            toRole: toEmail ? null : toRole || null,
            toEmails: toEmail ? [toEmail] : [],
            status: "unread",
            active: true,
          },
        });
      }

      const prevFinal = String(before?.final_status || before?.status || "").toLowerCase();
      const nextFinal = String(after.final_status || after.status || "").toLowerCase();
      if (nextFinal === prevFinal) return;

      if (nextFinal === "approved" || nextFinal === "rejected") {
        const userEmail = String(after.userEmail || "").trim();
        await createNotificationIfMissing({
          dedupeKey: `leave_final_${leaveId}_${nextFinal}`,
          payload: {
            type: "leave_request_update",
            module: "attendance",
            referenceType: "leaveRequest",
            referenceId: leaveId,
            title: `${typeLabel} ${nextFinal}`,
            subject: `${typeLabel} ${nextFinal}`,
            body: `Your ${typeLabel} request (${after.from || ""} → ${after.to || ""}) is ${nextFinal}.`,
            toUserId: after.userId || null,
            toEmails: userEmail ? [userEmail] : [],
            status: "unread",
            active: true,
          },
        });
      }
    } catch (e) {
      logger.error("notifyOnLeaveRequestLifecycle failed", e);
    }
  }
);

// ============================================================
// 🔔 MANDATORY APP NOTIFICATIONS — PO APPROVAL TO DGM
// ============================================================
export const notifyOnPurchaseOrderLifecycle = onDocumentWritten(
  "purchaseOrders/{poId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || null;
      const after = event.data.after?.data() || {};
      const poId = event.params.poId;
      const poNumber = String(after.poNumber || poId);
      const prevStatus = String(before?.status || "").toLowerCase();
      const nextStatus = String(after.status || "").toLowerCase();

      if (nextStatus === "pending_approval" && prevStatus !== "pending_approval") {
        await createNotificationIfMissing({
          dedupeKey: `po_approval_${poId}_pending_approval_backend`,
          payload: {
            type: "po_approval",
            module: "books",
            referenceType: "purchaseOrder",
            referenceId: poId,
            title: "PO Approval Required",
            subject: "PO Approval Required",
            body: `${poNumber} requires approval`,
            toRole: "dgm",
            status: "unread",
            active: true,
          },
        });
      }
    } catch (e) {
      logger.error("notifyOnPurchaseOrderLifecycle failed", e);
    }
  }
);

export const notifyOnServicePurchaseOrderLifecycle = onDocumentWritten(
  "servicePurchaseOrders/{poId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || null;
      const after = event.data.after?.data() || {};
      const poId = event.params.poId;
      const poNumber = String(after.poNumber || poId);
      const prevStatus = String(before?.status || "").toLowerCase();
      const nextStatus = String(after.status || "").toLowerCase();

      if (nextStatus === "pending_approval" && prevStatus !== "pending_approval") {
        await createNotificationIfMissing({
          dedupeKey: `service_po_approval_${poId}_pending_approval_backend`,
          payload: {
            type: "po_approval",
            module: "books",
            referenceType: "servicePurchaseOrder",
            referenceId: poId,
            title: "PO Approval Required",
            subject: "PO Approval Required",
            body: `${poNumber} requires approval`,
            toRole: "dgm",
            status: "unread",
            active: true,
          },
        });
      }
    } catch (e) {
      logger.error("notifyOnServicePurchaseOrderLifecycle failed", e);
    }
  }
);

// ============================================================
// 🔔 REVERSE NOTIFICATIONS — PO STATUS BACK TO CREATOR
// ============================================================
export const notifyOnPurchaseOrderStatusChanges = onDocumentWritten(
  "purchaseOrders/{poId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || null;
      const after = event.data.after?.data() || {};
      const poId = event.params.poId;

      const prevStatus = String(before?.status || "").toLowerCase();
      const nextStatus = String(after.status || "").toLowerCase();
      if (!nextStatus || prevStatus === nextStatus) return;
      if (!["approved", "rejected", "hold", "on_hold"].includes(nextStatus)) return;

      const poNumber = String(after.poNumber || poId);
      const creatorEmail = String(
        after.createdByEmail ||
        after.createdByMail ||
        after.createdByUserEmail ||
        ""
      ).trim();

      const humanStatus = nextStatus === "on_hold" ? "hold" : nextStatus;
      await createNotificationIfMissing({
        dedupeKey: `po_reverse_${poId}_${humanStatus}`,
        payload: {
          type: "po_status_update",
          module: "books",
          referenceType: "purchaseOrder",
          referenceId: poId,
          title: `PO ${humanStatus}: ${poNumber}`,
          subject: `PO ${humanStatus}: ${poNumber}`,
          body: `Your PO ${poNumber} is ${humanStatus}.`,
          toUserId: after.createdBy || null,
          toEmails: creatorEmail ? [creatorEmail] : [],
          status: "unread",
          active: true,
        },
      });
    } catch (e) {
      logger.error("notifyOnPurchaseOrderStatusChanges failed", e);
    }
  }
);

export const notifyOnServicePurchaseOrderStatusChanges = onDocumentWritten(
  "servicePurchaseOrders/{poId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || null;
      const after = event.data.after?.data() || {};
      const poId = event.params.poId;

      const prevStatus = String(before?.status || "").toLowerCase();
      const nextStatus = String(after.status || "").toLowerCase();
      if (!nextStatus || prevStatus === nextStatus) return;
      if (!["approved", "rejected", "hold", "on_hold"].includes(nextStatus)) return;

      const poNumber = String(after.poNumber || poId);
      const creatorEmail = String(
        after.createdByEmail ||
        after.createdByMail ||
        after.createdByUserEmail ||
        ""
      ).trim();

      const humanStatus = nextStatus === "on_hold" ? "hold" : nextStatus;
      await createNotificationIfMissing({
        dedupeKey: `service_po_reverse_${poId}_${humanStatus}`,
        payload: {
          type: "po_status_update",
          module: "books",
          referenceType: "servicePurchaseOrder",
          referenceId: poId,
          title: `PO ${humanStatus}: ${poNumber}`,
          subject: `PO ${humanStatus}: ${poNumber}`,
          body: `Your PO ${poNumber} is ${humanStatus}.`,
          toUserId: after.createdBy || null,
          toEmails: creatorEmail ? [creatorEmail] : [],
          status: "unread",
          active: true,
        },
      });
    } catch (e) {
      logger.error("notifyOnServicePurchaseOrderStatusChanges failed", e);
    }
  }
);

// ============================================================
// 🔔 REVERSE NOTIFICATIONS — CONSULTANT SITE VISIT UPDATES
// ============================================================
export const notifyOnSiteVisitStatusChanges = onDocumentWritten(
  "deals/{dealId}",
  async (event) => {
    try {
      if (!event.data.after.exists) return;
      const before = event.data.before?.data() || {};
      const after = event.data.after?.data() || {};
      const dealId = event.params.dealId;

      const prev = String(before.siteVisitStatus || "").trim().toLowerCase();
      const next = String(after.siteVisitStatus || "").trim().toLowerCase();
      if (!next || prev === next) return;

      const allowed = new Set(["completed", "rescheduled", "not interested"]);
      if (!allowed.has(next)) return;

      const kpi = after.autoId || after.kpiId || dealId;
      const senderEmailRaw = String(after.teleSale || after.telesales || "").trim();
      const consultantEmail = String(after.assignedConsultant || "").trim();
      const teleUser = senderEmailRaw
        ? await findUserByEmailOrNameLoose(senderEmailRaw, "telesales")
        : null;
      const senderEmail = String(teleUser?.email || (senderEmailRaw.includes("@") ? senderEmailRaw.toLowerCase() : "")).trim();

      const bodyTail = next === "not interested"
        ? ` Reason: ${String(after.notInterestedReason || "No reason")}`
        : "";

      // Avoid spam: keep at most 2 active notifications for same deal + status.
      const existingForDeal = await db
        .collection("notifications")
        .where("dealId", "==", dealId)
        .where("active", "==", true)
        .limit(50)
        .get();

      const sameStatusCount = existingForDeal.docs
        .map((d) => d.data() || {})
        .filter((n) => {
          const nType = String(n.type || "").trim().toLowerCase();
          const nStatus = String(n.siteVisitStatus || "").trim().toLowerCase();
          return nType === "site_visit_update" && nStatus === next;
        }).length;

      if (sameStatusCount >= 2) {
        logger.info("Skipping extra site_visit_update notification (cap reached)", {
          dealId,
          status: next,
          count: sameStatusCount,
        });
        return;
      }

      await createNotificationIfMissing({
        dedupeKey: `site_visit_reverse_${dealId}_${next}_${String(after.siteVisitCompletedDate || after.siteVisitArrangedDate || "").slice(0, 20)}`,
        payload: {
          dealId,
          kpiId: kpi,
          type: "site_visit_update",
          module: "crm",
          referenceType: "deal",
          referenceId: dealId,
          title: `Site visit update: ${kpi}`,
          subject: `Site visit update: ${kpi}`,
          body: `${consultantEmail || "Consultant"} updated site visit status to ${next}.${bodyTail}`,
          siteVisitStatus: next,
          toUserId: teleUser?.id || null,
          toEmails: senderEmail ? [senderEmail] : [],
          toRole: senderEmail ? null : "telesales",
          assignedTo: consultantEmail || "",
          status: "unread",
          active: true,
        },
      });
    } catch (e) {
      logger.error("notifyOnSiteVisitStatusChanges failed", e);
    }
  }
);

export const cleanupSiteVisitNotificationsOnDealDelete = onDocumentDeleted(
  "deals/{dealId}",
  async (event) => {
    try {
      const dealId = String(event.params.dealId || "").trim();
      if (!dealId) return;

      const before = event.data?.data() || {};
      const kpi = String(before.autoId || before.kpiId || dealId).trim();

      const typesToCleanup = ["site_visit_update", "site_survey_link"];
      const jobs = [];
      for (const t of typesToCleanup) {
        jobs.push(
          db
            .collection("notifications")
            .where("type", "==", t)
            .where("dealId", "==", dealId)
            .get()
        );
        jobs.push(
          db
            .collection("notifications")
            .where("type", "==", t)
            .where("referenceId", "==", dealId)
            .get()
        );
        if (kpi) {
          jobs.push(
            db
              .collection("notifications")
              .where("type", "==", t)
              .where("kpiId", "==", kpi)
              .get()
          );
        }
      }

      const snapshots = await Promise.all(jobs);

      const refs = new Map();
      snapshots.forEach((snap) => {
        (snap?.docs || []).forEach((d) => refs.set(d.id, d.ref));
      });
      if (refs.size === 0) return;

      let batch = db.batch();
      let opCount = 0;
      for (const ref of refs.values()) {
        batch.delete(ref);
        opCount += 1;
        if (opCount >= 400) {
          await batch.commit();
          batch = db.batch();
          opCount = 0;
        }
      }
      if (opCount > 0) await batch.commit();

      logger.info("Removed deal-linked survey/site-visit notifications after deal delete", {
        dealId,
        kpi,
        types: typesToCleanup,
        removed: refs.size,
      });
    } catch (e) {
      logger.error("cleanupSiteVisitNotificationsOnDealDelete failed", e);
    }
  }
);
