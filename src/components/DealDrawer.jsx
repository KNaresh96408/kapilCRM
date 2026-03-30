// ✅ src/components/DealDrawer.jsx (FINAL WITH DYNAMIC FIELDS — STATIC LOGIC UNTOUCHED)
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  getDoc,
  onSnapshot,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { usePermission } from "../hooks/usePermission";
import { getAreaOptions, getStateOptions, getZoneOptions, isAreaInZone, isZoneInState } from "../helpers/salesRegions";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";
import SearchableSelect from "./Universal/SearchableSelect";
import { isAdminSessionUser } from "../helpers/bulkImport";
import AttachmentFolderTiles from "../modules/attachments/AttachmentFolderTiles";
import QuotationPreview from "./QuotationPreview";
import { resolveQuoteNo } from "../helpers/quotationNumber";
import { isZonalManagerField, ZONAL_MANAGER_NAMES } from "../helpers/zonalManagers";



/* ============================================================
   ⭐ Helper: Pretty label (same as Leads)
   ============================================================ */
function prettyLabel(name) {
  if (!name) return "";
  return name
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
// 🔐 NORMALIZER (SAME AS LEADS)
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

const normalizeKPI = (input) => {
  const raw = String(input || "")
    .toUpperCase()
    .replace(/[^0-9]/g, "");
  if (!raw) return "";
  return `KPI-${raw.padStart(3, "0")}`;
};

const normalizeDealStage = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (["deal won", "closed won", "won"].includes(normalized)) return "Won";
  if (["lost", "closed lost", "lost to competition"].includes(normalized)) return "Lost";
  if (normalized === "qualification") return "Qualification";
  if (normalized === "negotiation") return "Negotiation";
  if (normalized === "hold") return "Hold";
  if (normalized === "potential customer") return "Potential Customer";
  if (normalized === "proposal") return "Proposal";

  return value || "Qualification";
};

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const ALLOWED_DELETE_ROLES = new Set(["admin", "director", "sales_head", "agm", "dgm"]);

const getSessionRoleCandidates = () => {
  try {
    const raw = localStorage.getItem("kp-user");
    const parsed = raw ? JSON.parse(raw) : {};
    return [
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
  } catch {
    return [];
  }
};

const pickSiteVisitKeys = (defs = []) => {
  const names = defs
    .map((f) => (typeof f === "string" ? f : f?.name))
    .filter(Boolean);

  const isCompleted = (n) =>
    n.includes("site") && n.includes("visit") && n.includes("completed");
  const isArranged = (n) =>
    n.includes("site") &&
    n.includes("visit") &&
    (n.includes("arranged") || n.includes("scheduled") || n.includes("rescheduled"));

  const completedKey = names.find((n) => isCompleted(normalizeScope(n))) || "";
  const arrangedKey = names.find((n) => isArranged(normalizeScope(n))) || "";

  return { completedKey, arrangedKey };
};

/* ============================================================
   ⭐ FIX DUPLICATE DEALS (unchanged)
   ============================================================ */
const deleteDuplicateDealsByKPI = async (autoId) => {
  if (!autoId) return;

  try {
    const dealsRef = collection(db, "deals");
    const q = query(dealsRef, where("autoId", "==", autoId));
    const snapshot = await getDocs(q);

    if (snapshot.size > 1) {
      const keeperId = autoId;
      for (const d of snapshot.docs) {
        if (d.id !== keeperId) {
          const ref = doc(db, "deals", d.id);
          await setDoc(ref, { _systemDelete: true }, { merge: true });
          await deleteDoc(ref);
        }
      }
    }
  } catch (err) {
    console.error("Error in deleteDuplicateDealsByKPI:", err);
  }
};

const DealDrawer = (props) => {
  const perm = usePermission("deals");

  if (perm.loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
        Checking permissions…
      </div>
    );
  }

  // NEW DEAL — needs CREATE
  if (!props.existingDeal && !perm.create) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
        <h2>🚫 Access Denied</h2>
        <p>You do not have permission to create Deals.</p>
        <button onClick={props.onClose}>Close</button>
      </div>
    );
  }

  // EDIT DEAL — needs UPDATE
  if (props.existingDeal && !perm.update) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
        <h2>🚫 Access Denied</h2>
        <p>You do not have permission to update Deals.</p>
        <button onClick={props.onClose}>Close</button>
      </div>
    );
  }

  return <DealDrawerInner perm={perm} {...props} />;
};

function DealDrawerInner({
  perm,
  onClose,
  onDealSaved,
  existingDeal,
  refreshDeals
}) {
  const isMobileView = typeof window !== "undefined" && window.innerWidth <= 768;
  const auth = getAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [consultants, setConsultants] = useState([]);
  const [teleUsers, setTeleUsers] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [showAttachments, setShowAttachments] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showQuotations, setShowQuotations] = useState(false);
  const [savedQuotations, setSavedQuotations] = useState([]);
  const [activeQuotation, setActiveQuotation] = useState(null);
  const [formScrollEl, setFormScrollEl] = useState(null);

  /* ============================================================
     ⭐ ADD: Dynamic fields state
     ============================================================ */
  const [fieldsDef, setFieldsDef] = useState([]); // dynamic fields
  const [layoutDef, setLayoutDef] = useState([]); // not used now but kept for layout support
  const [siteVisitKeys, setSiteVisitKeys] = useState({
    completedKey: "",
    arrangedKey: "",
  });

  const isEdit = !!existingDeal;
  const canDeleteByRole = getSessionRoleCandidates().some((r) => ALLOWED_DELETE_ROLES.has(r));
  const isAdmin = isAdminSessionUser() || canDeleteByRole;
  const openedFromMove = existingDeal?.movedFrom === "leads";

  /* ============================================================
     Existing Deal Object (UNCHANGED)
     ============================================================ */
  const [deal, setDeal] = useState({
    id: "",
    autoId: "",
    name: "",
    phone: "",
    email: "",
    location: "",
    locationLink: "",
    source: "",
    teleSale: "",
    assignedConsultant: "",
    consultantName: "",
    projectType: "Residential",
    capacity: "",
    expectedRevenue: "",
    stage: "Qualification",
    createdAt: null,
  });
  const activeKpiId = deal?.autoId || existingDeal?.autoId || "Will be generated on save";

    /* ============================================================
      Auth Listener (UNCHANGED)
      ============================================================ */
    useEffect(() => {
     const unsub = auth.onAuthStateChanged((u) => setCurrentUser(u));
     return () => unsub();
    }, []);

    /* ============================================================
      Existing Lead-to-Deal Data Loader (UNCHANGED)
      ============================================================ */
  useEffect(() => {
    if (!existingDeal) return;

    const stateValue = pickScopedDisplay(
      existingDeal.state,
      existingDeal.state_label
    );
    const zoneValue = pickScopedDisplay(
      existingDeal.sales_zone,
      existingDeal.sales_zone_label
    );
    const areaValue = pickScopedDisplay(
      existingDeal.sales_area,
      existingDeal.sales_area_label
    );

    setDeal({
      
      ...existingDeal,
      id: existingDeal.id || "",
      autoId: existingDeal.autoId || "",
      state: stateValue,
      sales_zone: zoneValue,
      sales_area: areaValue,
      capacity:
        existingDeal.capacity !== undefined &&
        existingDeal.capacity !== null
          ? existingDeal.capacity
          : "",
      expectedRevenue:
        existingDeal.expectedRevenue !== undefined &&
        existingDeal.expectedRevenue !== null
          ? existingDeal.expectedRevenue
          : "",
    });
     // ⭐ FORCE COPY OF LEAD → DEAL FOR 4 FIELDS
  ["sales_area", "sales_zone", "state", "zonal_manager"].forEach((k) => {
    const labelKey =
      k === "sales_area"
        ? "sales_area_label"
        : k === "sales_zone"
        ? "sales_zone_label"
        : k === "state"
        ? "state_label"
        : "";

    const nextVal =
      labelKey === "state_label"
        ? pickScopedDisplay(existingDeal?.state, existingDeal?.state_label)
        : labelKey === "sales_zone_label"
        ? pickScopedDisplay(existingDeal?.sales_zone, existingDeal?.sales_zone_label)
        : labelKey === "sales_area_label"
        ? pickScopedDisplay(existingDeal?.sales_area, existingDeal?.sales_area_label)
        : existingDeal?.[k];

    if (nextVal !== undefined) {
      setDeal((prev) => ({ ...prev, [k]: nextVal }));
    }
  });
  }, [existingDeal]);

  useEffect(() => {
    const list = Array.isArray(deal?.quotations)
      ? deal.quotations
      : Array.isArray(existingDeal?.quotations)
      ? existingDeal.quotations
      : deal?.quotation || existingDeal?.quotation
      ? [deal?.quotation || existingDeal?.quotation]
      : [];

    const normalized = list
      .filter(Boolean)
      .map((q) => ({
        ...q,
        quoteNo: resolveQuoteNo(q),
      }))
      .sort((a, b) => {
        const at = a?.createdAt?.seconds ? a.createdAt.seconds : new Date(a?.createdAt || 0).getTime() / 1000;
        const bt = b?.createdAt?.seconds ? b.createdAt.seconds : new Date(b?.createdAt || 0).getTime() / 1000;
        return bt - at;
      });

    setSavedQuotations(normalized);
  }, [deal?.quotations, deal?.quotation, existingDeal?.quotations, existingDeal?.quotation]);

  useEffect(() => {
    if (!deal.state) return;
    if (deal.sales_zone && !isZoneInState(deal.state, deal.sales_zone)) {
      setDeal((prev) => ({ ...prev, sales_zone: "", sales_area: "" }));
    }
  }, [deal.state, deal.sales_zone]);

  useEffect(() => {
    if (!deal.state || !deal.sales_zone) return;
    if (deal.sales_area && !isAreaInZone(deal.state, deal.sales_zone, deal.sales_area)) {
      setDeal((prev) => ({ ...prev, sales_area: "" }));
    }
  }, [deal.state, deal.sales_zone, deal.sales_area]);

  useEffect(() => {
    if (!formScrollEl) return;
    formScrollEl.scrollTop = 0;
  }, [existingDeal?.id, existingDeal?.autoId, formScrollEl]);

  useEffect(() => {
    if (!deal.assignedConsultant || consultants.length === 0) return;
    const emailKey = String(deal.assignedConsultant || "").trim().toLowerCase();
    const match = consultants.find(
      (c) => String(c.email || "").trim().toLowerCase() === emailKey
    );
    if (match?.name && deal.consultantName !== match.name) {
      setDeal((prev) => ({ ...prev, consultantName: match.name }));
    }
  }, [deal.assignedConsultant, consultants, deal.consultantName]);

  /* ============================================================
     Consultant Loader (UNCHANGED)
     ============================================================ */
  useEffect(() => {
  const load = async () => {
    try {
      const normalizeRole = (v) => String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      const rows = await fetchCollectionDocs("Users");
      const list = (rows || []).map((d) => ({
        name: d.Name || d.name || "",
        email: d.email || "",
        role: normalizeRole(d.role || d.Role || d.designation || d.Designation || ""),
      }));

      // 👇 users allowed for assignment
      const assignable = list.filter((u) =>
  [
    "consultant",
    "area_sales_manager",
    "zonal_manager",
  ].includes(u.role)
);

      const teleList = list.filter((u) =>
        [
          "telesales",
          "tele_caller",
          "telecaller",
          "tele_sales",
          "team_lead",
          "team_manager",
        ].includes(u.role) ||
        String(u.role || "").includes("tele")
      );

      setConsultants(assignable);
      setTeleUsers(teleList);
    } catch (err) {
      console.error("Consultant load error:", err);
    }
  };
  load();
}, []);

  /* ============================================================
     ⭐ ADD: Load dynamic fields from Firestore → /crm_fields/deals
     ============================================================ */
  useEffect(() => {
    const ref = doc(db, "crm_fields", "deals");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setFieldsDef([]);
          setLayoutDef([]);
          setSiteVisitKeys({ completedKey: "", arrangedKey: "" });
          return;
        }

        const data = snap.data() || {};
        const defs = Array.isArray(data.fields) ? data.fields : [];

        const normalized = defs.map((f) =>
          typeof f === "string"
            ? {
                name: f,
                label: prettyLabel(f),
                type: "text",
                required: false,
                options: [],
                default: "",
              }
            : {
                ...(f || {}),
                options: f.options || [],
                default: f.default ?? "",
              }
        );

        setFieldsDef(normalized);
        setLayoutDef(Array.isArray(data.layout) ? data.layout : []);
        setSiteVisitKeys(pickSiteVisitKeys(normalized));

        // ⭐ Initialize missing dynamic fields in deal state
        setDeal((prev) => {
          const n = { ...prev };
          normalized.forEach((fd) => {
            if (n[fd.name] === undefined) {
              if (fd.type === "checkbox") n[fd.name] = !!fd.default;
              else if (fd.type === "multiselect")
                n[fd.name] = Array.isArray(fd.default) ? fd.default : [];
              else n[fd.name] = fd.default ?? "";
            }
          });
          return n;
        });
      },
      (err) => {
        console.error("❌ Failed to load crm_fields/deals", err);
      }
    );

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  useEffect(() => {
    if (!existingDeal) return;
    if (!siteVisitKeys.completedKey && !siteVisitKeys.arrangedKey) return;

    setDeal((prev) => {
      const next = { ...prev };
      if (
        siteVisitKeys.completedKey &&
        next[siteVisitKeys.completedKey] === undefined &&
        existingDeal.siteVisitCompletedDate
      ) {
        next[siteVisitKeys.completedKey] = existingDeal.siteVisitCompletedDate;
      }
      if (
        siteVisitKeys.arrangedKey &&
        next[siteVisitKeys.arrangedKey] === undefined &&
        existingDeal.siteVisitArrangedDate
      ) {
        next[siteVisitKeys.arrangedKey] = existingDeal.siteVisitArrangedDate;
      }
      return next;
    });
  }, [existingDeal, siteVisitKeys.completedKey, siteVisitKeys.arrangedKey]);

  /* ============================================================
     Generate Next KPI (UNCHANGED)
     ============================================================ */
  const generateNextId = async () => {
    const rows = await fetchCollectionDocs("deals");
    const nums = (rows || [])
      .map((d) => parseInt(d.autoId?.split("-")[1] || 0))
      .filter((n) => !isNaN(n));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `KPI-${String(next).padStart(3, "0")}`;
  };

  /* ============================================================
     Duplicate Fixer on open (UNCHANGED)
     ============================================================ */
  useEffect(() => {
    const fix = async () => {
      try {
        const kpi = existingDeal?.autoId;
        if (!openedFromMove || !kpi) return;

        const dealsRef = collection(db, "deals");
        const q = query(dealsRef, where("autoId", "==", kpi));
        const snap = await getDocs(q);

        const kpiDoc = snap.docs.find((d) => d.id === kpi);

        if (kpiDoc) {
          for (const d of snap.docs) {
            if (d.id !== kpi) {
              const ref = doc(db, "deals", d.id);
              await setDoc(ref, { _systemDelete: true }, { merge: true });
              await deleteDoc(ref);
            }
          }
          setDeal({ ...kpiDoc.data(), id: kpi });
          return;
        }

        if (snap.docs.length > 0) {
          const first = snap.docs[0];
          const data = first.data();

          const ref = doc(db, "deals", kpi);
          const payload = {
            ...data,
            id: kpi,
            autoId: kpi,
            updatedAt: serverTimestamp(),
          };

          await setDoc(ref, payload, { merge: true });

          for (const d of snap.docs) {
            const ref = doc(db, "deals", d.id);
            await setDoc(ref, { _systemDelete: true }, { merge: true });
            await deleteDoc(ref);
          }

          setDeal({ ...payload, id: kpi });
        }
      } catch (err) {
        console.error("fixDuplicatesOnOpen error:", err);
      }
    };

    fix();
  }, [existingDeal]);

  /* ============================================================
     Handle Input (UNCHANGED)
     ============================================================ */
  const handleChange = (e) => {
    const { name, value } = e.target;

    // convert numbers properly
    if (name === "capacity") {
      if (value === "") {
        return setDeal((prev) => ({
          ...prev,
          capacity: "",
        }));
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      return setDeal((prev) => ({
        ...prev,
        capacity: parsed,
      }));
    }

    if (name === "expectedRevenue") {
      return setDeal((prev) => ({
        ...prev,
        [name]: Number(value),
      }));
    }

    // default handler
    setDeal((prev) => ({ ...prev, [name]: value }));
  };

  const toDateInputValue = (value) => {
    if (!value) return "";
    if (typeof value?.toDate === "function") {
      const d = value.toDate();
      return Number.isNaN(d?.getTime?.()) ? "" : d.toISOString().split("T")[0];
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().split("T")[0];
  };


  /* ============================================================
     ⭐ ADD: Dynamic field renderer
     ============================================================ */
  const renderDynamicInput = (fd) => {
    const isReadOnly = fd.name === "lead_source";
    const val = deal[fd.name] ?? "";

    const inputStyle = {
      padding: "8px 10px",
      border: "1px solid rgba(128,0,0,0.35)",
      borderRadius: 8,
      color: "#111827",
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
          value={val ?? ""}
          disabled={isReadOnly}
          onChange={(e) =>
            !isReadOnly &&
            setDeal({
              ...deal,
              state: e.target.value,
              state_label: e.target.value,
              sales_zone: "",
              sales_area: "",
              sales_zone_label: "",
              sales_area_label: "",
            })
          }
          style={{
            ...inputStyle,
            background: isReadOnly ? "#f3f3f3" : "#fff",
            cursor: isReadOnly ? "not-allowed" : "pointer",
          }}
        >
          <option value="">Select</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      );
    }

    if (isZoneField) {
      const zones = getZoneOptions(deal.state);
      return (
        <select
          value={val ?? ""}
          disabled={isReadOnly || !deal.state}
          onChange={(e) =>
            !isReadOnly &&
            setDeal({
              ...deal,
              sales_zone: e.target.value,
              sales_zone_label: e.target.value,
              sales_area: "",
              sales_area_label: "",
            })
          }
          style={{
            ...inputStyle,
            background: isReadOnly ? "#f3f3f3" : "#fff",
            cursor: isReadOnly ? "not-allowed" : "pointer",
          }}
        >
          <option value="">Select</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      );
    }

    if (isAreaField) {
      const areas = getAreaOptions(deal.state, deal.sales_zone);
      return (
        <select
          value={val ?? ""}
          disabled={isReadOnly || !deal.state || !deal.sales_zone}
          onChange={(e) =>
            !isReadOnly &&
            setDeal({
              ...deal,
              sales_area: e.target.value,
              sales_area_label: e.target.value,
            })
          }
          style={{
            ...inputStyle,
            background: isReadOnly ? "#f3f3f3" : "#fff",
            cursor: isReadOnly ? "not-allowed" : "pointer",
          }}
        >
          <option value="">Select</option>
          {areas.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      );
    }

    switch ((fd.type || "text").toLowerCase()) {
      case "textarea":
        return (
          <textarea
            value={val}
            rows={3}
            onChange={(e) => setDeal({ ...deal, [fd.name]: e.target.value })}
            style={{ ...inputStyle, minHeight: 80 }}
          />
        );

      case "date":
        return (
          <input
            type="date"
            value={val ? String(val).split("T")[0] : ""}
            onChange={(e) => setDeal({ ...deal, [fd.name]: e.target.value })}
            style={inputStyle}
          />
        );

      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={!!val}
            onChange={(e) =>
              setDeal({ ...deal, [fd.name]: e.target.checked })
            }
          />
        );

      case "select":
      case "picklist":
        if (isZonalManagerField(fd.name)) {
          return (
            <select
              value={val}
              disabled={isReadOnly}
              onChange={(e) =>
                !isReadOnly &&
                setDeal({ ...deal, [fd.name]: e.target.value })
              }
              style={{
                ...inputStyle,
                background: isReadOnly ? "#f3f3f3" : "#fff",
                cursor: isReadOnly ? "not-allowed" : "pointer",
              }}
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

        return (
          <select
  value={val}
  disabled={isReadOnly}
  onChange={(e) =>
    !isReadOnly &&
    setDeal({ ...deal, [fd.name]: e.target.value })
  }
  style={{
    ...inputStyle,
    background: isReadOnly ? "#f3f3f3" : "#fff",
    cursor: isReadOnly ? "not-allowed" : "pointer",
  }}
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
            value={Array.isArray(val) ? val.join(",") : val}
            placeholder="comma separated"
            onChange={(e) =>
              setDeal({
                ...deal,
                [fd.name]: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            style={inputStyle}
          />
        );

      default:
        return (
          <input
  value={val}
  disabled={isReadOnly}
  onChange={(e) =>
    !isReadOnly &&
    setDeal({ ...deal, [fd.name]: e.target.value })
  }
  style={{
    ...inputStyle,
    background: isReadOnly ? "#f3f3f3" : "#fff",
    cursor: isReadOnly ? "not-allowed" : "text",
  }}
/>
        );
    }
  };

  /* ============================================================
     SAVE (STATIC LOGIC UNTOUCHED) + dynamic fields merged
     ============================================================ */
  const handleSave = async () => {
    if (!deal.name || !deal.phone || !deal.location) {
      alert("⚠️ Name, Phone & Location required.");
      return;
    }
    const parsedCapacity = Number(deal.capacity);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0) {
      alert("⚠️ Capacity must be a positive number.");
      return;
    }
    if (!currentUser) {
      alert("⚠️ Login expired.");
      return;
    }

    setLoading(true);

    try {
      const phone = (deal.phone || "").trim();

      let finalAutoId =
        normalizeKPI(deal.autoId || existingDeal?.autoId || (isEdit ? deal.autoId : ""));

      if (!finalAutoId) {
        finalAutoId = await generateNextId();
      }

      const oldDocId = existingDeal?.autoId || existingDeal?.id || "";
      let docId = isEdit ? (oldDocId || finalAutoId) : finalAutoId;

      if (isEdit && isAdmin && finalAutoId !== oldDocId) {
        const newRef = doc(db, "deals", finalAutoId);
        const existsSnap = await getDoc(newRef);
        if (existsSnap.exists()) {
          alert(`❌ KPI ID ${finalAutoId} already exists.`);
          setLoading(false);
          return;
        }
        docId = finalAutoId;
      }

      /* ⭐ ADD: Extract dynamic fields into payload */
      const dynamicData = {};
      fieldsDef.forEach((fd) => {
        dynamicData[fd.name] = deal[fd.name] ?? "";
      });

      if (
        siteVisitKeys.completedKey &&
        deal.siteVisitCompletedDate &&
        !dynamicData[siteVisitKeys.completedKey]
      ) {
        dynamicData[siteVisitKeys.completedKey] = deal.siteVisitCompletedDate;
      }
      if (
        siteVisitKeys.arrangedKey &&
        deal.siteVisitArrangedDate &&
        !dynamicData[siteVisitKeys.arrangedKey]
      ) {
        dynamicData[siteVisitKeys.arrangedKey] = deal.siteVisitArrangedDate;
      }

      const emailKey = String(deal.assignedConsultant || "").trim().toLowerCase();
      const resolvedConsultantName =
        consultants.find(
          (c) => String(c.email || "").trim().toLowerCase() === emailKey
        )?.name || deal.consultantName || "";

      const payload = {
        ...deal,
        ...dynamicData,
        consultantName: resolvedConsultantName,
        stage: normalizeDealStage(deal.stage),

        // Use current drawer selections as source of truth
        state: normalizeScope(deal.state || ""),
        sales_zone: normalizeScope(deal.sales_zone || ""),
        sales_area: normalizeScope(deal.sales_area || ""),
        state_label: String(deal.state || "").trim(),
        sales_zone_label: String(deal.sales_zone || "").trim(),
        sales_area_label: String(deal.sales_area || "").trim(),

        // ⭐ FORCE NUMERIC FIELDS (Fix: Capacity & Expected Revenue were not saving)
        capacity: parsedCapacity,
        expectedRevenue: Number(deal.expectedRevenue || 0),

        id: docId,
        autoId: finalAutoId,
        kpiId: finalAutoId,
        phone,
       updatedAt: serverTimestamp(),
updatedBy:
  currentUser.displayName ||
  currentUser.email ||
  "",
createdAt: deal.createdAt || serverTimestamp(),
createdBy: currentUser.email,

      };

      await setDoc(doc(db, "deals", docId), payload, { merge: true });

      if (isEdit && isAdmin && oldDocId && docId !== oldDocId) {
        const oldRef = doc(db, "deals", oldDocId);
        await setDoc(oldRef, { _systemDelete: true }, { merge: true });
        await deleteDoc(oldRef);
      }

      await deleteDuplicateDealsByKPI(payload.autoId);

      alert("✔ Deal Saved Successfully");
      window.dispatchEvent(
        new CustomEvent("deal-updated", {
          detail: { id: payload.autoId || payload.id || "" },
        })
      );
      window.dispatchEvent(new CustomEvent("refresh-deals"));
      if (onDealSaved) await onDealSaved();
      onClose();
    } catch (err) {
      console.error("SAVE ERROR:", err);
      alert("❌ Failed to save.");
    } finally {
      setLoading(false);
    }
  };

const handleDeleteDeal = async () => {
  try {
    if (!existingDeal) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;

    // ✅ Use Firestore Document ID (autoId / KPI Id)
    const dealId =
      existingDeal.autoId ||  // new structure (KPI-001 etc)
      existingDeal.id ||      // fallback (old deals)
      deal?.autoId ||
      deal?.id;

    console.log("Existing Deal ===>", existingDeal);
    console.log("Deleting Deal Document ID ===>", dealId);

    if (!dealId) {
      alert("Deal ID not found");
      return;
    }

    // ✅ Delete from Firestore
    await deleteDoc(doc(db, "deals", dealId));

    alert("Deal deleted successfully");
    if (refreshDeals) refreshDeals();
    onClose();
    
  } catch (err) {
    console.error("Delete deal error:", err);
    alert("Delete failed");
  }
};

const handleAddNote = async () => {
  if (!newNote) return alert("Enter note text");
  try {
    const id = deal.autoId || existingDeal?.autoId;
    const noteObj = {
      by: currentUser?.email || "",
      at: new Date().toISOString(),
      text: newNote,
      type: "manual",
    };

    await updateDoc(doc(db, "deals", id), {
      notes: arrayUnion(noteObj),
      updatedAt: serverTimestamp(),
    });

    setDeal((prev) => ({ ...prev, notes: [...(prev.notes || []), noteObj] }));
    setNewNote("");
  } catch (e) {
    console.error(e);
    alert("Failed to add note");
  }
};

const formatQuoteDate = (value) => {
  if (!value) return "";
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const handleSaveQuotationFromDrawer = async (quotationObj) => {
  const dealId = deal.autoId || existingDeal?.autoId;
  if (!dealId) throw new Error("Missing deal id");

  const quoteNo = resolveQuoteNo(quotationObj);
  const quoteEntry = {
    ...quotationObj,
    dealId,
    kpiId: quotationObj?.kpiId || dealId,
    quoteNo,
    quotationId: quoteNo,
    createdAt: quotationObj?.createdAt || new Date().toISOString(),
    savedAt: new Date().toISOString(),
  };

  const nextList = [
    quoteEntry,
    ...savedQuotations.filter((q) => String(resolveQuoteNo(q) || "") !== String(quoteNo || "")),
  ];

  await setDoc(
    doc(db, "deals", dealId),
    {
      quotation: quoteEntry,
      quotations: nextList,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  setDeal((prev) => ({ ...prev, quotation: quoteEntry, quotations: nextList }));
  setSavedQuotations(nextList);
  return quoteEntry;
};

const handleDeleteQuotation = async (quoteNo) => {
  if (!isAdmin) {
    alert("Delete allowed only for admin, director, sales_head, agm, dgm.");
    return;
  }
  if (!window.confirm("Delete this quotation?")) return;

  const dealId = deal.autoId || existingDeal?.autoId;
  if (!dealId) return;

  const nextList = savedQuotations.filter(
    (q) => String(resolveQuoteNo(q) || "") !== String(quoteNo || "")
  );
  const latest = nextList[0] || null;

  await setDoc(
    doc(db, "deals", dealId),
    {
      quotation: latest,
      quotations: nextList,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  setDeal((prev) => ({ ...prev, quotation: latest, quotations: nextList }));
  setSavedQuotations(nextList);
};

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div style={styles.overlay}>
      <div style={styles.drawer}>
        <div style={styles.header}>
          <div />
          <button onClick={onClose} style={styles.closeBtn}>
            ✖
          </button>
        </div>

        <div ref={setFormScrollEl} style={styles.formContainer}>
          <div style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>KPI ID</label>
              {isAdmin ? (
                <input
                  value={deal.autoId || ""}
                  onChange={(e) => setDeal((prev) => ({ ...prev, autoId: e.target.value }))}
                  onBlur={() =>
                    setDeal((prev) => ({
                      ...prev,
                      autoId: normalizeKPI(prev.autoId || activeKpiId),
                    }))
                  }
                  style={{ ...styles.input, background: "#fff7e6", fontWeight: 700 }}
                />
              ) : (
                <input
                  value={activeKpiId}
                  readOnly
                  style={{ ...styles.input, background: "#fff7e6", fontWeight: 700 }}
                />
              )}
            </div>

            {/* =======================================================
                STATIC FIELDS (UNCHANGED)
              ======================================================= */}
            {[
              { label: "Customer Name*", name: "name" },
              { label: "Contact Number*", name: "phone" },
              { label: "Email", name: "email" },
              { label: "Location*", name: "location" },
              { label: "Google Maps Link", name: "locationLink" },
            ].map((f) => (
              <div key={f.name} style={styles.inputGroup}>
                <label style={styles.label}>{f.label}</label>
                <input
                  name={f.name}
                  value={deal[f.name] ?? ""}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
            
            ))}
            {/* ✅ TELE-SALES EXECUTIVE */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>Tele-Sales Executive</label>
              <SearchableSelect
                options={teleUsers}
                value={deal.teleSale ?? ""}
                onChange={(next) => setDeal((prev) => ({ ...prev, teleSale: next || "" }))}
                placeholder="Search Tele-Caller / Team Lead"
                getOptionValue={(u) => u.name || u.email || u.id}
                getOptionLabel={(u) => `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}`}
                getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""}`}
                allowClear
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Project Type</label>
              <select
                name="projectType"
                value={deal.projectType ?? "Residential"}
                onChange={handleChange}
                style={styles.select}
              >
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
              </select>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Capacity (kW)</label>
              <input
                type="number"
                name="capacity"
                value={deal.capacity ?? ""}
                onChange={handleChange}
                min="0.01"
                step="0.01"
                style={styles.input}
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Expected Revenue (₹)</label>
              <input
                type="number"
                name="expectedRevenue"
                value={deal.expectedRevenue ?? ""}
                onChange={handleChange}
                style={styles.input}
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Site Visit Arranged Date</label>
              <input
                type="date"
                name="siteVisitArrangedDate"
                value={toDateInputValue(deal.siteVisitArrangedDate)}
                onChange={handleChange}
                style={styles.input}
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Site Visit Completed Date</label>
              <input
                type="date"
                name="siteVisitCompletedDate"
                value={toDateInputValue(deal.siteVisitCompletedDate)}
                onChange={handleChange}
                style={styles.input}
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Assigned Consultant</label>
              <SearchableSelect
                options={consultants}
                value={deal.assignedConsultant ?? ""}
                onChange={(next) => setDeal((prev) => ({ ...prev, assignedConsultant: next || "" }))}
                placeholder="Search consultant by name or email"
                getOptionValue={(c) => c.email || c.name || c.id}
                getOptionLabel={(c) => `${c.name || c.email}${c.email && c.name ? ` (${c.email})` : ""}`}
                getOptionSearchText={(c) => `${c.name || ""} ${c.email || ""}`}
                allowClear
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Stage</label>
              <select
                name="stage"
                value={normalizeDealStage(deal.stage)}
                onChange={handleChange}
                style={styles.select}
              >
                <option value="Qualification">Qualification</option>
                <option value="Proposal">Proposal</option>
                <option value="Negotiation">Negotiation</option>
                <option value="Hold">Hold</option>
                <option value="Potential Customer">
                  Potential Customer
                </option>
                <option value="Won">Won</option>
                <option value="Lost">Lost</option>
              </select>
            </div>

            {/* =======================================================
                ⭐ DYNAMIC FIELDS SECTION (APPER BELOW STATIC → A2)
              ======================================================= */}
            {fieldsDef.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div
                  style={{
                    fontWeight: 700,
                    color: "#800000",
                    marginBottom: 8,
                  }}
                >
                  Additional Fields
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobileView ? "1fr" : "1fr 1fr",
                    gap: 12,
                  }}
                >
                  {[...fieldsDef]
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
          </div>
        </div>
        {/* ---------------- ATTACHMENTS ---------------- */}
{isEdit && (
  <div style={{ marginTop: 20, padding: 10, borderTop: "1px solid #ddd" }}>
    <button
      type="button"
      onClick={() => setShowAttachments((prev) => !prev)}
      style={{
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 700,
        color: "#800000",
      }}
    >
      📎 Attachments {showAttachments ? "▾" : "▸"}
    </button>

    {showAttachments && (
      <AttachmentFolderTiles
        kpiId={deal?.autoId || existingDeal?.autoId}
        customerName={deal?.name || existingDeal?.name}
        from="deals"
      />
    )}
  </div>
)}


        {/* ---------------- NOTES ---------------- */}
        <div style={{ marginTop: 14, padding: 10, borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={() => setShowNotes((prev) => !prev)}
            style={{
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              padding: 0,
              margin: 0,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
              color: "#800000",
            }}
          >
            Notes {showNotes ? "▾" : "▸"}
          </button>

          {showNotes && (
            <>
              {(deal.notes || existingDeal?.notes || []).length === 0 && (
                <p style={{ color: "#666" }}>No notes yet</p>
              )}

              {(deal.notes || existingDeal?.notes || []).map((n, idx) => (
                <div key={idx} style={{ padding: 8, border: "1px solid #f0f0f0", borderRadius: 6, marginTop: 8 }}>
                  <div style={{ fontWeight: 700 }}>{n.type || "Note"} — {n.by}</div>
                  <div style={{ color: "#666", fontSize: 13 }}>{new Date(n.at).toLocaleString()}</div>
                  <div style={{ marginTop: 6 }}>{n.text}</div>
                </div>
              ))}

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note..." style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #800000" }} />
                <button onClick={handleAddNote} style={{ background: "#800000", color: "#fff", border: "none", padding: "8px 12px", borderRadius: 6 }}>Add</button>
              </div>
            </>
          )}
        </div>

        {/* ---------------- QUOTATIONS ---------------- */}
        {isEdit && (
          <div style={{ marginTop: 14, padding: 10, borderTop: "1px solid #eee" }}>
            <button
              type="button"
              onClick={() => setShowQuotations((prev) => !prev)}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 700,
                color: "#800000",
              }}
            >
              Quotations {showQuotations ? "▾" : "▸"}
            </button>

            {showQuotations && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setActiveQuotation({
                      dealId: deal.autoId || existingDeal?.autoId,
                      createdFromDeal: deal.autoId || existingDeal?.autoId,
                      kpiId: deal.autoId || existingDeal?.autoId,
                      customerName: deal.name || "",
                      customerPhone: deal.phone || "",
                      location: deal.location || "",
                      capacity: Number(deal.capacity || 0),
                      quoteNo: resolveQuoteNo(deal) || "",
                      isSaved: false,
                    })
                  }
                  style={{
                    justifySelf: "start",
                    background: "#800000",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontWeight: 700,
                  }}
                >
                  + New Quotation
                </button>

                {savedQuotations.length === 0 && (
                  <p style={{ color: "#666" }}>No saved quotations yet.</p>
                )}

                {savedQuotations.map((q, idx) => {
                  const qNo = resolveQuoteNo(q) || `Quote-${idx + 1}`;
                  return (
                    <div
                      key={`${qNo}-${idx}`}
                      style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "#f8fafc" }}
                    >
                      <div style={{ fontWeight: 700, color: "#1f2937" }}>{qNo}</div>
                      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
                        Created: {formatQuoteDate(q?.createdAt) || "-"}
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => setActiveQuotation({ ...q, isSaved: true })}
                          style={{ background: "#800000", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontWeight: 700 }}
                        >
                          Edit
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDeleteQuotation(qNo)}
                            style={{ background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontWeight: 700 }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={styles.buttonGroup}>
          {isAdmin && (
            <button
              onClick={handleDeleteDeal}
              style={styles.deleteBtn}
            >
              Delete Deal
            </button>
          )}
          <button
  onClick={handleSave}
  style={styles.addBtn}
  disabled={
    loading ||
    (!existingDeal && !perm.create) ||
    (existingDeal && !perm.update)
  }
>
            {loading ? "Saving..." : isEdit ? "💾 Save" : "➕ Add Deal"}
          </button>

          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>

      {activeQuotation && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 1200,
            padding: 16,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              maxWidth: 980,
              margin: "0 auto",
              background: "#fff",
              borderRadius: 10,
              padding: 14,
            }}
          >
            <QuotationPreview
              data={{
                ...activeQuotation,
                dealId: deal.autoId || existingDeal?.autoId,
                createdFromDeal: deal.autoId || existingDeal?.autoId,
                kpiId: activeQuotation?.kpiId || deal.autoId || existingDeal?.autoId,
              }}
              onClose={() => setActiveQuotation(null)}
              onSaveQuotation={async (payload) => {
                await handleSaveQuotationFromDrawer(payload);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DealDrawer;

/* ============================================================
   Existing Styles (UNCHANGED)
   ============================================================ */
const styles = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 999,
  },
  drawer: {
    background: "#fff",
    width: "min(620px, 100vw)",
    maxWidth: "100vw",
    height: "100%",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.3)",
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    position: "relative",
    zIndex: 1,
    background: "#fff",
    padding: "14px 20px 10px",
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 20, color: "#800000", fontWeight: "bold" },
  kpiBadge: {
    display: "inline-block",
    marginTop: 0,
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
    cursor: "pointer",
    color: "#800000",
  },
  formContainer: {
    padding: "10px 20px 20px",
    overflowY: "auto",
    flex: 1,
    WebkitOverflowScrolling: "touch",
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  inputGroup: { display: "flex", flexDirection: "column" },
  label: { color: "#800000", marginBottom: 6, fontSize: 13, fontWeight: 600 },
  input: {
    padding: "8px 10px",
    border: "1px solid rgba(128,0,0,0.35)",
    borderRadius: 8,
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
    position: "sticky",
    bottom: 0,
    background: "#fff",
    borderTop: "1px solid #eee",
    padding: 12,
    display: "flex",
    gap: 10,
    paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
  },
  addBtn: {
    flex: 1,
    background: "#800000",
    color: "#fff",
    padding: 10,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
  },
  cancelBtn: {
    flex: 1,
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    padding: 10,
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 700,
  },
  deleteBtn: {
    flex: 1,
    background: "linear-gradient(135deg, #b91c1c, #dc2626)",
    color: "#fff",
    padding: 10,
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 6px 16px rgba(185,28,28,0.25)",
  },
};
