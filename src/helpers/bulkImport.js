import * as XLSX from "xlsx";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { fetchCollectionDocs } from "./firestoreFetch";

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

export const isAdminSessionUser = () => {
  try {
    const raw = localStorage.getItem("kp-user");
    const parsed = raw ? JSON.parse(raw) : {};

    const roleCandidates = [
      parsed?.role,
      parsed?.Role,
      parsed?.customRole,
      parsed?.CustomRole,
      parsed?.designation,
      parsed?.Designation,
      parsed?.profile?.role,
      parsed?.profile?.Role,
      parsed?.profile?.customRole,
      parsed?.profile?.CustomRole,
      parsed?.profile?.designation,
      parsed?.profile?.Designation,
    ]
      .map((v) => normalizeRole(v))
      .filter(Boolean);

    if (roleCandidates.includes("admin")) return true;

    const email = String(parsed?.email || parsed?.Email || parsed?.profile?.email || parsed?.profile?.Email || "")
      .trim()
      .toLowerCase();
    const uid = String(parsed?.uid || parsed?.id || parsed?.profile?.uid || parsed?.profile?.id || "").trim();

    const adminEmails = new Set(["loan@kapilpower.com", "kapiladmin@gmail.com"]);
    const adminUids = new Set(["26VHcREEDMMg8C24kXYVGzRXHe43"]);

    return adminEmails.has(email) || adminUids.has(uid);
  } catch {
    return false;
  }
};

const normalizeKey = (key) => {
  const raw = String(key || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[()[\]{}]/g, " ").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts
    .map((p, idx) => {
      const chunk = p.toLowerCase();
      if (idx === 0) return chunk;
      return chunk.charAt(0).toUpperCase() + chunk.slice(1);
    })
    .join("");
};

const normalizeRow = (row) => {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    if (!normalized) return;
    if (value === undefined || value === null) return;
    if (String(value).trim() === "") return;
    out[normalized] = value;
  });
  return out;
};

const sanitizeDocId = (value) =>
  String(value || "")
    .trim()
    .replace(/[\\/#?\[\]]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);

const chunk = (arr, size = 400) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toNumberIfNumeric = (value) => {
  if (typeof value === "number") return value;
  const text = String(value || "").trim();
  if (!text) return value;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return value;
};

export const parseExcelRows = async (file) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  return rows.map((r) => normalizeRow(r)).filter((r) => Object.keys(r).length > 0);
};

export const getUserNameByEmailMap = async () => {
  const users = await fetchCollectionDocs("Users");
  const map = {};
  users.forEach((u) => {
    const email = String(u?.email || "").trim().toLowerCase();
    const name = String(u?.Name || u?.name || "").trim();
    if (email && name) map[email] = name;
  });
  return map;
};

export const importRowsToCollection = async ({
  collectionName,
  rows,
  preferDocIdKeys = [],
  transformRow,
  userMeta = {},
}) => {
  if (!Array.isArray(rows) || rows.length === 0) return { imported: 0 };

  let imported = 0;
  for (const pack of chunk(rows, 400)) {
    const batch = writeBatch(db);

    pack.forEach((original) => {
      const normalized = Object.fromEntries(
        Object.entries(original || {}).map(([k, v]) => [k, toNumberIfNumeric(v)])
      );

      const row = typeof transformRow === "function" ? transformRow(normalized) : normalized;
      if (!row || Object.keys(row).length === 0) return;

      const preferredId = preferDocIdKeys
        .map((k) => row[k])
        .find((v) => String(v || "").trim());

      const docId = sanitizeDocId(preferredId);
      const ref = docId ? doc(db, collectionName, docId) : doc(collection(db, collectionName));

      batch.set(
        ref,
        {
          ...row,
          source: "excel_import",
          skipAutomation: true,
          _bulkImport: true,
          importMeta: {
            source: "excel",
            skipAutomation: true,
            importedAt: serverTimestamp(),
            importedByUid: String(userMeta?.uid || ""),
            importedByEmail: String(userMeta?.email || "").toLowerCase(),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      imported += 1;
    });

    await batch.commit();
  }

  return { imported };
};
