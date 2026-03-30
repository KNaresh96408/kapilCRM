// src/components/Dynamic/Wrappers/DynamicCreateWrapper.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../../../firebaseConfig";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import DynamicCreatePage from "../DynamicCreatePage";

export default function DynamicCreateWrapper() {
  const { module } = useParams(); // module API name
  const navigate = useNavigate();

  const [moduleConfig, setModuleConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModuleConfig();
  }, [module]);

  const loadModuleConfig = async () => {
    try {
      setLoading(true);

      // 1. Fetch modules to locate matching apiName (resilient)
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

      // 2. Fetch layout fields
      const ref = doc(db, "crm_fields", found.moduleId);
      const fieldsSnap = await getDoc(ref);

      if (fieldsSnap.exists()) {
        const data = fieldsSnap.data();
        found.createLayout = data.createLayout || [];
      }

      setModuleConfig(found);
      setLoading(false);
    } catch (err) {
      console.error("Error loading module config:", err);
      setLoading(false);
    }
  };

  const handleCreated = () => {
    navigate(`/crm/modules/${module}/list`);
  };

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;
  if (!moduleConfig) return <p style={{ padding: 20 }}>Module not found.</p>;

  return (
    <DynamicCreatePage
      module={module}
      moduleConfig={moduleConfig}
      onCreated={handleCreated}
    />
  );
}
