// src/components/Settings/EditLayoutPage.jsx
import React, { useEffect, useState, useRef } from "react";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  limit,
} from "firebase/firestore";
import { db, serverTimestamp } from "../../firebaseConfig";
import { getAuth } from "firebase/auth";

const TOOLBOX = [
  { type: "text", label: "Single Line" },
  { type: "textarea", label: "Multi-Line" },
  { type: "email", label: "Email" },
  { type: "phone", label: "Phone" },
  { type: "picklist", label: "Pick List" },
  { type: "multiselect", label: "Multi-Select" },
  { type: "date", label: "Date" },
  { type: "number", label: "Number" },
  { type: "currency", label: "Currency" },
  { type: "checkbox", label: "Checkbox" },
  { type: "url", label: "URL" },
  { type: "user", label: "User (Lookup)" },
  { type: "file", label: "File Upload" },
  { type: "image", label: "Image Upload" },
];

function prettyLabel(name) {
  if (!name) return "";
  return name
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/([A-Z])/g, " $1")
    .trim();
}

// Query param helper
function getQueryModule() {
  const p = new URLSearchParams(window.location.search);
  const raw = p.get("module") || "leads";

  const normalize = {
    leads: "leads",
    deals: "deals",
    "sales-orders": "salesOrders",
    "salesorders": "salesOrders",
    projects: "projects"
  };

  return normalize[raw.toLowerCase()] || raw;
}

export default function EditLayoutPage() {
  const auth = getAuth();
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState([]); // array of {name,label,type,required,options}
  const [layout, setLayout] = useState([
    { section: "header", fields: [] },
    { section: "main", fields: [] },
  ]);
  const [newFieldName, setNewFieldName] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const mountedRef = useRef(true);
  const [editingField, setEditingField] = useState(null);
  const moduleName = getQueryModule(); // module variable (leads / deals / ...)

  // load crm_fields/{module}
  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      setLoading(true);
      try {
        const ref = doc(db, "crm_fields", moduleName);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          if (!mountedRef.current) return;
          setFields([]);
          setLayout([
            { section: "header", fields: [] },
            { section: "main", fields: [] },
          ]);
        } else {
          const d = snap.data();
          const defs = Array.isArray(d.fields) ? d.fields : [];
          const normalized = defs.map((f) =>
            typeof f === "string"
              ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [] }
              : { ...(f || {}), options: f.options || [] }
          );
          if (!mountedRef.current) return;
          setFields(normalized);

          if (Array.isArray(d.layout) && d.layout.length > 0) {
            setLayout(
              d.layout.map((l) => ({
                section: l.section,
                fields: Array.isArray(l.fields) ? l.fields : [],
              }))
            );
          } else {
            // fallback leave default
            setLayout((p) => p);
          }
        }
      } catch (err) {
        console.error("Failed to load crm_fields/" + moduleName, err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    load();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshKey, moduleName]);

  // helper: existing names
  const existingNames = fields.map((f) => (typeof f === "string" ? f : f.name));

  // add master field
  const addMasterField = (type, label, suggestedName) => {
    const base =
      (suggestedName || label || type || "field")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") || `field_${Date.now()}`;
    let candidate = base;
    let i = 1;
    while (existingNames.includes(candidate)) {
      candidate = `${base}_${i}`;
      i++;
    }
    const obj = {
      name: candidate,
      label: prettyLabel(suggestedName || label || candidate),
      type: type || "text",
      required: false,
      options: [],
    };
    setFields((p) => [...p, obj]);
    return candidate;
  };

  // drag handlers
  const onDragStartToolbox = (e, t) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ from: "toolbox", payload: t }));
  };
  const onDragStartExisting = (e, name) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ from: "existing", payload: name }));
  };
  const onDragOver = (e) => e.preventDefault();

  const onDropToSection = (e, sectionIndex) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const obj = JSON.parse(raw);
      const copy = JSON.parse(JSON.stringify(layout));
      if (obj.from === "toolbox") {
        const name = addMasterField(obj.payload.type, obj.payload.label);
        copy[sectionIndex].fields.push(name);
        setLayout(copy);
      } else if (obj.from === "existing") {
        const name = obj.payload;
        // remove from other sections
        copy.forEach((s) => {
          const idx = s.fields.indexOf(name);
          if (idx >= 0) s.fields.splice(idx, 1);
        });
        copy[sectionIndex].fields.push(name);
        setLayout(copy);
      }
    } catch (err) {
      console.error("drop parse", err);
    }
  };

 const removeFieldFromMaster = async (name) => {
  if (!window.confirm(`Delete field ${name}?`)) return;

  // Remove from local state
  setFields((p) =>
    p.filter((f) => (typeof f === "string" ? f !== name : f.name !== name))
  );
  setLayout((p) =>
    p.map((s) => ({ ...s, fields: s.fields.filter((f) => f !== name) }))
  );

  // 🔥 Save a record so sync does NOT bring it back
  const ref = doc(db, "crm_fields", moduleName);
  await setDoc(
    ref,
    {
      deletedFields: {
        [name]: true,
      },
    },
    { merge: true }
  );
};

  const addTypedField = () => {
    const n = (newFieldName || "").trim();
    if (!n) return alert("Enter field name");
    const normalized = n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (existingNames.includes(normalized)) return alert("Field already exists");
    addMasterField("text", n, normalized);
    setNewFieldName("");
  };

  const addSection = async () => {
    const title =
      prompt("Section name (eg. 'Contact Details')") || `section_${Date.now()}`;
    const slug = title
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    if (!slug) return;
    setLayout((p) => [...p, { section: slug, fields: [] }]);
  };

  // Save layout & fields to Firestore (crm_fields/{module})
const handleSave = async () => {
  try {
    setLoading(true);

    // 🚨 1. Validate fields (no empty or undefined names)
    for (const f of fields) {
      if (!f || !f.name || f.name.trim() === "") {
        alert("A field has an empty name. Please fix it before saving.");
        console.error("Invalid field:", f);
        setLoading(false);
        return;
      }
    }

    // 🚨 2. Validate layout (no undefined or empty keys)
    for (const section of layout) {
      section.fields = section.fields.filter(
        (fname) => fname && fname.trim() !== ""
      );
    }

    // 🚨 3. Normalize fields safely
    const fieldsToStore = fields.map((f) => {
      if (typeof f === "string") {
        return {
          name: f,
          label: prettyLabel(f),
          type: "text",
          required: false,
          options: [],
        };
      }

      return {
        name: f.name,
        label: f.label || prettyLabel(f.name),
        type: f.type || "text",
        required: !!f.required,
        options: Array.isArray(f.options) ? f.options : [],
      };
    });

    // 🚨 4. Clean deletedFields — remove empty keys
    const ref = doc(db, "crm_fields", moduleName);
    const snap = await getDoc(ref);
    let deleted = {};
    if (snap.exists()) {
      deleted = snap.data().deletedFields || {};
    }

    // remove invalid keys
    const cleanedDeleted = {};
    Object.keys(deleted).forEach((key) => {
      if (key && key.trim() !== "") cleanedDeleted[key] = true;
    });

    // 🚨 5. Save safely
    await setDoc(
      ref,
      {
        moduleName,
        fields: fieldsToStore,
        layout: layout,
        deletedFields: cleanedDeleted,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    alert(`Layout saved to crm_fields/${moduleName}`);

    setRefreshKey((k) => k + 1);
  } catch (err) {
    console.error("save failed", err);
    alert("Save failed. Check console.");
  } finally {
    setLoading(false);
  }
};

  const clearLayout = () => {
    if (!window.confirm("Clear layout and fields?")) return;
    setFields([]);
    setLayout([
      { section: "header", fields: [] },
      { section: "main", fields: [] },
    ]);
  };

  const labelFor = (name) => {
    const f = fields.find((x) =>
      typeof x === "string" ? x === name : x.name === name
    );
    return f
      ? typeof f === "string"
        ? prettyLabel(f)
        : f.label
      : prettyLabel(name);
  };

  // ===== Sync existing lead fields =====
  const syncExistingFieldsFromModule = async () => {
  if (
    !window.confirm(
      `Scan '${moduleName}' collection and import fields into crm_fields/${moduleName}?`
    )
  )
    return;

  try {
    setLoading(true);

    const ref = collection(db, moduleName);
    const q = query(ref, limit(200));
    const snap = await getDocs(q);

    // 🔥 Load deleted fields list (so they never come back)
    const cfgRef = doc(db, "crm_fields", moduleName);
    const cfgSnap = await getDoc(cfgRef);
    const deletedMap = cfgSnap.exists() ? cfgSnap.data().deletedFields || {} : {};

    const keySet = new Set();

    snap.forEach((d) => {
      const data = d.data() || {};
      Object.keys(data).forEach((k) => {
        if (
          [
            "createdAt",
            "updatedAt",
            "createdBy",
            "updatedBy",
            "ownerUid",
            "autoId",
            "kpiId",
            "_systemDelete",
            "id"
          ].includes(k)
        )
          return;

        // ❗ skip deleted fields
        if (deletedMap[k]) return;

        keySet.add(k);
      });
    });

    const existingNames = fields.map((f) =>
      typeof f === "string" ? f : f.name
    );

    const incoming = Array.from(keySet)
      .filter((k) => !existingNames.includes(k))
      .map((k) => ({
        name: k,
        label: prettyLabel(k),
        type: "text",
        required: false,
        options: [],
      }));

    if (incoming.length === 0) {
      alert("No new fields found to import.");
      return;
    }

    setFields((p) => [...p, ...incoming]);

    alert(
      `Imported ${incoming.length} fields from ${moduleName}. Drag them into layout and Save Layout.`
    );
  } catch (err) {
    console.error("sync failed", err);
    alert("Sync failed. See console.");
  } finally {
    setLoading(false);
  }
};

  // Right-side Field Properties update/save
  const openFieldProperties = (fieldName) => {
    const f = fields.find(
      (x) => x.name === fieldName || x === fieldName
    );
    const normalized =
      typeof f === "string"
        ? {
            name: f,
            label: prettyLabel(f),
            type: "text",
            required: false,
            options: [],
          }
        : { ...(f || {}), options: f.options || [] };
    setEditingField(normalized);
  };

  const saveFieldProperties = (updated) => {
  setFields((prev) =>
    prev.map((f) =>
      (typeof f === "string" ? f : f.name) === updated.name ? updated : f
    )
  );
  setEditingField(null);
};

  // UI: small loading view
  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ color: "#555" }}>Loading layout editor...</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerBar}>
        <div style={styles.logo}>⚡ Kapil Power CRM</div>
        <div style={{ color: "#fff", opacity: 0.9 }}>
          Layout Builder — {moduleName}
        </div>
      </div>

      <div style={styles.container}>
        {/* Left toolbox */}
        <div style={styles.left}>
          <div style={styles.leftHeader}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>New Fields</div>
            <button style={styles.sectionBtn} onClick={addSection}>
              + Section
            </button>
          </div>

          <div style={styles.toolbox}>
            {TOOLBOX.map((t) => (
              <div
                key={t.type}
                draggable
                onDragStart={(e) => onDragStartToolbox(e, t)}
                style={styles.toolboxItem}
                title={`Drag "${t.label}"`}
              >
                {t.label}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <input
              placeholder="new field name"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              style={styles.input}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button style={styles.addBtn} onClick={addTypedField}>
                Add
              </button>
              <button
                style={styles.clearBtn}
                onClick={() => setNewFieldName("")}
              >
                Clear
              </button>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <button style={styles.syncBtn} onClick={syncExistingFieldsFromModule}>
              Sync existing fields from {moduleName}
            </button>
            <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
              Scans `{moduleName}` collection and imports field keys as fields (doesn't modify docs).
            </div>
          </div>
        </div>

        {/* Center editor */}
        <div style={styles.right}>
          <h2 style={{ marginTop: 0, marginBottom: 12, color: "#0f2b3e" }}>
            Edit Layout — {moduleName}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {layout.map((section, idx) => (
  <div
    key={`${section.section}_${idx}`}
    onDrop={(e) => onDropToSection(e, idx)}
    onDragOver={onDragOver}
    style={{
      padding: 12,
      borderRadius: 8,
      background: idx === 0 ? "#fff6e8" : "#f4fbff",
      border: "1px solid rgba(0,0,0,0.05)",
    }}
  >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>{section.section === "header" ? "Header section" : prettyLabel(section.section)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        setLayout((p) => {
                          if (idx === 0) return p;
                          const copy = [...p];
                          const [s] = copy.splice(idx, 1);
                          copy.splice(idx - 1, 0, s);
                          return copy;
                        });
                      }}
                    >
                      ↑
                    </button>
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        setLayout((p) => {
                          if (idx === p.length - 1) return p;
                          const copy = [...p];
                          const [s] = copy.splice(idx, 1);
                          copy.splice(idx + 1, 0, s);
                          return copy;
                        });
                      }}
                    >
                      ↓
                    </button>
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        if (!window.confirm("Remove this section? Fields will move to 'main'.")) return;
                        setLayout((p) => {
                          const copy = p.filter((_, i) => i !== idx);
                          const removed = p[idx].fields || [];
                          if (copy[1]) copy[1] = { ...copy[1], fields: [...new Set([...copy[1].fields, ...removed])] };
                          return copy;
                        });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 8 }}>
                  {section.fields.length === 0 ? (
                    <div style={{ color: "#666" }}>Drop fields here for {section.section}</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {section.fields.map((fname, idx) => (
  <div
    key={`${fname}_${idx}`}
    draggable
    onDragStart={(e) => onDragStartExisting(e, fname)}
    style={styles.fieldCard}
  >
                          <div>
                            <div style={{ fontWeight: 700 }}>{labelFor(fname)}</div>
                            <div style={{ color: "#777", fontSize: 12 }}>
                              {((fields.find((x) => (typeof x === "string" ? x === fname : x.name === fname)) || {}).type || "Single Line")}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              style={styles.smallBtn}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setLayout((p) => p.map((s, i) => i === idx ? { ...s, fields: s.fields.filter((f) => f !== fname) } : s));
                              }}
                            >
                              Remove
                            </button>
                            <button style={styles.propBtn} onClick={() => openFieldProperties(fname)}>Props</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button style={styles.saveBtn} onClick={handleSave}>Save Layout</button>
            <button style={styles.clearBtn} onClick={clearLayout}>Clear Layout</button>
            <button style={styles.previewBtn} onClick={() => setPreviewOpen(true)}>Preview Create Drawer</button>
            <div style={{ marginLeft: "auto" }}>
              <label style={{ color: "#666", fontSize: 14 }}>Module: </label>
              <strong style={{ marginLeft: 6 }}>{moduleName}</strong>
            </div>
          </div>
        </div>

        {/* Right side panel: Existing Fields + Field Properties */}
        <div style={{ width: 320 }}>
          {/* RIGHT PANEL - non-scrolling container so inner parts can scroll independently */}
          <div style={{
            background: "#800000",
            borderRadius: 8,
            color: "#fff",
            height: "calc(100vh - 100px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            <div style={styles.rightPanelHeader}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Existing Fields</div>
              <div style={{ color: "#fff", opacity: 0.85 }}>— {moduleName}</div>
            </div>

{/* Existing fields list - scrollable */}
<div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
  <div style={{ fontWeight: 700, marginBottom: 8 }}>Lead Information</div>

  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {fields.map((f, idx) => {
      const name = typeof f === "string" ? f : f.name;
      const label = typeof f === "string" ? prettyLabel(f) : f.label;

      return (
        <div key={`${name}_${idx}`} style={styles.rightFieldRow}>
          <div>{label}</div>

          <div style={{ display: "flex", gap: 6 }}>
            <button
              style={{
                background: "#ff3b3b",
                color: "#fff",
                border: "none",
                padding: "6px 8px",
                borderRadius: 6,
                cursor: "pointer",
              }}
              onClick={() => {
                if (window.confirm(`Delete field "${name}" permanently?`)) {
                  removeFieldFromMaster(name);
                }
              }}
            >
              Delete
            </button>

            <button
              style={styles.propBtn}
              onClick={() => openFieldProperties(name)}
            >
              Edit
            </button>
          </div>
        </div>
      );
    })}
  </div>
</div>

            {/* Field Properties: single block (no duplicates). Scroll area + sticky footer */}
            {editingField && (
  <div
    style={{
      borderTop: "1px solid rgba(255,255,255,0.04)",
      display: "flex",
      flexDirection: "column",
      height: "60vh",
    }}
  >
    {/* Scroll Area */}
    <div
      style={{
        padding: 12,
        overflowY: "auto",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "#fff",
          marginBottom: 8,
        }}
      >
        Field Properties
      </div>

      {/* Label */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: "#fff", fontSize: 13 }}>Label</label>
        <input
          value={editingField.label}
          onChange={(e) =>
            setEditingField({
              ...editingField,
              label: e.target.value,
            })
          }
          style={styles.rightInput}
        />
      </div>

      {/* Name (key) */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: "#fff", fontSize: 13 }}>Name (key)</label>
        <input
          value={editingField.name}
         onChange={(e) => {
  let newName = e.target.value.replace(/[^a-z0-9_]/gi, "_");
  if (newName.trim() === "") return;  // 🚫 don't allow empty key
  setEditingField({ ...editingField, name: newName });
}
          }
          style={styles.rightInput}
        />
      </div>

      {/* Type */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: "#fff", fontSize: 13 }}>Type</label>
        <select
          value={editingField.type}
          onChange={(e) =>
            setEditingField({
              ...editingField,
              type: e.target.value,
            })
          }
          style={{
            ...styles.rightInput,
            color: "#800000",
            background: "#fff",
            borderColor: "#800000",
          }}
        >
          {TOOLBOX.map((t) => (
            <option key={t.type} value={t.type} style={{ color: "#000" }}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Required */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <input
          type="checkbox"
          checked={!!editingField.required}
          onChange={(e) =>
            setEditingField({
              ...editingField,
              required: e.target.checked,
            })
          }
        />
        <label style={{ color: "#fff" }}>Required</label>
      </div>
      {/* SAVE + CANCEL RIGHT HERE */}
<div style={{ marginTop: 12, display: "flex", gap: 10 }}>
  <button
    style={styles.saveBtn}
    onClick={() => saveFieldProperties(editingField)}
  >
    Save
  </button>

  <button
    style={{
      background: "#fff",
      color: "#800000",
      padding: "10px 16px",
      borderRadius: 8,
      border: "1px solid #800000",
      cursor: "pointer",
    }}
    onClick={() => setEditingField(null)}
  >
    Cancel
  </button>
</div>

      {/* Options */}
{/* Options */}
{(editingField.type === "picklist" || editingField.type === "multiselect") && (
  <div style={{ marginBottom: 8 }}>
    <label style={{ color: "#fff", fontSize: 13 }}>
      Options (comma separated)
    </label>

<input
  value={(editingField.options || []).join(",")}
  onChange={(e) =>
    setEditingField({
      ...editingField,
      options: e.target.value
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x),
    })
  }
  style={{
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: "#fff",
    color: "#000",
  }}
/>
  </div>
)}
    </div>

    {/* FIXED Save + Cancel Footer */}
    <div
      style={{
        padding: 12,
        borderTop: "1px solid rgba(255,255,255,0.15)",
        background: "#7a0000",
        display: "flex",
        gap: 10,
      }}
    >
      <button
        style={styles.saveBtn}
        onClick={() => saveFieldProperties(editingField)}
      >
        Save
      </button>

      <button
        style={{
          background: "#fff",
          color: "#800000",
          padding: "10px 16px",
          borderRadius: 8,
          border: "1px solid #800000",
          cursor: "pointer",
        }}
        onClick={() => setEditingField(null)}
      >
        Cancel
      </button>
    </div>
  </div>
)}
          </div>
        </div>
      </div>

      {/* Preview drawer */}
      {previewOpen && (
        <DynamicCreateDrawer
          moduleName={moduleName}
          onClose={() => {
            setPreviewOpen(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/* Styles - Kapil Power theme (inline for convenience) */
const styles = {
  page: { minHeight: "100vh", background: "#fff", fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" },
  headerBar: { height: 56, background: "#800000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", fontWeight: 700 },
  logo: { display: "flex", gap: 10, alignItems: "center", color: "#fff" },
  container: { display: "flex", gap: 20, padding: 20 },

  left: { width: 300, background: "#071827", color: "#fff", padding: 16, borderRadius: 8, minHeight: 520 },
  leftHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionBtn: { background: "#0b3a56", color: "#fff", padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer" },
  toolbox: { display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 },
  toolboxItem: { background: "#0f3146", padding: "8px 10px", borderRadius: 6, border: "1px solid #123247", cursor: "grab" },
  input: { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc" },
  addBtn: { flex: 1, background: "#fff", color: "#071827", padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer" },
  clearBtn: { flex: 1, background: "#fff", color: "#071827", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer" },
  existingItem: { display: "flex", gap: 8, alignItems: "center", background: "#0b2431", padding: "8px", borderRadius: 6, marginBottom: 8 },
  deleteSmall: { background: "#2b2b2b", color: "#fff", border: "none", padding: "6px 8px", borderRadius: 6, cursor: "pointer" },
  syncBtn: { width: "100%", background: "#800000", color: "#fff", padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer" },
  right: { flex: 1, padding: 8 },
  fieldCard: { background: "#fff", padding: 12, borderRadius: 8, border: "1px solid #e6e6e6", display: "flex", justifyContent: "space-between", alignItems: "center" },
  smallBtn: { padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" },
  saveBtn: { background: "#800000", color: "#fff", padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer" },
  previewBtn: { background: "#fff", color: "#800000", padding: "10px 12px", borderRadius: 8, border: "1px solid #800000", cursor: "pointer" },
  rightPanel: { background: "#800000", borderRadius: 8, color: "#fff", minHeight: 520, height: "calc(100vh - 100px)", overflowY: "auto", overflowX: "hidden", paddingBottom: 20 },
  rightPanelHeader: { padding: 12, borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" },
  rightFieldRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 6 },
  addSmall: { background: "#fff", color: "#800000", border: "none", padding: "6px 8px", borderRadius: 6, cursor: "pointer" },
  propBtn: { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.08)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" },
  rightInput: { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", marginTop: 6, background: "rgba(255,255,255,0.03)", color: "#fff" },
};
