import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { doc, getDoc, updateDoc } from "firebase/firestore";

// DynamicEditPage.jsx - STEP 8 (Edit Form)
// Auto-generates an edit form for any module using its createLayout/detailLayout
// Place at: src/components/Dynamic/DynamicEditPage.jsx

export default function DynamicEditPage({ module, moduleConfig, recordId, onUpdated }) {
  const [layout, setLayout] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);

  useEffect(() => {
    loadInitialData();
  }, [module, recordId]);

  const loadInitialData = async () => {
    try {
      setLoading(true);

      // Load layout
      const layoutRef = doc(db, "crm_fields", moduleConfig.moduleId);
      const layoutSnap = await getDoc(layoutRef);
      if (layoutSnap.exists()) {
        const data = layoutSnap.data();
        setLayout(data.createLayout || data.detailLayout || []);
      }

      // Load record
      const recRef = doc(db, `records_${module}`, recordId);
      const recSnap = await getDoc(recRef);

      if (recSnap.exists()) {
        const recData = recSnap.data();
        setRecord(recData);
        setValues(recData);
      }

      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleChange = (fieldApi, val) => {
    setValues((prev) => ({ ...prev, [fieldApi]: val }));
  };

  const handleSubmit = async () => {
    try {
      const ref = doc(db, `records_${module}`, recordId);

      const payload = {
        ...values,
        _meta: {
          ...(record?._meta || {}),
          updatedAt: new Date().toISOString(),
          updatedBy: "user", // replace with auth.uid
        },
      };

      await updateDoc(ref, payload);
      alert("Record updated successfully!");

      onUpdated && onUpdated();
    } catch (e) {
      console.error(e);
      alert("Failed to update record");
    }
  };

  const renderField = (f) => {
    const fieldApi = f.fieldApiName || f.label;
    const val = values[fieldApi] || "";

    // Auto-number fields should be readonly during edit
    if (f.type === "Auto-Number") {
      return (
        <input
          className="w-full border rounded px-3 py-2 bg-gray-100 text-gray-500"
          value={val}
          readOnly
        />
      );
    }

    // PICKLIST
    if (f.type === "Pick List") {
      return (
        <select
          className="w-full border rounded px-3 py-2"
          value={val}
          onChange={(e) => handleChange(fieldApi, e.target.value)}
        >
          <option value="">Select...</option>
          {(f.options || []).map((o, i) => (
            <option key={i} value={o}>{o}</option>
          ))}
        </select>
      );
    }

    // MULTI-SELECT
    if (f.type === "Multi-Select") {
      return (
        <select
          className="w-full border rounded px-3 py-2"
          multiple
          value={val || []}
          onChange={(e) =>
            handleChange(
              fieldApi,
              Array.from(e.target.selectedOptions, (o) => o.value)
            )
          }
        >
          {(f.options || []).map((o, i) => (
            <option key={i} value={o}>{o}</option>
          ))}
        </select>
      );
    }

    // DATE
    if (f.type === "Date") {
      return (
        <input
          type="date"
          className="w-full border rounded px-3 py-2"
          value={val}
          onChange={(e) => handleChange(fieldApi, e.target.value)}
        />
      );
    }

    // DEFAULT INPUT
    return (
      <input
        className="w-full border rounded px-3 py-2"
        value={val}
        onChange={(e) => handleChange(fieldApi, e.target.value)}
        placeholder={f.label}
      />
    );
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-semibold mb-4">Edit {moduleConfig.name}</h2>

      {loading ? (
        <p>Loading...</p>
      ) : !record ? (
        <p className="text-red-600">Record not found.</p>
      ) : (
        <div className="space-y-4">
          {layout.map((f) => (
            <div key={f.id}>
              <label className="block mb-1 font-medium">{f.label}</label>
              {renderField(f)}
            </div>
          ))}

          <button
            onClick={handleSubmit}
            className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded"
          >
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
