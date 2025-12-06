import React, { useState, useEffect } from "react";
import { db } from "../../firebaseConfig";
import { doc, updateDoc } from "firebase/firestore";

// EditModule.jsx
// Modal for editing module details: name, pluralName, icon, enabled.
// Place this file at: src/components/Settings/EditModule.jsx

export default function EditModuleModal({ moduleData, onClose, onUpdated }) {
  const [name, setName] = useState("");
  const [pluralName, setPluralName] = useState("");
  const [icon, setIcon] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (moduleData) {
      setName(moduleData.name || "");
      setPluralName(moduleData.pluralName || "");
      setIcon(moduleData.icon || "");
      setEnabled(moduleData.enabled ?? true);
    }
  }, [moduleData]);

  const handleUpdate = async () => {
    if (!name.trim()) return alert("Module name cannot be empty");
    setLoading(true);

    try {
      const ref = doc(db, "crm_modules", moduleData.id);
      await updateDoc(ref, {
        name: name.trim(),
        pluralName: pluralName.trim() || name.trim() + "s",
        icon: icon.trim(),
        enabled,
        updatedAt: new Date().toISOString(),
      });

      setLoading(false);
      onUpdated && onUpdated();
      onClose && onClose();
      alert("Module updated successfully");
    } catch (err) {
      console.error(err);
      setLoading(false);
      alert("Failed to update module");
    }
  };

  if (!moduleData) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Edit Module</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Module Name</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Plural Name</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={pluralName}
              onChange={(e) => setPluralName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Icon Key</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">Enter your icon name (or integrate icon picker later).</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="text-sm">Module Enabled</span>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 border rounded-md">Cancel</button>
          <button
            onClick={handleUpdate}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md"
          >
            {loading ? "Updating..." : "Update Module"}
          </button>
        </div>
      </div>
    </div>
  );
}
