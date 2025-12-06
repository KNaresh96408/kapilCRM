import React, { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";
import EditModule from "./EditModule";
import FieldPropertyEditor from "./FieldPropertyEditor_Full";

const ModulesAndFieldsBuilder = () => {
  const [modules, setModules] = useState([]);
  const [editingModule, setEditingModule] = useState(null);
  const [editingLayout, setEditingLayout] = useState(null);

  useEffect(() => {
    const loadModules = async () => {
      const snapshot = await getDocs(collection(db, "crm_modules"));
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setModules(data);
    };

    loadModules();
  }, []);

  const toggleStatus = async (m) => {
    await updateDoc(doc(db, "crm_modules", m.id), {
      active: !m.active,
    });

    setModules(prev =>
      prev.map(x => (x.id === m.id ? { ...x, active: !x.active } : x))
    );
  };

  return (
    <>
      {/* ------------------ MODULES TABLE ------------------ */}
      {!editingModule && !editingLayout && (
        <div style={{ marginTop: "20px" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#fff",
              borderRadius: "8px",
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6", height: "45px" }}>
                <th>Displayed As</th>
                <th>Module Name</th>
                <th>Status</th>
                <th style={{ width: "80px" }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {modules.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "12px" }}>{m.label}</td>
                  <td>{m.name}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.active}
                      onChange={() => toggleStatus(m)}
                    />
                  </td>

                  <td>
                    <select
                      onChange={(e) => {
                        if (e.target.value === "layout") {
                          setEditingLayout(m);
                        } else if (e.target.value === "permission") {
                          setEditingModule(m);
                        }
                        e.target.value = "";
                      }}
                    >
                      <option value="">⚙ Options</option>
                      <option value="layout">Edit Layout</option>
                      <option value="permission">Module Permission</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------- MODULE PERMISSION PAGE ------------- */}
      {editingModule && (
        <EditModule
          moduleData={editingModule}
          onBack={() => setEditingModule(null)}
        />
      )}

      {/* ------------- EDIT LAYOUT PAGE ------------- */}
      {editingLayout && (
        <FieldPropertyEditor
          moduleData={editingLayout}
          onBack={() => setEditingLayout(null)}
        />
      )}
    </>
  );
};

export default ModulesAndFieldsBuilder;
