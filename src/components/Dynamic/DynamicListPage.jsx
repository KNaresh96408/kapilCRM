import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";

// DynamicListPage.jsx - STEP 8 (Auto-Generated List Page)
// Renders a dynamic list view for ANY module using its layout + metadata
// Place at: src/components/Dynamic/DynamicListPage.jsx

export default function DynamicListPage({ module, moduleConfig }) {
  // module = moduleApiName e.g. "projects", "leads", "kpi_module"
  // moduleConfig includes fields and moduleId

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const moduleId = moduleConfig.moduleId;
  const fields = moduleConfig.detailLayout || []; // default listing uses detail layout

  useEffect(() => {
    loadRecords();
  }, [module]);

  const loadRecords = async () => {
    try {
      setLoading(true);
      const col = collection(db, `records_${module}`);
      const snap = await getDocs(col);

      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setRecords(arr);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const getFieldValue = (rec, f) => {
    if (!rec || !f) return "";
    return rec[f.fieldApiName] ?? rec[f.label] ?? "";
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">{moduleConfig.pluralName}</h2>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full">
            <thead className="bg-gray-100">
              <tr>
                {fields.slice(0, 5).map((f) => (
                  <th key={f.id} className="px-4 py-2 text-left text-sm font-semibold">
                    {f.label}
                  </th>
                ))}
                <th className="px-4 py-2"></th>
              </tr>
            </thead>

            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} className="border-b hover:bg-gray-50">
                  {fields.slice(0, 5).map((f) => (
                    <td key={f.id} className="px-4 py-2 text-sm">
                      {getFieldValue(rec, f)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right">
                    <button className="text-indigo-600 text-sm mr-3">View</button>
                    <button className="text-indigo-600 text-sm">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
