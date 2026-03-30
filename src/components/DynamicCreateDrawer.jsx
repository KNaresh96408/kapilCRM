// src/components/DynamicCreateDrawer.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { auth, db, serverTimestamp } from "../firebaseConfig";
import { fetchCollectionREST } from "../helpers/firestoreRest";

/**
 * DynamicCreateDrawer
 * Props:
 *  - moduleName (string) : e.g. "leads"
 *  - onClose() 
 *  - existingId (optional) - for edit
 *  - onSaved() - callback after save (parent should refresh)
 *
 * It reads crm_fields/{moduleName} where document shape is expected:
 * {
 *   fields: [{ name, label, type, required, options?, placeholder? }, ...],
 *   layout: [{ section: "header"|"main", fields: ["name","phone", ...] }, ...]
 * }
 *
 * If crm_fields/{moduleName} isn't present, it falls back to an empty form.
 *
 * This component preserves the Add/Edit behavior from your original LeadDrawer:
 * - generateNextKPI()
 * - moveLeadToDeals()
 * - required validation (Name, Phone, Location) - note: still validated explicitly
 */

export default function DynamicCreateDrawer({
  moduleName = "leads",
  onClose = () => {},
  existingId = null,
  onSaved = () => {},
}) {
  const [loading, setLoading] = useState(true);
  const [fieldsDef, setFieldsDef] = useState([]); // array of field defs
  const [layout, setLayout] = useState([{ section: "main", fields: [] }]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [existingData, setExistingData] = useState(null);
  const [consultants, setConsultants] = useState([]);
  const moveInProgress = useRef(false);

  // Load crm_fields defs + layout
  useEffect(() => {
    let mounted = true;
    const loadDefs = async () => {
      setLoading(true);
      try {
        const ref = doc(db, "crm_fields", moduleName);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          // fallback: keep empty defs and default layout
          if (!mounted) return;
          setFieldsDef([]);
          setLayout([{ section: "header", fields: [] }, { section: "main", fields: [] }]);
          setForm({});
          return;
        }
        const data = snap.data();
        // fields may be strings or objects; normalize
        const defs = Array.isArray(data.fields) ? data.fields : [];
        const normalized = defs.map((f) =>
          typeof f === "string"
            ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [] }
            : { ...(f || {}), options: f.options || [] }
        );
        if (!mounted) return;
        setFieldsDef(normalized);
        setLayout(Array.isArray(data.layout) ? data.layout : [{ section: "header", fields: [] }, { section: "main", fields: [] }]);

        // initialize form with defaults for each field
        const initial = {};
        normalized.forEach((fd) => {
          if (fd.type === "checkbox") initial[fd.name] = !!(fd.default || false);
          else if (fd.type === "multiselect") initial[fd.name] = fd.default ?? [];
          else initial[fd.name] = fd.default ?? "";
        });

        // keep some legacy friendly defaults (like in LeadDrawer)
        initial.status = initial.status ?? "new";
        initial.siteVisitArranged = initial.siteVisitArranged ?? "no";

        setForm(initial);
      } catch (err) {
        console.error("Failed to load crm_fields", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadDefs();
    return () => (mounted = false);
  }, [moduleName]);

  // load consultants (used by Assigned Consultant field)
  useEffect(() => {
  const fetchConsultants = async () => {
    try {
      const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
      const token = stored.idToken;

      if (!token) {
        console.warn("No idToken found for consultants");
        setConsultants([]);
        return;
      }

      const users = await fetchCollectionREST("Users", token);

      const consultants = (users || [])
        .map((u) => ({
          id: u.id,
          name: u.Name || u.name || "",
          email: u.email || "",
          role: (u.designation || u.role || "").toLowerCase(),
        }))
        .filter((u) => u.role.includes("consultant"));

      setConsultants(consultants);
    } catch (e) {
      console.error("fetch consultants failed (REST)", e);
      setConsultants([]);
    }
  };

  fetchConsultants();
}, []);

  // load existing doc if editing
  useEffect(() => {
    if (!existingId) return;
    let mounted = true;
    (async () => {
      try {
        const ref = doc(db, moduleName, existingId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const d = snap.data();
        if (!mounted) return;
        setExistingData(d);
        setForm((prev) => {
          const next = { ...(prev || {}) };
          Object.keys(d || {}).forEach((k) => (next[k] = d[k]));
          return next;
        });
      } catch (err) {
        console.error("load existing doc", err);
      }
    })();
    return () => (mounted = false);
  }, [existingId, moduleName]);

  // helper: change handler
  const handleChange = (name, value) => {
    setForm((p) => ({ ...p, [name]: value }));
  };

  // pretty label fallback
  function prettyLabel(name) {
    if (!name) return "";
    return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

  // Render input based on field definition
  const renderInput = (fd) => {
    const val = form[fd.name] ?? "";
    const common = {
      id: fd.name,
      name: fd.name,
      value: val === null || val === undefined ? "" : (typeof val === "object" ? val : val),
      onChange: (e) => {
        if (e?.target?.type === "checkbox") handleChange(fd.name, e.target.checked);
        else handleChange(fd.name, e.target.value);
      },
      style: { padding: 10, borderRadius: 6, border: "1px solid #800000", color: "#800000", width: "100%" },
    };

    const t = (fd.type || "text").toLowerCase();

    if (fd.name === "assignedConsultant") {
      // render consultant select
      return (
        <select
          {...common}
          value={form.assignedConsultant || ""}
          onChange={(e) => handleChange("assignedConsultant", e.target.value)}
          style={common.style}
        >
          <option value="">Select Consultant</option>
          {consultants.map((c) => (
            <option key={c.email} value={c.email}>
              {c.name} ({c.email})
            </option>
          ))}
        </select>
      );
    }

    switch (t) {
      case "textarea":
        return <textarea {...common} rows={3} style={{ ...common.style, minHeight: 80 }} />;
      case "date":
        return (
          <input
            {...common}
            type="date"
            value={form[fd.name] ? String(form[fd.name]).split?.("T")?.[0] ?? form[fd.name] : ""}
          />
        );
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={!!form[fd.name]}
            onChange={(e) => handleChange(fd.name, e.target.checked)}
          />
        );
      case "picklist":
      case "select":
        return (
          <select {...common} value={form[fd.name] ?? ""}>
            <option value="">{fd.placeholder || "Select"}</option>
            {(fd.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "multiselect":
        return (
          <input
            {...common}
            placeholder="comma separated"
            value={Array.isArray(form[fd.name]) ? form[fd.name].join(",") : form[fd.name] ?? ""}
            onChange={(e) => handleChange(fd.name, e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
          />
        );
      case "email":
        return <input {...common} type="email" />;
      case "phone":
      case "tel":
        return <input {...common} type="tel" />;
      case "number":
      case "currency":
        return <input {...common} type="number" />;
      default:
        return <input {...common} type="text" />;
    }
  };

  // generateNextKPI (copied from your LeadDrawer)
  const generateNextKPI = async () => {
  const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
  const token = stored.idToken;

  if (!token) throw new Error("No idToken for KPI generation");

  const cols = ["leads", "deals", "salesOrders"];
  let max = 0;

  for (const c of cols) {
    try {
      const docs = await fetchCollectionREST(c, token);

      (docs || []).forEach((d) => {
        const x = d.autoId || d.kpiId;
        if (x?.startsWith("KPI-")) {
          const n = parseInt(x.split("-")[1], 10);
          if (!isNaN(n) && n > max) max = n;
        }
      });
    } catch (e) {
      console.warn("generateNextKPI: REST error reading", c, e);
    }
  }

  return `KPI-${String(max + 1).padStart(3, "0")}`;
};

  // moveLeadToDeals (copied and adapted)
  const moveLeadToDeals = async (leadData) => {
    if (moveInProgress.current) return;
    moveInProgress.current = true;
    try {
      const { autoId, phone } = leadData;
      if (!autoId || !phone) return;

      const dealsRef = collection(db, "deals");
      const q1 = query(dealsRef, where("autoId", "==", autoId));
      const q2 = query(dealsRef, where("kpiId", "==", autoId));
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const map = new Map();
      s1.forEach((d) => map.set(d.id, d));
      s2.forEach((d) => map.set(d.id, d));
      const docs = [...map.values()];
      const kpiDoc = docs.find((d) => d.id === autoId);

      const currentUser = auth.currentUser;

      if (kpiDoc) {
        for (const d of docs) {
          if (d.id === autoId) continue;
          const ref = doc(db, "deals", d.id);
          await setDoc(ref, { _systemDelete: true }, { merge: true });
          await deleteDoc(ref);
        }
        const ref = doc(db, "deals", autoId);
        const payload = {
          ...kpiDoc.data(),
          ...leadData,
          autoId,
          kpiId: autoId,
          stage: "Qualification",
          movedFrom: "leads",
          updatedAt: serverTimestamp(),
          createdBy: currentUser?.email,
        };
        await setDoc(ref, payload, { merge: true });
      } else if (docs.length > 0) {
        const first = docs[0].data();
        const payload = {
          ...first,
          ...leadData,
          autoId,
          kpiId: autoId,
          stage: "Qualification",
          movedFrom: "leads",
          updatedAt: serverTimestamp(),
          createdBy: currentUser?.email,
        };
        const ref = doc(db, "deals", autoId);
        await setDoc(ref, payload, { merge: true });

        for (const d of docs) {
          const ref2 = doc(db, "deals", d.id);
          await setDoc(ref2, { _systemDelete: true }, { merge: true });
          await deleteDoc(ref2);
        }
      } else {
        const payload = {
          ...leadData,
          autoId,
          kpiId: autoId,
          stage: "Qualification",
          movedFrom: "leads",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: currentUser?.email,
        };
        const ref = doc(db, "deals", autoId);
        await setDoc(ref, payload, { merge: true });
      }

      if (leadData.id) {
        try {
          await deleteDoc(doc(db, "leads", leadData.id));
        } catch (e) {}
      }

      alert(`Lead ${autoId} moved successfully to Deals!`);
      setTimeout(() => {
        onSaved?.();
        onClose?.();
      }, 250);
    } catch (err) {
      console.error("moveLeadToDeals failed", err);
      alert("Failed to move lead.");
    } finally {
      moveInProgress.current = false;
    }
  };

  // Save handler (create or update)
  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return alert("Login required");

    // Basic validation aligned with LeadDrawer
    if (!form.name || !form.phone || !form.location) {
      return alert("Fill Name, Phone & Location");
    }

    // also validate per-field required flags configured in crm_fields
    for (const fd of fieldsDef) {
      if (fd.required) {
        const v = form[fd.name];
        if (v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
          return alert(`${fd.label || prettyLabel(fd.name)} is required`);
        }
      }
    }

    setSaving(true);
    try {
      // map consultantName if assignedConsultant is email
      const selected = consultants.find((c) => c.email === form.assignedConsultant);
      const leadData = {
        ...form,
        consultantName: selected?.name || form.consultantName || "",
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
      };

      if (existingId) {
        // update existing
        const ref = doc(db, moduleName, existingId);
        await updateDoc(ref, leadData);

        if (leadData.siteVisitArranged === "yes") {
          await moveLeadToDeals({ id: existingId, ...existingData, ...leadData });
        }

        alert("Lead updated!");
      } else {
        // create new
        const autoId = await generateNextKPI();
        const newLead = {
          ...leadData,
          autoId,
          createdAt: serverTimestamp(),
          createdBy: user.email,
          ownerUid: user.uid,
          status: leadData.status || "new",
        };

        const ref = await addDoc(collection(db, moduleName), newLead);
        // if site visit arranged -> move to deals
        if (leadData.siteVisitArranged === "yes") {
          await moveLeadToDeals({ id: ref.id, ...newLead });
        }
        alert(`Lead added with ID ${autoId}`);
      }

      onSaved?.();
      setTimeout(onClose, 200);
    } catch (err) {
      console.error("save failed", err);
      alert("Failed to save lead.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading form...</div>;

  // Render form using layout sequence. If layout empty, fallback to showing fieldsDef order.
  const sections = Array.isArray(layout) && layout.length ? layout : [{ section: "main", fields: fieldsDef.map((f) => f.name) }];

  return (
    <div style={styles.overlay}>
      <div style={styles.drawer}>
        <div style={styles.header}>
          <h2 style={styles.title}>{existingId ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onClose} style={styles.closeBtn}>✖</button>
        </div>

        <div style={styles.formContainer}>
          <div style={styles.form}>
            {sections.map((sec) => (
              <div key={sec.section} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: "#800000", marginBottom: 8 }}>
                  {sec.section === "header" ? "Header" : "Main"}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {(Array.isArray(sec.fields) ? sec.fields : []).map((fname) => {
                    // find field def; fallback to simple text field
                    const fd = fieldsDef.find((f) => f.name === fname) || { name: fname, label: prettyLabel(fname), type: "text", required: false, options: [] };
                    return (
                      <div key={fname} style={{ display: "flex", flexDirection: "column" }}>
                        <label style={styles.label}>{fd.label}{fd.required ? " *" : ""}</label>
                        {renderInput(fd)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* If layout had no fields (or certain fields missing), show any remaining defs */}
            {fieldsDef.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {/* show any fields not included in layout */}
                {fieldsDef
                  .filter((f) => !sections.some((s) => (s.fields || []).includes(f.name)))
                  .map((fd) => (
                    <div key={fd.name} style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, color: "#800000", marginBottom: 6 }}>{fd.label}{fd.required ? " *" : ""}</div>
                      {renderInput(fd)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div style={styles.buttonGroup}>
          <button onClick={handleSave} style={styles.addBtn} disabled={saving}>
            {saving ? "Saving..." : existingId ? "Save Changes" : "Add Lead"}
          </button>
          <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// styles kept consistent with your LeadDrawer for same look
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
    width: 420,
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
  label: {
    color: "#800000",
    fontWeight: 600,
    marginBottom: 6,
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
};
