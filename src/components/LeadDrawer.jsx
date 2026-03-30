// src/components/LeadDrawer.jsx
import React, { useState, useEffect, useRef } from "react";
import { db, serverTimestamp } from "../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  deleteDoc,
  setDoc,
  query,
  where,
  getDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { usePermission } from "../hooks/usePermission";
import { useAuth } from "../context/AuthContext";
import SearchableSelect from "./Universal/SearchableSelect";
import { getAreaOptions, getStateOptions, getZoneOptions, isAreaInZone, isZoneInState } from "../helpers/salesRegions";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";
import { isAdminSessionUser } from "../helpers/bulkImport";
import { isZonalManagerField, ZONAL_MANAGER_NAMES } from "../helpers/zonalManagers";


/* ⭐ ADDED: prettyLabel function */
function prettyLabel(name) {
  if (!name) return "";
  return name
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
// 🔐 NORMALIZER FOR STATE / ZONE / AREA (MANDATORY)
const normalizeScope = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

const pickScopedDisplay = (rawValue, labelValue) => {
  const raw = String(rawValue || "").trim();
  const label = String(labelValue || "").trim();
  if (!label) return raw;
  if (!raw) return label;
  return normalizeScope(raw) === normalizeScope(label) ? label : raw;
};

// ⭐ KPI formatter (SAFE, reusable)
function normalizeKPI(input) {
  if (!input) return "";

  const raw = input.toString().toUpperCase().replace(/[^0-9]/g, "");
  if (!raw) return "";

  return `KPI-${raw.padStart(3, "0")}`;
}

const LeadDrawer = ({ onClose, onLeadAdded, existingLead, refreshLeads }) => {
  const auth = getAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [consultants, setConsultants] = useState([]);
  const [teleUsers, setTeleUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const moveInProgress = useRef(false);
  const isEdit = !!existingLead;
  const perm = usePermission("leads");
  const { user: ctxUser } = useAuth();
  const isAdmin = isAdminSessionUser() || !!perm?.delete;

const userLS = JSON.parse(localStorage.getItem("kp-user") || "{}");

const normalizeUserRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const normalizedUserRole = normalizeUserRole(
  ctxUser?.role ||
    ctxUser?.Role ||
    userLS?.role ||
    userLS?.Role ||
    userLS?.designation ||
    userLS?.Designation ||
    userLS?.profile?.role ||
    userLS?.profile?.Role
);

const canonicalUserRole = (() => {
  const compact = normalizedUserRole.replace(/_/g, "");
  if (compact === "financemanager" || compact === "finance") return "dgm";
  if (compact === "hroperationsmanager") return "agm";
  if (compact === "saleshead") return "sales_head";
  if (compact === "director") return "director";
  if (compact === "agm") return "agm";
  if (compact === "dgm") return "dgm";
  if (compact === "admin") return "admin";
  return normalizedUserRole;
})();

const KPI_EDIT_ALLOWED_ROLES = new Set([
  "admin",
  "sales_head",
  "director",
  "agm",
  "dgm",
]);

const canEditKPI =
  KPI_EDIT_ALLOWED_ROLES.has(canonicalUserRole) ||
  isAdmin ||
  String(ctxUser?.email || userLS?.email || "").trim().toLowerCase() === "loan@kapilpower.com" ||
  String(ctxUser?.uid || userLS?.uid || "").trim() === "26VHcREEDMMg8C24kXYVGzRXHe43";


  // --- dynamic fields support ---
  const [fieldsDef, setFieldsDef] = useState([]); 
  const [layoutDef, setLayoutDef] = useState([]); 

  const STATIC_FIELD_NAMES = [
    "name",
    "phone",
    "email",
    "location",
    "locationLink",
    "projectType",
    "teleSale",
    "assignedConsultant",
    "status",
    "siteVisitArranged",
    "siteVisitArrangedDate",
  ];

  const [lead, setLead] = useState({
    name: "",
    phone: "",
    email: "",
    location: "",
    locationLink: "",
    projectType: "Residential",
    teleSale: "",
    assignedConsultant: "",
    status: "new",
    siteVisitArranged: "no",
    siteVisitArrangedDate: "",
  });
  const activeKpiId =
    normalizeKPI(lead?.autoId || existingLead?.autoId) ||
    (isEdit ? "-" : "Will be generated on save");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) =>
      setCurrentUser(user || null)
    );
    return () => unsub();
  }, []);

  // ⭐ load crm_fields/leads
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const ref = doc(db, "crm_fields", "leads");
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          if (!mounted) return;
          setFieldsDef([]);
          setLayoutDef([]);
          return;
        }

        const data = snap.data() || {};
        const defs = Array.isArray(data.fields) ? data.fields : [];

        const normalized = defs.map((f) =>
          typeof f === "string"
            ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [], default: "" }
            : { ...(f || {}), options: f.options || [], default: f.default ?? "" }
        );

        if (!mounted) return;

        setFieldsDef(normalized);
        setLayoutDef(Array.isArray(data.layout) ? data.layout : []);

        // initialize missing defaults
        setLead((prev) => {
          const next = { ...prev };
          normalized.forEach((fd) => {
            if (next[fd.name] === undefined) {
              if (fd.type === "checkbox") next[fd.name] = !!fd.default;
              else if (fd.type === "multiselect") next[fd.name] = Array.isArray(fd.default) ? fd.default : [];
              else next[fd.name] = fd.default ?? "";
            }
          });
          next.status = next.status ?? "new";
          next.siteVisitArranged = next.siteVisitArranged ?? "no";
          return next;
        });
      } catch (err) {
        console.error("Failed to load crm_fields/leads", err);
      }
    })();

    return () => (mounted = false);
  }, []);

  // ⭐ Populate existing lead data
  useEffect(() => {
    if (isEdit && existingLead) {
      setLead((prev) => ({
        ...prev,
        autoId: normalizeKPI(existingLead.autoId),
        ...existingLead,
        projectType: existingLead.projectType || prev.projectType || "Residential",
        state: pickScopedDisplay(existingLead.state, existingLead.state_label) || prev.state || "",
        sales_zone: pickScopedDisplay(existingLead.sales_zone, existingLead.sales_zone_label) || prev.sales_zone || "",
        sales_area: pickScopedDisplay(existingLead.sales_area, existingLead.sales_area_label) || prev.sales_area || "",
      }));
    }
  }, [existingLead, isEdit]);

  useEffect(() => {
    if (!lead.state) return;
    if (lead.sales_zone && !isZoneInState(lead.state, lead.sales_zone)) {
      setLead((prev) => ({ ...prev, sales_zone: "", sales_area: "" }));
    }
  }, [lead.state, lead.sales_zone]);

  useEffect(() => {
    if (!lead.state || !lead.sales_zone) return;
    if (lead.sales_area && !isAreaInZone(lead.state, lead.sales_zone, lead.sales_area)) {
      setLead((prev) => ({ ...prev, sales_area: "" }));
    }
  }, [lead.state, lead.sales_zone, lead.sales_area]);

// load consultants
useEffect(() => {
  const fetchConsultants = async () => {
    try {
      const normalizeRole = (v) =>
        String(v || "")
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_");
      const rows = await fetchCollectionDocs("Users");
      const users = (rows || []).map((d) => ({
        id: d.id,
        name: d.Name || d.name,
        email: d.email,
        role: normalizeRole(d.role || d.Role || d.designation || d.Designation),
      }));

      const assignable = users.filter((u) =>
        u.role?.includes("consultant") ||
        [
          "consultant",
          "area_sales_manager",
          "zonal_manager",
          "team_manager",
          "team_lead",
          "sales_head",
        ].includes(u.role)
      );

      const teleList = users.filter((u) =>
        [
          "tele_caller",
          "telecaller",
          "telesales",
          "tele_sales",
          "team_lead",
          "team_manager",
        ].includes(u.role) ||
        String(u.role || "").includes("tele")
      );

      setConsultants(assignable);
      setTeleUsers(teleList);
    } catch (e) {
      console.error("fetchConsultants error", e);
    }
  };
  fetchConsultants();
}, []);

  const generateNextKPI = async () => {
    const cols = ["leads", "deals", "salesOrders"];
    let max = 0;

    for (const c of cols) {
      const rows = await fetchCollectionDocs(c);
      (rows || []).forEach((d) => {
        const x = d.autoId || d.kpiId;
        if (x?.startsWith("KPI-")) {
          const n = parseInt(x.split("-")[1]);
          if (!isNaN(n) && n > max) max = n;
        }
      });
    }
    return `KPI-${String(max + 1).padStart(3, "0")}`;
  };

  // --- Move Lead to Deals (unchanged) ---
// ✅ FINAL & SAFE: Lead → Deal (NO DUPLICATES)
const moveLeadToDeals = async (leadData) => {
  if (moveInProgress.current) return;
  moveInProgress.current = true;

  try {
    const { autoId } = leadData;
    if (!autoId) return;

    // 🔒 Use KPI-ID as Deal document ID (guarantees uniqueness)
const dealRef = doc(db, "deals", autoId);

// 🚫 HARD BLOCK: if ANY deal already exists with same KPI anywhere
const q = query(
  collection(db, "deals"),
  where("kpiId", "==", autoId)
);
const snap = await getDocs(q);

if (!snap.empty) {
  console.warn("❌ Duplicate KPI detected. Deal creation blocked:", autoId);
  return;
}


    // -------- Get Consultant Name --------
    let consultantName = "";
    if (leadData?.assignedConsultant) {
      const users = await fetchCollectionDocs("Users");
      const assignedEmail = String(leadData.assignedConsultant || "").trim().toLowerCase();
      (users || []).forEach((d) => {
        const userEmail = String(d?.email || "").trim().toLowerCase();
        if (userEmail && userEmail === assignedEmail) {
          consultantName = d?.Name || d?.name || "";
        }
      });
    }

const payload = {
  // ✅ keep full lead data in deal (including custom fields)
  ...leadData,

    // 🔐 NORMALIZED FIELDS
  state: normalizeScope(leadData.state),
  sales_zone: normalizeScope(leadData.sales_zone),
  sales_area: normalizeScope(leadData.sales_area),

  // 👁 LABEL FIELDS
  state_label: leadData.state || "",
  sales_zone_label: leadData.sales_zone || "",
  sales_area_label: leadData.sales_area || "",


  // ✅ preserve both source + lead_source (backward + forward compatibility)
  source: leadData.source || leadData.lead_source || "",
  lead_source: leadData.lead_source || leadData.source || "",

  consultantName,
  autoId,
  kpiId: autoId,
  leadRef: leadData.id || "",
  movedFrom: "leads",
  stage: "Qualification",
  siteVisitArrangedDate: leadData.siteVisitArrangedDate || null,
  createdAt: serverTimestamp(),
  createdBy: currentUser?.email || "",
};


    // ✅ Create Deal (ONLY ONCE)
    await setDoc(dealRef, payload);

    // ✅ Delete Lead after deal creation
    if (leadData.id) {
      await deleteDoc(doc(db, "leads", leadData.id));
    }

    if (refreshLeads) refreshLeads();

    alert(`Lead ${autoId} moved successfully!`);
    onLeadAdded?.();
    onClose?.();

  } catch (err) {
    console.error("Move Lead failed:", err);
    alert("Failed to move lead.");
  } finally {
    moveInProgress.current = false;
  }
};

const handleDeleteRecord = async () => {
  if (!isEdit) return;
  if (!window.confirm("Are you sure? This cannot be undone.")) return;

  try {
    await deleteDoc(doc(db, "leads", existingLead.id));

    alert("Lead deleted successfully");

    if (refreshLeads) refreshLeads();   // 🔥 refresh UI instantly
    onClose();                         // close drawer

  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};

  // ⭐ Save Lead (dynamic fields included)
  const handleSaveLead = async () => {
    // 🚫 Block update if user has no permission
if (isEdit && !perm.update) {
  alert("You do not have permission to update leads.");
  return;
}

// 🚫 Block creation if user has no permission
if (!isEdit && !perm.create) {
  alert("You do not have permission to create leads.");
  return;
}
    if (!lead.name || !lead.phone || !lead.location) {
      alert("Fill Name, Phone & Location");
      return;
    }
    // 🔒 Mandatory business fields
const REQUIRED_DYNAMIC_FIELDS = [
  "source",
  "sales_zone",
  "sales_area",
  "state",
  "projectType",
];

for (const field of REQUIRED_DYNAMIC_FIELDS) {
  if (!lead[field]) {
    alert(`${prettyLabel(field)} is required`);
    return;
  }
}

    if (!currentUser) {
      alert("Login expired");
      return;
    }

    setLoading(true);
    // 🔒 KPI must be unique across LEADS & DEALS
if (lead.autoId) {
  const collectionsToCheck = ["leads", "deals"];

  for (const col of collectionsToCheck) {
    const q = query(
      collection(db, col),
      where("autoId", "==", lead.autoId)
    );

    const snap = await getDocs(q);

    // ✅ Allow same record while editing
    if (!snap.empty) {
      const duplicate = snap.docs.find(
        (d) => !isEdit || d.id !== existingLead?.id
      );

      if (duplicate) {
        alert(`❌ KPI ID ${lead.autoId} already exists in ${col}`);
        setLoading(false);
        return;
      }
    }
  }
}
    // 🔒 Validate KPI format if manually entered
if (lead.autoId && !/^KPI-\d+$/.test(lead.autoId)) {
  alert("Invalid KPI format. Example: KPI-001");
  setLoading(false);
  return;
}
  

    try {
      const selected = consultants.find(
        (c) => c.email === lead.assignedConsultant
      );

      const dynamicFieldData = {};
      fieldsDef.forEach((fd) => {
        if (!STATIC_FIELD_NAMES.includes(fd.name)) {
          dynamicFieldData[fd.name] = lead[fd.name] ?? "";
        }
      });

      const leadData = {
        ...lead,
        ...dynamicFieldData,
          // 🔐 NORMALIZED FIELDS (FOR SCOPED QUERIES)
  state: normalizeScope(lead.state),
  sales_zone: normalizeScope(lead.sales_zone),
  sales_area: normalizeScope(lead.sales_area),

  // 👁 LABEL FIELDS (FOR UI)
  state_label: lead.state || "",
  sales_zone_label: lead.sales_zone || "",
  sales_area_label: lead.sales_area || "",
        consultantName: selected?.name || "",
        updatedAt: serverTimestamp(),
        updatedBy:
  currentUser.displayName ||
  currentUser.email ||
  "",
      };

if (isEdit) {

  // 🔒 REQUIRED VALIDATION
  if (
    leadData.siteVisitArranged === "yes" &&
    !leadData.siteVisitArrangedDate
  ) {
    alert("Please select Site Visit Arranged Date");
    return;
  }

  await updateDoc(doc(db, "leads", existingLead.id), leadData);

  if (leadData.siteVisitArranged === "yes") {
    await moveLeadToDeals({
      id: existingLead.id,
      ...existingLead,
      ...leadData,
      siteVisitArrangedDate: leadData.siteVisitArrangedDate,
    });
    return; // ⛔ STOP here (lead is moved)
  }

  alert("Lead updated!");
      } else {
        const autoId =
  lead.autoId?.trim() || (await generateNextKPI());


        const newLead = {
          ...leadData,
          autoId,
          createdAt: serverTimestamp(),
          createdBy: {
  uid: currentUser.uid,
  email: currentUser.email,
  name: currentUser.displayName || "",
},
          ownerUid: currentUser.uid,
          status: "new",
        };

        const ref = await addDoc(collection(db, "leads"), newLead);

        if (leadData.siteVisitArranged === "yes") {
          await moveLeadToDeals({ id: ref.id, ...newLead });
        }

        alert(`Lead added with ID ${autoId}`);
      }

      onLeadAdded?.();
      setTimeout(onClose, 200);
    } catch (err) {
      alert("Failed to save lead.");
    }
    finally {
      setLoading(false);
    }
  };

  // input renderer (unchanged)
  const renderDynamicInput = (fd) => {
    const val = lead[fd.name] ?? "";
    const commonStyle = {
      padding: "8px 10px",
      borderRadius: 8,
      border: "1px solid rgba(128,0,0,0.35)",
      color: "#111827",
      width: "100%",
      fontSize: 13,
      background: "#fff",
    };

    const fieldKey = String(fd.name || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    const isStateField = fieldKey === "state";
    const isZoneField = fieldKey === "saleszone" || fieldKey === "zone";
    const isAreaField = fieldKey === "salesarea";

    if (isStateField) {
      const states = getStateOptions();
      return (
        <select
          id={fd.name}
          value={val ?? ""}
          onChange={(e) =>
            setLead({
              ...lead,
              state: e.target.value,
              state_label: e.target.value,
              sales_zone: "",
              sales_zone_label: "",
              sales_area: "",
              sales_area_label: "",
            })
          }
          style={commonStyle}
        >
          <option value="">Select</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      );
    }

    if (isZoneField) {
      const zones = getZoneOptions(lead.state);
      return (
        <select
          id={fd.name}
          value={val ?? ""}
          onChange={(e) =>
            setLead({
              ...lead,
              sales_zone: e.target.value,
              sales_zone_label: e.target.value,
              sales_area: "",
              sales_area_label: "",
            })
          }
          style={commonStyle}
          disabled={!lead.state}
        >
          <option value="">Select</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      );
    }

    if (isAreaField) {
      const areas = getAreaOptions(lead.state, lead.sales_zone);
      return (
        <select
          id={fd.name}
          value={val ?? ""}
          onChange={(e) =>
            setLead({
              ...lead,
              sales_area: e.target.value,
              sales_area_label: e.target.value,
            })
          }
          style={commonStyle}
          disabled={!lead.state || !lead.sales_zone}
        >
          <option value="">Select</option>
          {areas.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      );
    }

    const t = (fd.type || "text").toLowerCase();

    switch (t) {
      case "textarea":
        return (
          <textarea
            id={fd.name}
            value={val}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            rows={3}
            style={{ ...commonStyle, minHeight: 80 }}
          />
        );

      case "date":
        return (
          <input
            id={fd.name}
            type="date"
            value={val ? String(val).split("T")[0] : ""}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            style={commonStyle}
          />
        );

      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={!!val}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.checked })}
          />
        );

      case "select":
      case "picklist":
        if (isZonalManagerField(fd.name)) {
          return (
            <select
              id={fd.name}
              value={val ?? ""}
              onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
              style={commonStyle}
            >
              <option value="">Select</option>
              {ZONAL_MANAGER_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          );
        }

        if (fd.name === "teleSale") {
          return (
            <SearchableSelect
              options={teleUsers}
              value={val ?? ""}
              onChange={(next) => setLead({ ...lead, [fd.name]: next || "" })}
              placeholder="Search Tele-Caller / Team Lead"
              getOptionValue={(u) => u.name || u.email || u.id}
              getOptionLabel={(u) => `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}`}
              getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""}`}
              allowClear
            />
          );
        }

        return (
          <select
            id={fd.name}
            value={val ?? ""}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            style={commonStyle}
          >
            <option value="">Select</option>
            {fd.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );

      case "multiselect":
        return (
          <input
            placeholder="comma separated"
            value={Array.isArray(val) ? val.join(",") : val}
            onChange={(e) =>
              setLead({
                ...lead,
                [fd.name]: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            style={commonStyle}
          />
        );

      default:
        return (
          <input
            id={fd.name}
            type="text"
            value={val}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            style={commonStyle}
          />
        );
    }
  };
  if (perm.loading) {
  return (
    <p style={{ padding: 20, color: "#800000" }}>
      Checking permissions...
    </p>
  );
}

if (!perm.read) {
  return (
    <div style={{ padding: 30, textAlign: "center", color: "#800000" }}>
      <h2>🚫 Access Denied</h2>
      <p>You do not have permission to view Leads.</p>
    </div>
  );
}

  return (
    <div style={styles.overlay}>
      <div style={styles.drawer}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>{isEdit ? "Edit Lead" : "Add Lead"}</h2>
            <div style={styles.kpiBadge}>KPI ID: {activeKpiId}</div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            ✖
          </button>
        </div>

        <div style={styles.formContainer}>
          <div style={styles.form}>
            {fieldsDef.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontWeight: 700,
                    color: "#800000",
                    marginBottom: 8,
                  }}
                >
                  Dynamic Fields
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  {[...fieldsDef]
                    .filter((fd) => !STATIC_FIELD_NAMES.includes(fd.name))
                    .sort((a, b) => {
                      const key = (x) =>
                        String(x?.name || "")
                          .trim()
                          .toLowerCase()
                          .replace(/[\s_-]+/g, "");
                      const tailOrder = ["salesarea", "saleszone", "state", "zonalmanager"];
                      const ai = tailOrder.indexOf(key(a));
                      const bi = tailOrder.indexOf(key(b));
                      const aTail = ai !== -1;
                      const bTail = bi !== -1;
                      if (aTail !== bTail) return aTail ? 1 : -1;
                      if (!aTail && !bTail) return 0;
                      return ai - bi;
                    })
                    .map((fd) => (
                      <div key={fd.name} style={styles.inputGroup}>
                        <label style={styles.label}>
                          {fd.label}
                          {fd.required ? " *" : ""}
                        </label>
                        {renderDynamicInput(fd)}
                      </div>
                    ))}
                </div>
              </div>
            )}

{/* ⭐ KPI ID (Admin / Sales Head only) */}
{canEditKPI && (
  <div style={styles.inputGroup}>
    <label style={styles.label}>KPI ID</label>
    <input
  type="text"
 value={
  lead.autoId
    ? lead.autoId.startsWith("KPI-")
      ? lead.autoId
      : lead.autoId
    : ""
}
  placeholder="KPI-001"
 onChange={(e) => {
  const digits = e.target.value.replace(/\D/g, "");
  setLead({
    ...lead,
    autoId: digits,
  });
}}
onBlur={() => {
  if (lead.autoId) {
    setLead((prev) => ({
      ...prev,
      autoId: normalizeKPI(prev.autoId),
    }));
  }
}}
  style={styles.input}
/>
  </div>
)}

            {/* STATIC FIELDS (unchanged) */}
            {[
  { label: "Customer Name*", name: "name" },
  { label: "Contact Number*", name: "phone" },
  { label: "Email", name: "email" },
  { label: "Location*", name: "location" },
  { label: "Google Maps Link", name: "locationLink" },
].map((f) => (
  <div key={f.name} style={styles.inputGroup}>
    <label style={styles.label}>{f.label}</label>

    {/* ⭐ TELESALES DROPDOWN */}
    {f.name === "teleSale" ? (
      <select
        name="teleSale"
        value={lead.teleSale || ""}
        onChange={(e) =>
          setLead({ ...lead, teleSale: e.target.value })
        }
        style={styles.select}
      >
        <option value="">Select Tele-Caller / Team Lead</option>
        {teleUsers.map((u) => (
          <option key={u.email || u.name} value={u.name || u.email}>
            {u.name || u.email}
          </option>
        ))}
      </select>
    ) : (
      <input
        name={f.name}
        value={lead[f.name] || ""}
        onChange={(e) =>
          setLead({ ...lead, [e.target.name]: e.target.value })
        }
        style={styles.input}
      />
    )}
  </div>
))}

            <div style={styles.inputGroup}>
              <label style={styles.label}>Tele Sale</label>
              <SearchableSelect
                options={teleUsers}
                value={lead.teleSale || ""}
                onChange={(next) => setLead({ ...lead, teleSale: next || "" })}
                placeholder="Search Tele-Caller / Team Lead"
                getOptionValue={(u) => u.name || u.email || u.id}
                getOptionLabel={(u) => `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}`}
                getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""}`}
                allowClear
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Project Type*</label>
              <select
                name="projectType"
                value={lead.projectType || "Residential"}
                onChange={(e) => setLead({ ...lead, projectType: e.target.value })}
                style={styles.select}
              >
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
              </select>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Site Visit Arranged</label>
              <select
                name="siteVisitArranged"
                value={lead.siteVisitArranged}
                onChange={(e) =>
                  setLead({ ...lead, siteVisitArranged: e.target.value })
                }
                style={styles.select}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>

            {lead.siteVisitArranged === "yes" && (
  <div style={styles.inputGroup}>
    <label style={styles.label}>
      Site Visit Arranged Date *
    </label>
    <input
      type="date"
      value={lead.siteVisitArrangedDate || ""}
      onChange={(e) =>
        setLead({
          ...lead,
          siteVisitArrangedDate: e.target.value,
        })
      }
      style={styles.input}
    />
  </div>
)}


            <div style={styles.inputGroup}>
              <label style={styles.label}>Assigned Consultant</label>
              <SearchableSelect
                options={consultants}
                value={lead.assignedConsultant}
                onChange={(next) =>
                  setLead({ ...lead, assignedConsultant: next || "" })
                }
                placeholder="Search consultant by name or email"
                getOptionValue={(c) => c.email || c.name || c.id}
                getOptionLabel={(c) => `${c.name || c.email}${c.email && c.name ? ` (${c.email})` : ""}`}
                getOptionSearchText={(c) => `${c.name || ""} ${c.email || ""}`}
                allowClear
              />
            </div>
          </div>
        </div>

        <div style={styles.buttonGroup}>
          {isAdmin && isEdit && (
            <button
              onClick={handleDeleteRecord}
              style={styles.deleteBtn}
            >
              Delete Lead
            </button>
          )}
          <button
  onClick={handleSaveLead}
  style={styles.addBtn}
  disabled={
    loading ||
    (isEdit && !perm.update) ||
    (!isEdit && !perm.create)
  }
>
  {loading ? "Saving..." : isEdit ? "Save Changes" : "Add Lead"}
</button>

          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadDrawer;

/* --- Styles unchanged --- */
const styles = {
  overlay: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    background: "rgba(128,0,0,0.4)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 999,
  },
  drawer: {
    background: "#fff",
    width: "min(620px, 100vw)",
    height: "100%",
    boxShadow: "-4px 0 12px rgba(128,0,0,0.3)",
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    padding: 20,
    borderBottom: "1px solid rgba(128,0,0,0.2)",
  },
  title: {
    fontSize: 20,
    color: "#800000",
    fontWeight: 700,
  },
  kpiBadge: {
    display: "inline-block",
    marginTop: 6,
    background: "#fff7e6",
    color: "#800000",
    border: "1px solid #f3d7a8",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: "#800000",
    cursor: "pointer",
  },
  formContainer: {
    flex: 1,
    overflowY: "auto",
    padding: "0 20px 80px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
  },
  label: {
    color: "#800000",
    fontWeight: 600,
    marginBottom: 6,
    fontSize: 13,
  },
  input: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(128,0,0,0.35)",
    color: "#111827",
    fontSize: 13,
    background: "#fff",
  },
  select: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(128,0,0,0.35)",
    color: "#111827",
    fontSize: 13,
    background: "#fff",
  },
  buttonGroup: {
    padding: 12,
    display: "flex",
    gap: 10,
    borderTop: "1px solid rgba(128,0,0,0.2)",
    background: "#fff",
    position: "sticky",
    bottom: 0,
  },
  addBtn: {
    flex: 1,
    background: "#800000",
    color: "#fff",
    border: "none",
    padding: 10,
    borderRadius: 6,
    fontWeight: 700,
    cursor: "pointer",
  },
  cancelBtn: {
    flex: 1,
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    padding: 10,
    borderRadius: 6,
    fontWeight: 700,
    cursor: "pointer",
  },
  deleteBtn: {
    flex: 1,
    background: "linear-gradient(135deg, #b91c1c, #dc2626)",
    color: "#fff",
    border: "none",
    padding: 10,
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(185,28,28,0.25)",
  },
};
