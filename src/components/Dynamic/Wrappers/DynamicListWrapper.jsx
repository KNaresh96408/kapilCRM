// src/components/Dynamic/Wrappers/DynamicListWrapper.jsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../../../firebaseConfig";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import DynamicListPage from "../DynamicListPage";

export default function DynamicListWrapper() {
  const { module } = useParams(); // module API name (e.g., "projects")
  const [moduleConfig, setModuleConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModuleConfig();
  }, [module]);

  const loadModuleConfig = async () => {
    try {
      setLoading(true);

      // 1) Fetch all CRM modules (resilient)
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
        setLoading(false);
        return;
      }

      // 2) Fetch layout for module
      const ref = doc(db, "crm_fields", found.moduleId);
      const layoutSnap = await getDoc(ref);

      if (layoutSnap.exists()) {
        const layout = layoutSnap.data();
        found.detailLayout = layout.detailLayout || [];
        found.createLayout = layout.createLayout || [];
      }

      setModuleConfig(found);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load module config:", err);
      setLoading(false);
    }
  };

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;
  if (!moduleConfig) return <p style={{ padding: 20 }}>Module not found.</p>;

  return <DynamicListPage module={module} moduleConfig={moduleConfig} />;
}
