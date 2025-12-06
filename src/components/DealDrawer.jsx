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
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

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

const DealDrawer = ({ onClose, onDealSaved, existingDeal }) => {
  const auth = getAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [consultants, setConsultants] = useState([]);

  /* ============================================================
     ⭐ ADD: Dynamic fields state
     ============================================================ */
  const [fieldsDef, setFieldsDef] = useState([]); // dynamic fields
  const [layoutDef, setLayoutDef] = useState([]); // not used now but kept for layout support

  const isEdit = !!existingDeal;
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

    setDeal({
      ...existingDeal,
      id: existingDeal.id || "",
      autoId: existingDeal.autoId || "",
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
    if (existingDeal?.[k] !== undefined) {
      setDeal((prev) => ({ ...prev, [k]: existingDeal[k] }));
    }
  });
  }, [existingDeal]);

  /* ============================================================
     Consultant Loader (UNCHANGED)
     ============================================================ */
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, "Users"));
        const list = snap.docs
          .map((d) => d.data())
          .filter((u) => u.role?.toLowerCase().includes("consultant"));
        setConsultants(list);
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
    let active = true;

    (async () => {
      try {
        const ref = doc(db, "crm_fields", "deals");
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          if (active) setFieldsDef([]);
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

        if (!active) return;

        setFieldsDef(normalized);
        setLayoutDef(Array.isArray(data.layout) ? data.layout : []);

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
      } catch (err) {
        console.error("❌ Failed to load crm_fields/deals", err);
      }
    })();

    return () => (active = false);
  }, []);

  /* ============================================================
     Generate Next KPI (UNCHANGED)
     ============================================================ */
  const generateNextId = async () => {
    const snap = await getDocs(collection(db, "deals"));
    const nums = snap.docs
      .map((d) => parseInt(d.data().autoId?.split("-")[1] || 0))
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
    if (name === "capacity" || name === "expectedRevenue") {
      return setDeal((prev) => ({
        ...prev,
        [name]: Number(value),
      }));
    }

    // default handler
    setDeal((prev) => ({ ...prev, [name]: value }));
  };

  /* ============================================================
     ⭐ ADD: Dynamic field renderer
     ============================================================ */
  const renderDynamicInput = (fd) => {
    const val = deal[fd.name] ?? "";

    const inputStyle = {
      padding: 10,
      border: "1px solid #800000",
      borderRadius: 6,
      color: "#800000",
    };

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
        return (
          <select
            value={val}
            onChange={(e) => setDeal({ ...deal, [fd.name]: e.target.value })}
            style={inputStyle}
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
            onChange={(e) => setDeal({ ...deal, [fd.name]: e.target.value })}
            style={inputStyle}
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
    if (!currentUser) {
      alert("⚠️ Login expired.");
      return;
    }

    setLoading(true);

    try {
      const phone = (deal.phone || "").trim();

      let finalAutoId =
        deal.autoId || existingDeal?.autoId || (isEdit ? deal.autoId : "");

      if (!finalAutoId) {
        finalAutoId = await generateNextId();
      }

      // Always use autoId as document ID
let docId;

if (isEdit) {
  // Always use autoId as Firestore document ID
  docId = existingDeal.autoId;
} else {
  docId = finalAutoId;  // same KPI-xxx
}

      /* ⭐ ADD: Extract dynamic fields into payload */
      const dynamicData = {};
      fieldsDef.forEach((fd) => {
        dynamicData[fd.name] = deal[fd.name] ?? "";
      });

      const payload = {
        ...deal,
        ...dynamicData,

        // ⭐ FORCE NUMERIC FIELDS (Fix: Capacity & Expected Revenue were not saving)
        capacity: Number(deal.capacity || 0),
        expectedRevenue: Number(deal.expectedRevenue || 0),

        id: docId,
        autoId: finalAutoId,
        phone,
        updatedAt: serverTimestamp(),
        createdAt: deal.createdAt || serverTimestamp(),
        createdBy: currentUser.email,
      };

      await setDoc(doc(db, "deals", docId), payload, { merge: true });

      await deleteDuplicateDealsByKPI(payload.autoId);

      alert("✔ Deal Saved Successfully");
      if (onDealSaved) await onDealSaved();
      onClose();
    } catch (err) {
      console.error("SAVE ERROR:", err);
      alert("❌ Failed to save.");
    } finally {
      setLoading(false);
    }
  };

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div style={styles.overlay}>
      <div style={styles.drawer}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {isEdit ? "✏️ Edit Deal" : "➕ Add Deal"}
          </h2>
          <button onClick={onClose} style={styles.closeBtn}>
            ✖
          </button>
        </div>

        <div style={styles.formContainer}>
          <div style={styles.form}>
            {/* =======================================================
                STATIC FIELDS (UNCHANGED)
              ======================================================= */}
            {[
              { label: "Customer Name*", name: "name" },
              { label: "Contact Number*", name: "phone" },
              { label: "Email", name: "email" },
              { label: "Location*", name: "location" },
              { label: "Google Maps Link", name: "locationLink" },
              { label: "Lead Source", name: "source" },
              { label: "Tele-Sales Executive", name: "teleSale" },
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
              <label style={styles.label}>Assigned Consultant</label>
              <select
                name="assignedConsultant"
                value={deal.assignedConsultant ?? ""}
                onChange={handleChange}
                style={styles.select}
              >
                <option value="">Select Consultant</option>
                {consultants.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name} ({c.email})
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Stage</label>
              <select
                name="stage"
                value={deal.stage ?? "Qualification"}
                onChange={handleChange}
                style={styles.select}
              >
                <option value="Qualification">Qualification</option>
                <option value="Negotiation">Negotiation</option>
                <option value="Hold">Hold</option>
                <option value="Potential Customer">
                  Potential Customer
                </option>
                <option value="Deal Won">Deal Won</option>
                <option value="Lost to Competition">
                  Lost to Competition
                </option>
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
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  {fieldsDef.map((fd) => (
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

        <div style={styles.buttonGroup}>
          <button
            onClick={handleSave}
            style={styles.addBtn}
            disabled={loading}
          >
            {loading ? "Saving..." : isEdit ? "💾 Save" : "➕ Add Deal"}
          </button>

          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
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
    width: 420,
    height: "100%",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.3)",
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: 20,
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
  },
  title: { fontSize: 20, color: "#800000", fontWeight: "bold" },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    color: "#800000",
  },
  formContainer: {
    padding: "20px 20px",
    overflowY: "auto",
    flex: 1,
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  inputGroup: { display: "flex", flexDirection: "column" },
  label: { color: "#800000", marginBottom: 6 },
  input: {
    padding: 10,
    border: "1px solid #800000",
    borderRadius: 6,
    color: "#800000",
  },
  select: {
    padding: 10,
    borderRadius: 6,
    border: "1px solid #800000",
    color: "#800000",
  },
  buttonGroup: {
    borderTop: "1px solid #eee",
    padding: 12,
    display: "flex",
    gap: 10,
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
};
