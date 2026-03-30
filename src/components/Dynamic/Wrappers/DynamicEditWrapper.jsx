// src/components/Dynamic/Wrappers/DynamicEditWrapper.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../../../firebaseConfig";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import DynamicEditPage from "../DynamicEditPage";

export default function DynamicEditWrapper() {
  const { module, id } = useParams(); // module apiName & recordId
  const navigate = useNavigate();

  const [moduleConfig, setModuleConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recordExists, setRecordExists] = useState(false);

  useEffect(() => {
    loadData();
  }, [module, id]);

  const loadData = async () => {
    try {
      setLoading(true);

      // 1. Load module config (resilient)
      const rows = await import('../../../helpers/firestoreFetch').then((m) => m.fetchCollectionDocs('crm_modules'));
      let found = null;
      for (const r of rows) {
        const api = r.apiName || r.moduleApiName || r.api || r.moduleApi || r.id || r.moduleName;
        if (String(api) === String(module)) {
          found = { ...r, moduleId: r.id };
          break;
        }
      }

      if (!found) {
        console.error("Module not found:", module);
        setModuleConfig(null);
        setLoading(false);
        return;
      }

      // 2. Load create layout (edit uses same)
      const ref = doc(db, "crm_fields", found.moduleId);
      const fieldsSnap = await getDoc(ref);

      if (fieldsSnap.exists()) {
        const data = fieldsSnap.data();
        found.createLayout = data.createLayout || [];
      }

      // 3. Check record existence
      const recordRef = doc(db, `records_${module}`, id);
      const recordSnap = await getDoc(recordRef);

      setRecordExists(recordSnap.exists());
      setModuleConfig(found);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load edit config:", err);
      setLoading(false);
    }
  };

  const handleUpdated = () => {
    navigate(`/crm/modules/${module}/view/${id}`);
  };

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;
  if (!moduleConfig) return <p style={{ padding: 20 }}>Module not found.</p>;
  if (!recordExists) return <p style={{ padding: 20 }}>Record not found.</p>;

  return (
    <DynamicEditPage
      module={module}
      moduleConfig={moduleConfig}
      recordId={id}
      onUpdated={handleUpdated}
    />
  );
}
