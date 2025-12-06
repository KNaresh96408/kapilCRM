import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

// DynamicDetailPage.jsx - STEP 8 (Detail View)
// Auto-generates a detail page for any module using its detailLayout
// Place at: src/components/Dynamic/DynamicDetailPage.jsx

export default function DynamicDetailPage({ module, moduleConfig, recordId, onBack, onEdit }) {
  const [layout, setLayout] = useState([]);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [module, recordId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load detail layout
      const layoutRef = doc(db, "crm_fields", moduleConfig.moduleId);
      const layoutSnap = await getDoc(layoutRef);

      if (layoutSnap.exists()) {
        const data = layoutSnap.data();
        setLayout(data.detailLayout || []);
      }

      // Load record
      const recordRef = doc(db, `records_${module}`, recordId);
      const recordSnap = await getDoc(recordRef);

      if (recordSnap.exists()) setRecord(recordSnap.data());

      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const getValue = (f) => {
    if (!record) return "";

    // Auto-number
    if (f.type === "Auto-Number") {
      return record[f.fieldApiName] || "";
    }

    // Lookup (basic version)
    if (f.type === "Lookup") {
      return record[f.fieldApiName]?.display || record[f.fieldApiName] || "";
    }

    return record[f.fieldApiName] ?? record[f.label] ?? "";
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold">{moduleConfig.name} Details</h2>

        <div className="flex gap-3">
          <button onClick={onEdit} className="px-4 py-2 bg-indigo-600 text-white rounded">Edit</button>
          <button onClick={onBack} className="px-4 py-2 border rounded">Back</button>
        </div>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : !record ? (
        <p className="text-red-600">Record not found.</p>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {layout.map((f) => (
            <div key={f.id} className="bg-white border rounded p-4 shadow-sm">
              <p className="text-sm text-gray-500">{f.label}</p>
              <p className="font-medium text-lg">{getValue(f)}</p>
            </div>
          ))}
        </div>
      )}

      {record?._meta && (
        <div className="mt-8 text-sm text-gray-500">
          <p>Created At: {record._meta.createdAt}</p>
          <p>Created By: {record._meta.createdBy}</p>
        </div>
      )}
    </div>
  );
}