// src/helpers/getScopedQuery.js

import {
  collection,
  query,
  where,
  doc,
  getDoc
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";

const normalizeRole = (raw) => {
  const base = (raw || "").toString().trim().toLowerCase();
  if (!base) return "";
  const underscored = base.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  const compact = underscored.replace(/_/g, "");
  const aliasByCompact = {
    saleshead: "sales_head",
    salesheadmanager: "sales_head",

    // HR / ops
    hroperationsmanager: "agm",
    hr_operations_manager: "agm",
    agm: "agm",

    // Finance variants
    finance: "dgm",
    financeadmin: "dgm",
    finance_manager: "dgm",
    financemanager: "dgm",
    dgm: "dgm",

    // Tele caller variants
    telecaller: "tele_caller",
    telecallar: "tele_caller",
    telesales: "telesales",
    telesale: "telesales",

    // Team lead variants
    teamlead: "team_lead",
  };
  return aliasByCompact[compact] || underscored;
};

const pickFirst = (...vals) => vals.find((v) => String(v || "").trim()) || "";

const uniqueNonEmpty = (arr = []) => {
  const seen = new Set();
  const out = [];
  arr.forEach((v) => {
    const s = String(v || "").trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
};

const scopeVariants = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return [];
  const lower = value.toLowerCase();
  const compact = lower.replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
  return uniqueNonEmpty([value, lower, compact]);
};

const scopeQueryForField = (collectionName, field, rawValues = []) => {
  const values = uniqueNonEmpty(rawValues).slice(0, 10);
  if (values.length === 0) return null;
  if (values.length === 1) return query(collection(db, collectionName), where(field, "==", values[0]));
  return query(collection(db, collectionName), where(field, "in", values));
};

const getConsultantScopedQuery = (collectionName, user = {}) => {
  const consultantName = pickFirst(user.Name, user.name);
  const email = pickFirst(user.email);
  const uid = pickFirst(user.uid);

  const nameVariants = [consultantName, String(consultantName || "").toLowerCase()];
  const emailVariants = [email, String(email || "").toLowerCase()];

  const byAssigned = scopeQueryForField(collectionName, "assignedConsultant", [
    ...emailVariants,
    ...nameVariants,
    uid,
  ]);
  if (byAssigned) return byAssigned;

  // Historical data in these collections is often keyed by consultantName.
  if (collectionName === "salesOrders" || collectionName === "projects") {
    const byName = scopeQueryForField(collectionName, "consultantName", [
      ...nameVariants,
      ...emailVariants,
    ]);
    if (byName) return byName;
  }

  return scopeQueryForField(collectionName, "consultantName", [
    ...nameVariants,
    ...emailVariants,
  ]);
};
/**
 * Returns a Firestore query scoped by role
 * Returns NULL if access is not allowed
 */
export async function getScopedQuery(collectionName) {
  // Prefer cached local session when possible (fast and resilient for WKWebView)
  const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const profile = parsed?.profile || {};
      const role = normalizeRole(
        pickFirst(parsed.role, parsed.Role, profile.role, profile.Role)
      );
      const user = {
        ...parsed,
        ...profile,
        uid: pickFirst(parsed.uid, profile.uid),
        email: pickFirst(parsed.email, profile.email),
        Name: pickFirst(parsed.Name, parsed.name, profile.Name, profile.name),
        name: pickFirst(parsed.name, parsed.Name, profile.name, profile.Name),
        state: pickFirst(parsed.state, profile.state),
        sales_zone: pickFirst(parsed.sales_zone, parsed.salesZone, profile.sales_zone, profile.salesZone),
        sales_area: pickFirst(parsed.sales_area, parsed.salesArea, profile.sales_area, profile.salesArea),
      };
      // use cached user directly
      console.log('[ScopedQuery] using cached kp-user', { role, email: user.email, uid: user.uid });

      // If role is missing, fall back to DB/REST to avoid over-restricting
      if (!role) {
        throw new Error('Cached role missing');
      }

      // replace later logic by jumping to role-based return below
      // Inline the role-specific logic by setting variables
      // (we'll reuse the same role variable in the subsequent checks)
      // fallthrough
      // NOTE: keep role and user in scope
      var _scoped_user = user;
      var _scoped_role = role;

      // use these variables instead of database read
      // continue
      const roleToUse = normalizeRole(_scoped_role);
      const userToUse = _scoped_user;
      // now jump to the same logic as before using roleToUse and userToUse
      // 🔓 SUPER ROLES
      const SUPER_ROLES = [
        "admin",
        "sales_head",
        "director",
        "dgm",
        "agm"
      ];

      if (SUPER_ROLES.includes(roleToUse)) {
        return collection(db, collectionName);
      }

      if (roleToUse === "consultant") {
        return getConsultantScopedQuery(collectionName, userToUse);
      }

      if (roleToUse === "telesales" || roleToUse === "tele_caller") {
        const teleName = pickFirst(userToUse.Name, userToUse.name);
        return scopeQueryForField(collectionName, "teleSale", [teleName, userToUse.email]);
      }

      if (roleToUse === "state_head" || roleToUse === "team_lead") {
        return scopeQueryForField(collectionName, "state", scopeVariants(userToUse.state));
      }

      if (roleToUse === "zonal_manager") {
        return scopeQueryForField(collectionName, "sales_zone", scopeVariants(userToUse.sales_zone));
      }

      if (roleToUse === "area_sales_manager") {
        return scopeQueryForField(collectionName, "sales_area", scopeVariants(userToUse.sales_area));
      }

      if (roleToUse === "designer") {
        return collectionName === "deals"
          ? collection(db, collectionName)
          : null;
      }

      if (roleToUse === "operations_manager" || roleToUse === "operations_executive") {
        return collectionName === "projects"
          ? collection(db, collectionName)
          : null;
      }

      if (roleToUse === "accountant") {
        return ["deals", "salesOrders", "projects"].includes(collectionName)
          ? collection(db, collectionName)
          : null;
      }

      if (roleToUse === "service_engineer") {
        return collectionName === "projects" && userToUse.sales_area
          ? query(
              collection(db, collectionName),
              where("sales_area", "==", userToUse.sales_area)
            )
          : null;
      }

      // FINAL FALLBACK using ownerUid
      return query(
        collection(db, collectionName),
        where("ownerUid", "==", userToUse.uid)
      );
    } catch (e) {
      console.warn('[ScopedQuery] cached kp-user parse failed', e);
      // fallthrough to DB read
    }
  }

  const firebaseUser = auth.currentUser;
  if (!firebaseUser?.uid) {
    throw new Error("Auth not ready");
  }

  // DB read (with timeout) and REST fallback if necessary
  try {
    const userSnap = await Promise.race([
      getDoc(doc(db, "Users", firebaseUser.uid)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('user fetch timeout')), 2500)),
    ]);
    if (!userSnap || !userSnap.exists()) {
      throw new Error('User profile not found');
    }

    const userRaw = userSnap.data() || {};
    const user = {
      ...userRaw,
      email: pickFirst(userRaw.email),
      Name: pickFirst(userRaw.Name, userRaw.name),
      name: pickFirst(userRaw.name, userRaw.Name),
      state: pickFirst(userRaw.state),
      sales_zone: pickFirst(userRaw.sales_zone, userRaw.salesZone),
      sales_area: pickFirst(userRaw.sales_area, userRaw.salesArea),
    };
    const role = normalizeRole(user.role || user.Role || "");

  console.log(
    "[ScopedQuery]",
    "collection:", collectionName,
    "role:", role,
    "email:", user.email
  );

  // 🔓 SUPER ROLES
  const SUPER_ROLES = [
    "admin",
    "sales_head",
    "director",
    "dgm",
    "agm"
  ];

  if (SUPER_ROLES.includes(role)) {
    return collection(db, collectionName);
  }

  // 👤 CONSULTANT
  if (role === "consultant") {
    return getConsultantScopedQuery(collectionName, user);
  }

  // 🎧 TELESALES
  if (role === "telesales" || role === "tele_caller") {
    const teleName = pickFirst(user.Name, user.name);
    return scopeQueryForField(collectionName, "teleSale", [teleName, user.email]);
  }

  // 🏛 STATE HEAD / TEAM LEAD
  if (role === "state_head" || role === "team_lead") {
    return scopeQueryForField(collectionName, "state", scopeVariants(user.state));
  }

  // 🌍 ZONAL MANAGER
  if (role === "zonal_manager") {
    return scopeQueryForField(collectionName, "sales_zone", scopeVariants(user.sales_zone));
  }

  // 📍 AREA SALES MANAGER
  if (role === "area_sales_manager") {
    return scopeQueryForField(collectionName, "sales_area", scopeVariants(user.sales_area));
  }

  // 🎨 DESIGNER → ONLY DEALS
  if (role === "designer") {
    return collectionName === "deals"
      ? collection(db, collectionName)
      : null;
  }

  // 🏗 OPERATIONS → ONLY PROJECTS
  if (role === "operations_manager" || role === "operations_executive") {
    return collectionName === "projects"
      ? collection(db, collectionName)
      : null;
  }

  // 💰 ACCOUNTANT
  if (role === "accountant") {
    return ["deals", "salesOrders", "projects"].includes(collectionName)
      ? collection(db, collectionName)
      : null;
  }

  // 🔧 SERVICE ENGINEER
  if (role === "service_engineer") {
    return collectionName === "projects" && user.sales_area
      ? query(
          collection(db, collectionName),
          where("sales_area", "==", user.sales_area)
        )
      : null;
  }

  // 🔒 FINAL FALLBACK
  return query(
    collection(db, collectionName),
    where("ownerUid", "==", firebaseUser.uid)
  );
  } catch (err) {
    console.warn('[ScopedQuery] DB lookup failed; attempting REST fallback', err && (err.message || err));
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
      const parsed = stored ? JSON.parse(stored) : null;
      const token = (parsed && parsed.idToken) || null;
      if (token) {
        const { fetchDocumentREST } = await import('./firestoreRest');
        const rest = await fetchDocumentREST(`Users/${firebaseUser.uid}`, token);
        const role = normalizeRole(rest.role || rest.Role || "");
        const user = rest;

        const SUPER_ROLES = [
          "admin",
          "sales_head",
          "director",
          "dgm",
          "agm"
        ];

        if (SUPER_ROLES.includes(role)) {
          return collection(db, collectionName);
        }

        if (role === "consultant") {
          return getConsultantScopedQuery(collectionName, user);
        }

        if (role === "telesales" || role === "tele_caller") {
          const teleName = pickFirst(user.Name, user.name);
          return scopeQueryForField(collectionName, "teleSale", [teleName, user.email]);
        }

        // Minimal fallback: ownerUid
        return query(
          collection(db, collectionName),
          where("ownerUid", "==", firebaseUser.uid)
        );
      }
    } catch (restErr) {
      console.warn('[ScopedQuery] REST fallback failed', restErr && (restErr.message || restErr));
    }

    throw new Error('User profile not found');
  }
}
