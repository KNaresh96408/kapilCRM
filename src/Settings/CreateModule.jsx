import React, { useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, addDoc, setDoc, doc, serverTimestamp } from "firebase/firestore";

// CreateModule.jsx
// Modal component to create a new module and initialize its fields layout in Firestore.
// Place this file at: src/components/Settings/CreateModule.jsx

export default function CreateModuleModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [pluralName, setPluralName] = useState("");
  const [icon, setIcon] = useState("cube"); // simple icon key; you can replace with your icon picker
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const makeApiName = (s) => {
    if (!s) return "";
    return s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  };

  const handleCreate = async () => {
    if (!name.trim()) return alert("Please enter module name");

    setLoading(true);
    try {
      const apiName = makeApiName(name) || `m_${Date.now()}`;

      // Create module doc in crm_modules
      const modulesRef = collection(db, "crm_modules");
      const newModule = {
        name: name.trim(),
        pluralName: pluralName.trim() || name.trim() + "s",
        apiName,
        icon,
        enabled,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const created = await addDoc(modulesRef, newModule);

      // Initialize empty layouts in crm_fields with the created doc id
      await setDoc(doc(db, "crm_fields", created.id), {
        createLayout: [],
        detailLayout: [],
        quickCreateLayout: [],
        moduleId: created.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setLoading(false);
      onCreated && onCreated({ id: created.id, ...newModule });
      onClose && onClose();
      alert("Module created successfully");
    } catch (err) {
      console.error(err);
      setLoading(false);
      alert("Failed to create module. Check console for details.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Create New Module</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-800">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Module Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded px-3 py-2 focus:outline-none"
              placeholder="e.g. Project"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Plural Name (optional)</label>
            <input
              value={pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              className="w-full border rounded px-3 py-2 focus:outline-none"
              placeholder="e.g. Projects"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">API Name (generated)</label>
            <input
              readOnly
              value={makeApiName(name) || "(auto-generated)"}
              className="w-full border rounded px-3 py-2 bg-gray-50"
            />
            <p className="text-xs text-gray-500 mt-1">API name will be used internally for data storage and queries.</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-1/2">
              <label className="block text-sm font-medium mb-1">Icon (key)</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full border rounded px-3 py-2" />
              <p className="text-xs text-gray-500 mt-1">Type an icon key (you can integrate your icon picker later).</p>
            </div>

            <div className="w-1/2">
              <label className="block text-sm font-medium mb-1">Enabled</label>
              <div>
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mr-2" />
                  <span className="text-sm">Module is active</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-2">
            <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
            <button onClick={handleCreate} disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded">
              {loading ? "Creating..." : "Create Module"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
