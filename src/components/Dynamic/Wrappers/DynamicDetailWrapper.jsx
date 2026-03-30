// src/components/Dynamic/Wrappers/DynamicDetailWrapper.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../../../firebaseConfig";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import DynamicDetailPage from "../DynamicDetailPage";

export default function DynamicDetailWrapper() {
  const { module, id } = useParams(); // module apiName & recordId
  const navigate = useNavigate();

  const [moduleConfig, setModuleConfig] = useState(null);
  const [loading, setLoading] = useState(true);

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

      // 2. Load detail layout
      const ref = doc(db, "crm_fields", found.moduleId);
      const fieldsSnap = await getDoc(ref);

      if (fieldsSnap.exists()) {
        const data = fieldsSnap.data();
        found.detailLayout = data.detailLayout || [];
      }

      setModuleConfig(found);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load detail config:", err);
      setLoading(false);
    }
  };

  const handleEdit = () => {
    navigate(`/crm/modules/${module}/edit/${id}`);
  };

  const handleBack = () => {
    navigate(`/crm/modules/${module}/list`);
  };

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;
  if (!moduleConfig) return <p style={{ padding: 20 }}>Module not found.</p>;

  return (
    <DynamicDetailPage
      module={module}
      moduleConfig={moduleConfig}
      recordId={id}
      onEdit={handleEdit}
      onBack={handleBack}
    />
  );
}
