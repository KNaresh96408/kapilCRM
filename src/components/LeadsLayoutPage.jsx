import React, { useEffect, useState, useRef } from "react";
import { db, serverTimestamp } from "../firebaseConfig";
import { doc, getDoc, setDoc, collection, getDocs, addDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";

/*
  LeadsLayoutPage.jsx
  - Single-file implementation that contains:
    1) LeadsLayoutEditor component (Zoho-like left toolbox + right layout)
    2) LeadDrawerDynamic component (reads crm_fields/leads and renders a create/edit drawer grouped by layout)

  Drop this file into src/components/LeadsLayoutPage.jsx and import the editor where needed.
  Adjust firebase import path if different in your project.
*/

// ----------------------- Helper utils -----------------------
function prettyLabel(name) {
  if (!name) return "";
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/([A-Z])/g, " $1")
    .trim();
}

// ----------------------- Leads Layout Editor -----------------------
export function LeadsLayoutEditor({ onSaved }) {
  const toolbox = [
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
  ];

  const [fields, setFields] = useState([]); // master field definitions (simple objects or string names)
  const [layout, setLayout] = useState([
    { section: "header", fields: [] },
    { section: "main", fields: [] },
  ]);
  const [newFieldName, setNewFieldName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const ref = doc(db, "crm_fields", "leads");
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setFields([]);
          setLayout([
            { section: "header", fields: [] },
            { section: "main", fields: [] },
          ]);
        } else {
          const d = snap.data();
          const defs = Array.isArray(d.fields) ? d.fields : [];
          // normalize: if stored as strings, convert to objects
          const normalizedFields = defs.map((f) =>
            typeof f === "string"
              ? { name: f, label: prettyLabel(f), type: "text", required: false }
              : f
          );

          setFields(normalizedFields);

          if (Array.isArray(d.layout) && d.layout.length > 0) {
            setLayout(
              d.layout.map((l) => ({
                section: l.section,
                fields: Array.isArray(l.fields) ? l.fields : [],
              }))
            );
          }
        }
      } catch (e) {
        console.error("Failed to load crm_fields/leads", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const addMasterField = (type, label, suggestedName) => {
    const base = (suggestedName || label || type || "field").toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    let candidate = base || `field_${Date.now()}`;
    let i = 1;
    const names = fields.map((f) => (typeof f === "string" ? f : f.name));
    while (names.includes(candidate)) {
      candidate = `${base}_${i}`;
      i++;
    }

    const obj = { name: candidate, label: prettyLabel(suggestedName || label || candidate), type: type || "text", required: false };
    setFields((p) => [...p, obj]);
    return obj.name;
  };

  // drag/drop helpers
  const onDragStartToolbox = (e, t) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ from: "toolbox", payload: t }));
  };
  const onDragStartExisting = (e, name) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ from: "existing", payload: name }));
  };
  const onDragOver = (e) => e.preventDefault();

  const onDropToSection = (e, sectionIndex) => {
    e.preventDefault();
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
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
      console.error("drop error", err);
    }
  };

  const removeFieldFromMaster = (name) => {
    if (!window.confirm(`Delete field ${name.name || name}?`)) return;
    const n = typeof name === "string" ? name : name.name;
    setFields((p) => p.filter((f) => (typeof f === "string" ? f !== n : f.name !== n)));
    setLayout((prev) => prev.map((s) => ({ ...s, fields: s.fields.filter((f) => f !== n) })));
  };

  const saveLayout = async () => {
    try {
      const ref = doc(db, "crm_fields", "leads");
      // store fields as objects
      const fieldsToStore = fields.map((f) => (typeof f === "string" ? { name: f, label: prettyLabel(f), type: "text" } : f));
      const payload = { fields: fieldsToStore, layout: layout, moduleName: "leads" };
      await setDoc(ref, payload, { merge: true });
      alert("Layout saved");
      onSaved?.();
    } catch (e) {
      console.error("Failed to save layout", e);
      alert("Save failed - see console");
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Loading layout...</div>;

  return (
    <div style={{ display: "flex", gap: 18, padding: 20 }}>
      {/* Left: toolbox + existing */}
      <div style={{ width: 280, background: "#0f2230", color: "#fff", padding: 12, borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>New Fields</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {toolbox.map((t) => (
            <div key={t.type} draggable onDragStart={(e) => onDragStartToolbox(e, t)} style={{ background: "#162a3a", padding: 8, borderRadius: 6, cursor: "grab" }}>
              {t.label}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <input value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} placeholder="new field name" style={{ width: "100%", padding: 8, borderRadius: 6 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => { if (!newFieldName.trim()) return alert('enter name'); const n = addMasterField('text', newFieldName, newFieldName); setNewFieldName(''); }} style={{ flex: 1, padding: 8, borderRadius: 6 }}>Add</button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <h4>Existing Fields</h4>
          <div style={{ display: 'grid', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {fields.map((f) => {
              const name = typeof f === 'string' ? f : f.name;
              return (
                <div key={name} draggable onDragStart={(e) => onDragStartExisting(e, name)} style={{ background: '#071727', color: '#fff', padding: 8, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>{typeof f === 'string' ? prettyLabel(f) : f.label}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => removeFieldFromMaster(f)} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.06)', padding: '4px 6px', borderRadius: 6 }}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: layout */}

      <div style={{ flex: 1 }}>
        <h2 style={{ marginTop: 0 }}>Edit Layout — leads</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {layout.map((section, idx) => (
            <div key={section.section} onDrop={(e) => onDropToSection(e, idx)} onDragOver={onDragOver} style={{ padding: 12, borderRadius: 8, background: idx === 0 ? '#fff6e8' : '#f2fbff' }}>
              <h3 style={{ marginTop: 0 }}>{section.section === 'header' ? 'Header section' : 'Main section'}</h3>
              <div style={{ minHeight: 80 }}>
                {section.fields.length === 0 && <div style={{ color: '#777' }}>Drop fields here for {section.section}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  {section.fields.map((f) => (
                    <div key={f} draggable onDragStart={(e) => onDragStartExisting(e, f)} style={{ background: '#fff', padding: 10, borderRadius: 6, border: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>{prettyLabel(f)}</div>
                      <div>
                        <button onClick={() => setLayout((p) => p.map((s, i) => i === idx ? { ...s, fields: s.fields.filter(x => x !== f) } : s))} style={{ border: 'none', background: '#eee', padding: '6px 8px', borderRadius: 6 }}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={saveLayout} style={{ background: '#800000', color: '#fff', padding: '10px 16px', borderRadius: 8, border: 'none' }}>Save Layout</button>
            <button onClick={() => { setFields([]); setLayout([{ section: 'header', fields: [] }, { section: 'main', fields: [] }]); }} style={{ background: '#eee', padding: '10px 16px', borderRadius: 8 }}>Clear Layout</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------- Lead Drawer Dynamic (reads layout + fields) -----------------------
export function LeadDrawerDynamicIntegrated({ onClose, onLeadAdded, existingLead }) {
  const auth = getAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [fieldsDef, setFieldsDef] = useState([]); // array of objects {name,label,type,required,options}
  const [layout, setLayout] = useState([]); // array of sections
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [consultants, setConsultants] = useState([]);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setCurrentUser(u || null));
    return () => unsub && unsub();
  }, [auth]);

  // load consultants for assignedConsultant
  useEffect(() => {
    const fetchConsultants = async () => {
      try {
        const snap = await getDocs(collection(db, 'Users'));
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setConsultants(users.filter(u => (u.designation || u.role || '').toString().toLowerCase().includes('consultant')));
      } catch (e) { console.warn('fetch consultants', e); }
    };
    fetchConsultants();
  }, []);

  // load crm_fields/leads (fields + layout)
  useEffect(() => {
    const load = async () => {
      try {
        const ref = doc(db, 'crm_fields', 'leads');
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setFieldsDef([]);
          setLayout([]);
          setForm({});
          setLoading(false);
          return;
        }

        const data = snap.data();
        const defs = Array.isArray(data.fields) ? data.fields : [];
        const normalized = defs.map(f => (typeof f === 'string' ? { name: f, label: prettyLabel(f), type: 'text', required: false } : f));
        setFieldsDef(normalized);

        const lay = Array.isArray(data.layout) ? data.layout : [{ section: 'header', fields: [] }, { section: 'main', fields: [] }];
        setLayout(lay);

        // initialize form for create/edit
        const initial = {};
        normalized.forEach(fd => { initial[fd.name] = existingLead?.[fd.name] ?? (fd.type === 'boolean' ? false : ''); });
        setForm(initial);

      } catch (err) {
        console.error('load crm_fields/leads failed', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [existingLead]);

  // ensure new fields added while creating are in form state
  useEffect(() => {
    if (fieldsDef.length === 0) return;
    setForm(prev => {
      const updated = { ...prev };
      fieldsDef.forEach(fd => { if (updated[fd.name] === undefined) updated[fd.name] = ''; });
      return updated;
    });
  }, [fieldsDef]);

  const handleChange = (name, value) => setForm(p => ({ ...p, [name]: value }));

  const renderField = (fd) => {
    const val = form[fd.name] ?? '';
    const common = { id: fd.name, name: fd.name, value: val, placeholder: fd.placeholder || '', onChange: (e) => handleChange(fd.name, e.target.type === 'checkbox' ? e.target.checked : e.target.value) };

    if (fd.type === 'textarea') return <textarea {...common} rows={3} style={{ padding: 8, borderRadius: 6, border: '1px solid #ccc' }} />;
    if (fd.type === 'select' || fd.type === 'picklist') return (
      <select {...common} value={val} style={{ padding: 8, borderRadius: 6 }}>
        <option value="">{fd.placeholder || 'Select'}</option>
        {(fd.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
    if (fd.type === 'date') return <input type="date" {...common} />;
    if (fd.type === 'checkbox') return <input type="checkbox" checked={!!val} onChange={(e) => handleChange(fd.name, e.target.checked)} />;
    if (fd.type === 'email') return <input type="email" {...common} />;
    if (fd.type === 'phone' || fd.type === 'tel') return <input type="tel" {...common} />;
    if (fd.type === 'number' || fd.type === 'currency') return <input type="number" {...common} />;
    return <input type="text" {...common} />;
  };

  const saveLead = async () => {
    if (!currentUser) return alert('Login expired');
    setLoading(true);
    try {
      const leadData = { ...form, updatedAt: serverTimestamp(), updatedBy: currentUser.email };
      if (existingLead?.id) {
        const ref = doc(db, 'leads', existingLead.id);
        await setDoc(ref, leadData, { merge: true });
        alert('Lead updated');
      } else {
        leadData.createdAt = serverTimestamp();
        leadData.createdBy = currentUser.email;
        const ref = await addDoc(collection(db, 'leads'), leadData);
        alert('Lead created');
      }
      onLeadAdded?.();
      onClose?.();
    } catch (e) {
      console.error('save lead failed', e);
      alert('Save failed');
    } finally { setLoading(false); }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading form fields...</div>;

  // helper to find def by name
  const defByName = (name) => fieldsDef.find(f => f.name === name) || { name, label: prettyLabel(name), type: 'text' };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(128,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 999 }}>
      <div style={{ width: 520, background: '#fff', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{existingLead ? 'Edit Lead' : 'Add Lead'}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 18 }}>✖</button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {layout.map((section) => (
            <div key={section.section} style={{ marginBottom: 18 }}>
              <h4 style={{ marginBottom: 8 }}>{section.section === 'header' ? 'Header' : 'Lead Information'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {section.fields.map((fname) => {
                  const fd = defByName(fname);
                  return (
                    <div key={fname} style={{ display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontWeight: 600, marginBottom: 6 }}>{fd.label}{fd.required ? ' *' : ''}</label>
                      {fd.name === 'assignedConsultant' ? (
                        <select value={form[fd.name] || ''} onChange={(e) => handleChange(fd.name, e.target.value)} style={{ padding: 8, borderRadius: 6 }}>
                          <option value="">Select Consultant</option>
                          {consultants.map(c => <option key={c.email || c.id} value={c.email || c.id}>{c.Name || c.name || c.email}</option>)}
                        </select>
                      ) : (
                        renderField(fd)
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: 12, borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: 8 }}>
          <button onClick={saveLead} style={{ background: '#800000', color: '#fff', padding: '10px 14px', borderRadius: 6, border: 'none' }}>{loading ? 'Saving...' : existingLead ? 'Save' : 'Add Lead'}</button>
          <button onClick={onClose} style={{ padding: '10px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------- Default export: Page that exports both tools -----------------------
export default function LeadsLayoutPage() {
  const [openDrawer, setOpenDrawer] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div style={{ padding: 20 }}>
      <LeadsLayoutEditor onSaved={() => setRefreshKey(k => k + 1)} />

      <div style={{ marginTop: 24 }}>
        <button onClick={() => setOpenDrawer(true)} style={{ background: '#800000', color: '#fff', padding: '10px 16px', borderRadius: 6, border: 'none' }}>Open Add Lead Drawer (preview)</button>
      </div>

      {openDrawer && <LeadDrawerDynamicIntegrated onClose={() => setOpenDrawer(false)} onLeadAdded={() => setOpenDrawer(false)} />}
    </div>
  );
}
