import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebaseConfig";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";
import { getAreaOptions, getZoneOptions, isKnownState } from "../helpers/salesRegions";
import { fetchDocumentREST, updateDocumentREST, createDocumentREST, deleteDocumentREST } from "../helpers/firestoreRest";

const isPlainObject = (v) => Object.prototype.toString.call(v) === "[object Object]";

const normalizeForCompare = (v) => {
  if (v === undefined) return "__undefined__";
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalizeForCompare);
  if (isPlainObject(v)) {
    if (typeof v.toDate === "function") {
      try {
        return v.toDate()?.toISOString?.() || null;
      } catch {
        return null;
      }
    }
    const out = {};
    Object.keys(v)
      .sort()
      .forEach((k) => {
        out[k] = normalizeForCompare(v[k]);
      });
    return out;
  }
  return String(v);
};

const areEqual = (a, b) => {
  try {
    return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
  } catch {
    return a === b;
  }
};

export const ROLE_HIERARCHY = {
  director: 1,
  sales_head: 2,
  dgm: 2,
  agm: 3,
  state_head: 3,
  zonal_manager: 4,
  area_sales_manager: 5,
  team_lead: 6,
  consultant: 7,
  telecaller: 7,
  tele_caller: 7,
};

export const normalizeRole = (v) => {
  const n = String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  const compact = n.replace(/_/g, "");
  if (n === "saleshead" || compact === "saleshead") return "sales_head";
  if (n === "statehead" || compact === "statehead") return "state_head";
  if (n === "zonalmanager" || compact === "zonalmanager") return "zonal_manager";
  if (n === "areasalesmanager" || compact === "areasalesmanager") return "area_sales_manager";
  if (n === "teamlead" || compact === "teamlead") return "team_lead";
  if (n === "tele_caller" || compact === "telecaller") return "telecaller";
  if (n === "hrexecutive" || compact === "hrexecutive") return "hr_executive";
  if (n === "finance" || n === "finance_manager" || n === "financemanager" || compact === "financemanager") return "dgm";
  if (n === "hroperationsmanager" || n === "hr_operations_manager" || compact === "hroperationsmanager") return "agm";
  return n;
};

export async function fetchUsers() {
  try {
    let rows = await fetchCollectionDocs("Users");
    if (rows && rows.length) return rows;

    // If REST fallback needs a token, try to fetch one and persist for retry.
    const current = auth.currentUser;
    if (current && typeof current.getIdToken === "function") {
      try {
        const token = await current.getIdToken();
        if (token) {
          try {
            const stored = localStorage.getItem("kp-user");
            const parsed = stored ? JSON.parse(stored) : {};
            parsed.idToken = token;
            localStorage.setItem("kp-user", JSON.stringify(parsed));
          } catch {
            // ignore token persist issues
          }
          rows = await fetchCollectionDocs("Users");
          if (rows && rows.length) return rows;
        }
      } catch {
        // ignore token refresh issues
      }
    }

    // Final fallback to SDK direct read
    const snap = await getDocs(collection(db, "Users"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("fetchUsers failed", e?.message || e);
    return [];
  }
}

export async function fetchUserByUID(uid) {
  const clean = String(uid || "").trim();
  if (!clean) return null;
  try {
    const ref = doc(db, "Users", clean);
    const snap = await Promise.race([
      getDoc(ref),
      new Promise((_, reject) => setTimeout(() => reject(new Error("user fetch timeout")), 2500)),
    ]);
    if (snap.exists()) return { id: snap.id, ...snap.data() };
  } catch {
    // ignore and fallback to REST
  }
  try {
    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const token = stored?.idToken || null;
    const data = await fetchDocumentREST(`Users/${clean}`, token);
    if (!data) return null;
    return { id: clean, ...data };
  } catch {
    return null;
  }
}

export async function upsertUserByUID(uid, payload, actor = "") {
  const clean = String(uid || "").trim();
  if (!clean) throw new Error("Employee UID is required");

  const refDoc = doc(db, "Users", clean);
  let existing = null;
  try {
    existing = await getDoc(refDoc);
  } catch {
    existing = null;
  }

  if (!existing || typeof existing.exists !== "function") {
    try {
      const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
      const token = stored?.idToken;
      const restDoc = await fetchDocumentREST(`Users/${clean}`, token);
      existing = {
        exists: () => !!restDoc,
        data: () => restDoc || {},
      };
    } catch {
      existing = { exists: () => false, data: () => ({}) };
    }
  }

  const roleKey = normalizeRole(payload?.role);
  const level = Number(payload?.hierarchyLevel || ROLE_HIERARCHY[roleKey] || 7);

  const isAdminRole = roleKey === "admin";
  const defaultPermissions = ["Create", "Read", "Update"];
  const adminPermissions = ["Create", "Read", "Update", "Delete"];
  const stripDelete = (perms = []) => perms.filter((p) => String(p).toLowerCase() !== "delete");
  const actorProvidedPermissions = Array.isArray(payload?.permissions);
  const existingPermissions = Array.isArray(existing?.data?.()?.permissions)
    ? existing.data().permissions
    : [];
  const normalizedPermissions = actorProvidedPermissions
    ? (
      isAdminRole
        ? adminPermissions
        : (payload.permissions.length ? stripDelete(payload.permissions) : defaultPermissions)
    )
    : (
      existing.exists()
        ? (existingPermissions.length ? existingPermissions : defaultPermissions)
        : (isAdminRole ? adminPermissions : defaultPermissions)
    );

  const body = {
    uid: clean,
    employeeCode: payload?.employeeCode || payload?.empCode || payload?.empId || payload?.employeeId || "",
    name: payload?.name || "",
    dob: payload?.dob || payload?.dateOfBirth || payload?.birthDate || "",
    address: payload?.address || payload?.Address || payload?.currentAddress || "",
    belongsTo: payload?.belongsTo || payload?.belongs_to || payload?.team || "",
    email: payload?.email || "",
    crmId: payload?.crmId || payload?.crmID || payload?.crmEmail || payload?.crmMailId || "",
    password: payload?.password || "",
    role: payload?.role || "",
    designation: payload?.designation || "",
    state: payload?.state || "",
    sales_zone: payload?.sales_zone || "",
    sales_area: payload?.sales_area || "",
    managerUID: payload?.managerUID || payload?.reportsTo || "",
    reportsTo: payload?.reportsTo || payload?.managerUID || "",
    hierarchyLevel: level,
    officePhone: payload?.officePhone || payload?.phone || "",
    personalPhone: payload?.personalPhone || payload?.altPhone || "",
    emergencyContact: payload?.emergencyContact || payload?.emergencyPhone || "",
    phone: payload?.phone || payload?.officePhone || "",
    uan: payload?.uan || payload?.UAN || "",
    employeeType: payload?.employeeType || payload?.employmentType || "",
    bloodGroup: payload?.bloodGroup || payload?.blood_group || payload?.bloodGroupType || "",
    packageAmount: payload?.packageAmount || payload?.package || payload?.salaryPackage || "",
    joiningDate: payload?.joiningDate || "",
    permissions: normalizedPermissions,
    isActive: isAdminRole ? true : payload?.isActive !== false,
    attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
    profilePhotoUrl: payload?.profilePhotoUrl || payload?.profilePhoto || payload?.photoURL || "",
    profilePhotoPath: payload?.profilePhotoPath || "",
    updatedAt: serverTimestamp(),
    updatedBy: actor || "",
  };

  if (!existing.exists()) {
    body.createdAt = serverTimestamp();
    body.createdBy = actor || "";
  }

  const exists = !!existing.exists();
  const previous = exists ? (existing.data() || {}) : {};

  const buildUpdateBody = () => {
    const next = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === "createdAt" || k === "createdBy") continue;
      if (v === "" && (previous?.[k] === undefined || previous?.[k] === null || previous?.[k] === "")) continue;
      if (!areEqual(previous?.[k], v)) {
        next[k] = v;
      }
    }

    // keep metadata update only when no business fields changed
    next.updatedAt = serverTimestamp();
    next.updatedBy = actor || "";
    return next;
  };

  const sdkPayload = exists ? buildUpdateBody() : body;

  try {
    if (exists) {
      const changedKeys = Object.keys(sdkPayload).filter((k) => k !== "updatedAt" && k !== "updatedBy");
      if (!changedKeys.length) return clean;
      await updateDoc(refDoc, sdkPayload);
    } else {
      await setDoc(refDoc, sdkPayload, { merge: true });
    }
    return clean;
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    const isPermission = msg.includes("permission") || msg.includes("insufficient");
    if (!isPermission) throw e;

    const restBodyRaw = {
      ...sdkPayload,
      updatedAt: new Date().toISOString(),
      createdAt: exists ? undefined : new Date().toISOString(),
    };
    const restBody = Object.fromEntries(
      Object.entries(restBodyRaw).filter(([, v]) => v !== undefined)
    );

    if (exists) {
      const changedKeys = Object.keys(restBody).filter((k) => k !== "updatedAt" && k !== "updatedBy");
      if (!changedKeys.length) return clean;
    }

    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const token = stored?.idToken;
    if (exists) {
      await updateDocumentREST("Users", clean, restBody, token);
    } else {
      await createDocumentREST("Users", restBody, token, clean);
    }
  }
  return clean;
}

export async function deleteUserByUID(uid) {
  const clean = String(uid || "").trim();
  if (!clean) throw new Error("Employee UID is required");

  const refDoc = doc(db, "Users", clean);
  try {
    await deleteDoc(refDoc);
    return clean;
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    const isPermission = msg.includes("permission") || msg.includes("insufficient");
    if (!isPermission) throw e;

    const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
    const token = stored?.idToken;
    await deleteDocumentREST("Users", clean, token);
    return clean;
  }
}

export async function fetchZonesByState(state) {
  const s = String(state || "").trim();
  if (!s) return [];
  if (isKnownState(s)) {
    return getZoneOptions(s).map((name) => ({ id: normalizeForCompare(name), name }));
  }
  const q = query(collection(db, "sales_zones"), where("state", "==", s), where("isActive", "==", true));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function fetchAreasByZone(state, zoneName) {
  const s = String(state || "").trim();
  const z = String(zoneName || "").trim();
  if (!s || !z) return [];
  if (isKnownState(s)) {
    return getAreaOptions(s, z).map((name) => ({ id: normalizeForCompare(name), name }));
  }
  const q = query(
    collection(db, "sales_areas"),
    where("state", "==", s),
    where("zoneName", "==", z),
    where("isActive", "==", true)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function getManagerCandidates(users, role, state, zone, area) {
  const r = normalizeRole(role);
  const rows = Array.isArray(users) ? users : [];

  if (r === "consultant") {
    return rows.filter(
      (u) => normalizeRole(u.role) === "area_sales_manager" && String(u.sales_area || "") === String(area || "")
    );
  }

  if (r === "telecaller") {
    if (area) {
      return rows.filter(
        (u) => normalizeRole(u.role) === "area_sales_manager" && String(u.sales_area || "") === String(area || "")
      );
    }
    if (zone) {
      return rows.filter(
        (u) =>
          (normalizeRole(u.role) === "area_sales_manager" || normalizeRole(u.role) === "zonal_manager") &&
          String(u.sales_zone || "") === String(zone || "")
      );
    }
    return rows.filter((u) => ["area_sales_manager", "zonal_manager"].includes(normalizeRole(u.role)));
  }

  if (r === "area_sales_manager") {
    return rows.filter(
      (u) => normalizeRole(u.role) === "zonal_manager" && String(u.sales_zone || "") === String(zone || "")
    );
  }

  if (r === "zonal_manager") {
    return rows.filter(
      (u) => normalizeRole(u.role) === "state_head" && String(u.state || "") === String(state || "")
    );
  }

  if (r === "state_head") {
    return rows.filter((u) => normalizeRole(u.role) === "sales_head");
  }

  if (r === "sales_head") {
    return rows.filter((u) => normalizeRole(u.role) === "director");
  }

  return [];
}

export function buildOrganizationTree(users) {
  const rows = Array.isArray(users) ? users : [];
  const byId = new Map();
  const byKey = new Map();
  const roots = [];

  const normalizeKey = (v) => String(v || "").trim().toLowerCase();
  const addLookup = (k, node) => {
    const key = normalizeKey(k);
    if (!key) return;
    byKey.set(key, node);
  };

  rows.forEach((u) => {
    const node = { ...u, children: [] };
    byId.set(node.id, node);
  });

  byId.forEach((node) => {
    addLookup(node.id, node);
    addLookup(node.uid, node);
    addLookup(node.email, node);
    addLookup(node.employeeCode || node.empCode || node.empId || node.employeeId, node);
  });

  byId.forEach((node) => {
    const managerKeys = [
      node.managerUID,
      node.managerUid,
      node.managerId,
      node.manager_id,
      node.managerEmail,
      node.reportsTo,
      node.reportingTo,
      node.reporting_to,
      node.reports_to,
    ];

    const parent = managerKeys
      .map((x) => byKey.get(normalizeKey(x)))
      .find((p) => p && p.id !== node.id);

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortTree = (arr) => {
    arr.sort((a, b) => {
      const d = Number(a.hierarchyLevel || 99) - Number(b.hierarchyLevel || 99);
      if (d !== 0) return d;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    arr.forEach((n) => sortTree(n.children));
  };

  sortTree(roots);

  const directorRoots = roots.filter((r) => normalizeRole(r.role) === "director");
  if (directorRoots.length) return directorRoots;

  const allDirectors = Array.from(byId.values()).filter((n) => normalizeRole(n.role) === "director");
  if (allDirectors.length) return allDirectors;

  return roots;
}

export async function uploadEmployeeAttachment(uid, file, type = "Document") {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) throw new Error("Employee UID required");
  if (!file) throw new Error("File required");

  const safeName = `${Date.now()}_${file.name}`;
  const storagePath = `employees/${cleanUid}/documents/${safeName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const item = {
    id: `att_${Date.now()}`,
    fileName: file.name,
    url,
    storagePath,
    type,
    uploadedAt: new Date().toISOString(),
  };

  const userRef = doc(db, "Users", cleanUid);
  const snap = await getDoc(userRef);
  const existing = snap.exists() ? snap.data() : {};
  const attachments = Array.isArray(existing.attachments) ? existing.attachments : [];

  await setDoc(
    userRef,
    {
      attachments: [...attachments, item],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return item;
}

export async function deleteEmployeeAttachment(uid, attachmentId) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid || !attachmentId) return;

  const userRef = doc(db, "Users", cleanUid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const target = attachments.find((a) => a.id === attachmentId);

  if (target?.storagePath) {
    await deleteObject(ref(storage, target.storagePath));
  }

  await updateDoc(userRef, {
    attachments: attachments.filter((a) => a.id !== attachmentId),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEmployeeProfilePhoto(uid) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) throw new Error("Employee UID required");

  const userRef = doc(db, "Users", cleanUid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const storagePath = data.profilePhotoPath || "";

  if (storagePath) {
    try {
      await deleteObject(ref(storage, storagePath));
    } catch {
      // ignore delete errors
    }
  }

  await updateDoc(userRef, {
    profilePhotoUrl: "",
    profilePhotoPath: "",
    updatedAt: serverTimestamp(),
  });
}

export async function uploadEmployeeProfilePhoto(uid, file) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) throw new Error("Employee UID required");
  if (!file) throw new Error("File required");

  const safeName = `${Date.now()}_${file.name}`;
  const storagePath = `employees/${cleanUid}/profile/${safeName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const userRef = doc(db, "Users", cleanUid);
  const snap = await getDoc(userRef);
  const existing = snap.exists() ? snap.data() : {};
  const prevPath = existing.profilePhotoPath || "";

  await setDoc(
    userRef,
    {
      profilePhotoUrl: url,
      profilePhotoPath: storagePath,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (prevPath && prevPath !== storagePath) {
    try {
      await deleteObject(ref(storage, prevPath));
    } catch {
      // ignore delete errors (file may not exist)
    }
  }

  return { url, storagePath };
}
