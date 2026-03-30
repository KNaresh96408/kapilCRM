import React, { useState, useEffect } from "react";
import { db } from "../../firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

// ModulesAndFieldsBuilder_v2.jsx
// Upgraded builder with multi-layout support: Create / Detail / Quick Create
// Place at: src/components/Settings/ModulesAndFieldsBuilder_v2.jsx

export default function ModulesAndFieldsBuilderV2({ onClose }) {
  const [modules, setModules] = useState([]);
  const [selectedModule, setSelectedModule] = useState(null);
  const [activeLayout, setActiveLayout] = useState("create"); // 'create' | 'detail' | 'quick'
  const [layout, setLayout] = useState([]);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [editingField, setEditingField] = useState(null);

  const FIELD_TYPES = [
    "Single Line",
    "Multi-Line",
    "Email",
    "Phone",
    "Number",
    "Decimal",
    "Long Integer",
    "Percent",
    "Currency",
    "Date",
    "Date/Time",
    "Pick List",
    "Multi-Select",
    "Checkbox",
    "URL",
    "Auto-Number",
    "Lookup",
    "Multi-User",
    "File Upload",
    "Image Upload",
    "Formula",
    "User",
  ];

  useEffect(() => {
    loadModules();
  }, []);

  useEffect(() => {
    if (selectedModule) loadModuleLayout(selectedModule.id);
  }, [selectedModule, activeLayout]);

  const loadModules = async () => {
    try {
      const rows = await import('../../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('crm_modules'));
      const arr = rows.map((r) => ({ id: r.id, ...r }));
      setModules(arr);
    } catch (err) {
      console.warn('Modules loader failed:', err);
      setModules([]);
    }
  }; 

  const loadModuleLayout = async (moduleId) => {
    const TIMEOUT_MS = 2500;
    try {
      const refDoc = doc(db, "crm_fields", moduleId);
      const getPromise = getDoc(refDoc);
      const snap = await Promise.race([
        getPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('crm_fields fetch timeout')), TIMEOUT_MS)),
      ]);

      if (snap && snap.exists && snap.exists()) {
        const data = snap.data() || {};
        if (activeLayout === 'create') setLayout(data.createLayout || []);
        else if (activeLayout === 'detail') setLayout(data.detailLayout || []);
        else if (activeLayout === 'quick') setLayout(data.quickCreateLayout || []);
        return;
      }
    } catch (err) {
      console.warn('🟡 loadModuleLayout DB failed, trying REST', err && (err.message || err));
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
        const parsed = stored ? JSON.parse(stored) : null;
        const token = (parsed && parsed.idToken) || null;
        if (token) {
          const { fetchDocumentREST } = await import('../../helpers/firestoreRest');
          const rest = await fetchDocumentREST(`crm_fields/${moduleId}`, token);
          const layoutData = rest || {};
          if (activeLayout === 'create') setLayout(layoutData.createLayout || []);
          else if (activeLayout === 'detail') setLayout(layoutData.detailLayout || []);
          else if (activeLayout === 'quick') setLayout(layoutData.quickCreateLayout || []);
          return;
        }
      } catch (restErr) {
        console.warn('🟡 loadModuleLayout REST failed', restErr && (restErr.message || restErr));
      }
    }

    setLayout([]);
  }; 

  const handleSelectModule = async (m) => {
    setSelectedModule(m);
  };

  const handleAddField = (type) => {
    const newField = {
      id: "f" + Date.now(),
      label: type + " Field",
      type,
      required: false,
      options: [],
    };

    const updated = [...layout, newField];
    setLayout(updated);
  };

  const handleEditField = (field) => {
    setEditingField(field);
    setShowFieldEditor(true);
  };

  const handleSaveField = (updated) => {
    const replaced = layout.map((f) => (f.id === updated.id ? updated : f));
    setLayout(replaced);
    setShowFieldEditor(false);
  };

  const handleRemoveField = (fieldId) => {
    const filtered = layout.filter((f) => f.id !== fieldId);
    setLayout(filtered);
  };

  const handleSaveLayout = async () => {
    if (!selectedModule) return alert("Please select a module");

    const ref = doc(db, "crm_fields", selectedModule.id);

    // read existing doc to merge other layouts
    const snap = await getDoc(ref);
    let payload = {};
    if (snap.exists()) payload = snap.data();

    if (activeLayout === "create") payload.createLayout = layout;
    else if (activeLayout === "detail") payload.detailLayout = layout;
    else if (activeLayout === "quick") payload.quickCreateLayout = layout;

    payload.updatedAt = new Date().toISOString();
    payload.moduleId = selectedModule.id;

    await setDoc(ref, payload, { merge: true });

    alert(`Saved ${activeLayout} layout for ${selectedModule.name}`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">Modules & Fields Builder</h2>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 border rounded-md">Close</button>
            <button onClick={handleSaveLayout} className="px-4 py-2 bg-indigo-600 text-white rounded-md">Save</button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Left: Field Palette */}
          <aside className="col-span-3 bg-gray-50 border rounded-lg p-4 h-full">
            <h3 className="font-semibold mb-4">Field Palette</h3>
            <div className="space-y-2 overflow-y-auto max-h-[65vh]">
              {FIELD_TYPES.map((f) => (
                <div key={f} onClick={() => handleAddField(f)} className="p-2 bg-white border rounded cursor-pointer hover:bg-indigo-50 text-sm">{f}</div>
              ))}
            </div>
          </aside>

          {/* Middle: Layout Editor */}
          <main className="col-span-6 border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Layout Editor</h3>

              <div className="flex items-center gap-2">
                <button onClick={() => setActiveLayout("create")} className={`px-3 py-1 rounded ${activeLayout==="create"?"bg-indigo-600 text-white":"border"}`}>CREATE</button>
                <button onClick={() => setActiveLayout("detail")} className={`px-3 py-1 rounded ${activeLayout==="detail"?"bg-indigo-600 text-white":"border"}`}>DETAIL</button>
                <button onClick={() => setActiveLayout("quick")} className={`px-3 py-1 rounded ${activeLayout==="quick"?"bg-indigo-600 text-white":"border"}`}>QUICK CREATE</button>
              </div>
            </div>

            {!selectedModule ? (
              <p className="text-gray-500">Select a module from the right panel to begin.</p>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3">Editing <strong>{selectedModule.name}</strong> — <em>{activeLayout.toUpperCase()}</em> layout</p>

                {layout.length === 0 && (
                  <p className="text-gray-400 mb-2">No fields added yet. Use the left palette to add fields.</p>
                )}

                <div className="space-y-3">
                  {layout.map((field, idx) => (
                    <div key={field.id} className="p-3 bg-white border rounded flex justify-between items-center">
                      <div>
                        <p className="font-medium">{field.label} <span className="text-xs text-gray-500">({field.type})</span></p>
                        <p className="text-xs text-gray-500">Position: {idx + 1}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEditField(field)} className="text-indigo-600 text-sm">Edit</button>
                        <button onClick={() => handleRemoveField(field.id)} className="text-red-600 text-sm">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </main>

          {/* Right: Module Selector */}
          <aside className="col-span-3 bg-gray-50 border rounded-lg p-4 h-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Modules</h3>
              <div className="text-xs text-gray-500">Select to load</div>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[65vh]">
              {modules.map((m) => (
                <div key={m.id} onClick={() => handleSelectModule(m)} className={`p-2 border rounded cursor-pointer text-sm hover:bg-indigo-50 ${selectedModule?.id===m.id?"bg-indigo-100 border-indigo-400":"bg-white"}`}>
                  <div className="flex justify-between items-center">
                    <div>{m.name}</div>
                    <div className="text-xs text-gray-500">{m.enabled?"Active":"Disabled"}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 text-center">
              <small className="text-gray-500">To add or edit modules, use the Create/Edit module modals.</small>
            </div>
          </aside>
        </div>

        {/* Field Editor Modal */}
        {showFieldEditor && (
          <FieldEditorModal field={editingField} onClose={() => setShowFieldEditor(false)} onSave={handleSaveField} />
        )}
      </div>
    </div>
  );
}

// Field Editor Modal (same as previous) - included here for completeness
function FieldEditorModal({ field, onClose, onSave }) {
  const [label, setLabel] = useState(field?.label || "");
  const [required, setRequired] = useState(field?.required || false);
  const [options, setOptions] = useState(field?.options || []);

  useEffect(() => {
    setLabel(field?.label || "");
    setRequired(field?.required || false);
    setOptions(field?.options || []);
  }, [field]);

  const handleAddOption = () => {
    const value = prompt("Enter option value");
    if (value) setOptions([...options, value]);
  };

  const handleSave = () => {
    onSave({ ...field, label, required, options });
  };

  if (!field) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Edit Field</h3>

        <label className="block mb-1 text-sm font-medium">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full border rounded px-2 py-1 mb-3" />

        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span className="text-sm">Required</span>
        </div>

        {(field?.type === "Pick List" || field?.type === "Multi-Select") && (
          <div className="mb-3">
            <label className="block mb-1 text-sm font-medium">Options</label>
            <div className="space-y-1 mb-2 text-sm">
              {options.map((op, i) => (
                <div key={i} className="p-1 bg-gray-100 rounded">{op}</div>
              ))}
            </div>
            <button onClick={handleAddOption} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm">Add Option</button>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-3 py-1 border rounded">Cancel</button>
          <button onClick={handleSave} className="px-3 py-1 bg-indigo-600 text-white rounded">Save</button>
        </div>
      </div>
    </div>
  );
}