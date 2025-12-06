import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, addDoc, doc, getDoc } from "firebase/firestore";

// DynamicCreatePage.jsx - STEP 8 (Create Form)
// Auto‑generates a create form for any module using its createLayout
// Place at: src/components/Dynamic/DynamicCreatePage.jsx

export default function DynamicCreatePage({ module, moduleConfig, onCreated }) {
  const [layout, setLayout] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLayout();
  }, [module]);

  const loadLayout = async () => {
    try {
      setLoading(true);
      const ref = doc(db, "crm_fields", moduleConfig.moduleId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setLayout(data.createLayout || []);
      }
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleChange = (fieldApi, val) => {
    setValues((prev) => ({ ...prev, [fieldApi]: val }));
  };

  const handleSubmit = async () => {
    try {
      const col = collection(db, `records_${module}`);

      // auto-number handling
      const finalValues = { ...values };
      layout.forEach((f) => {
        if (f.type === "Auto-Number") {
          const num = f.startNumber || 1;
          finalValues[f.fieldApiName] = `${f.prefix || ""}${num}${f.suffix || ""}`;
        }
      });

      const payload = {
        ...finalValues,
        _meta: {
          createdAt: new Date().toISOString(),
          createdBy: "user", // replace with auth.uid
        },
      };

      await addDoc(col, payload);
      alert("Record created successfully!");

      onCreated && onCreated();
    } catch (e) {
      console.error(e);
      alert("Failed to create record");
    }
  };

  const renderField = (f) => {
    const fieldApi = f.fieldApiName || f.label;
    const val = values[fieldApi] || "";

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
      <h2 className="text-2xl font-semibold mb-4">Create {moduleConfig.name}</h2>

      {loading ? (
        <p>Loading...</p>
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
            Create
          </button>
        </div>
      )}
    </div>
  );
}
