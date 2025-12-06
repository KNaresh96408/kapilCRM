// src/components/LeadDrawer.jsx
import React, { useState, useEffect, useRef } from "react";
import { db, serverTimestamp } from "../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  deleteDoc,
  setDoc,
  query,
  where,
  getDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

/* ⭐ ADDED: prettyLabel function */
function prettyLabel(name) {
  if (!name) return "";
  return name
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const LeadDrawer = ({ onClose, onLeadAdded, existingLead }) => {
  const auth = getAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(false);
  const moveInProgress = useRef(false);
  const isEdit = !!existingLead;

  // --- dynamic fields support ---
  const [fieldsDef, setFieldsDef] = useState([]); 
  const [layoutDef, setLayoutDef] = useState([]); 

  const STATIC_FIELD_NAMES = [
    "name",
    "phone",
    "email",
    "location",
    "locationLink",
    "source",
    "teleSale",
    "assignedConsultant",
    "status",
    "siteVisitArranged",
  ];

  const [lead, setLead] = useState({
    name: "",
    phone: "",
    email: "",
    location: "",
    locationLink: "",
    source: "",
    teleSale: "",
    assignedConsultant: "",
    status: "new",
    siteVisitArranged: "no",
  });

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) =>
      setCurrentUser(user || null)
    );
    return () => unsub();
  }, []);

  // ⭐ load crm_fields/leads
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const ref = doc(db, "crm_fields", "leads");
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          if (!mounted) return;
          setFieldsDef([]);
          setLayoutDef([]);
          return;
        }

        const data = snap.data() || {};
        const defs = Array.isArray(data.fields) ? data.fields : [];

        const normalized = defs.map((f) =>
          typeof f === "string"
            ? { name: f, label: prettyLabel(f), type: "text", required: false, options: [], default: "" }
            : { ...(f || {}), options: f.options || [], default: f.default ?? "" }
        );

        if (!mounted) return;

        setFieldsDef(normalized);
        setLayoutDef(Array.isArray(data.layout) ? data.layout : []);

        // initialize missing defaults
        setLead((prev) => {
          const next = { ...prev };
          normalized.forEach((fd) => {
            if (next[fd.name] === undefined) {
              if (fd.type === "checkbox") next[fd.name] = !!fd.default;
              else if (fd.type === "multiselect") next[fd.name] = Array.isArray(fd.default) ? fd.default : [];
              else next[fd.name] = fd.default ?? "";
            }
          });
          next.status = next.status ?? "new";
          next.siteVisitArranged = next.siteVisitArranged ?? "no";
          return next;
        });
      } catch (err) {
        console.error("Failed to load crm_fields/leads", err);
      }
    })();

    return () => (mounted = false);
  }, []);

  // ⭐ Populate existing lead data
  useEffect(() => {
    if (isEdit && existingLead) {
      setLead((prev) => ({
        ...prev,
        ...existingLead,
      }));
    }
  }, [existingLead, isEdit]);

  // load consultants
  useEffect(() => {
    const fetchConsultants = async () => {
      try {
        const snap = await getDocs(collection(db, "Users"));
        const users = snap.docs
          .map((d) => ({
            id: d.id,
            name: d.data().Name || d.data().name,
            email: d.data().email,
            role: d.data().designation || d.data().role,
          }))
          .filter((u) => u.role?.toLowerCase().includes("consultant"));

        setConsultants(users);
      } catch (e) {
        console.error("fetchConsultants error", e);
      }
    };
    fetchConsultants();
  }, []);

  const generateNextKPI = async () => {
    const cols = ["leads", "deals", "salesOrders"];
    let max = 0;

    for (const c of cols) {
      const snap = await getDocs(collection(db, c));
      snap.forEach((d) => {
        const x = d.data().autoId || d.data().kpiId;
        if (x?.startsWith("KPI-")) {
          const n = parseInt(x.split("-")[1]);
          if (!isNaN(n) && n > max) max = n;
        }
      });
    }
    return `KPI-${String(max + 1).padStart(3, "0")}`;
  };

  // --- Move Lead to Deals (unchanged) ---
const moveLeadToDeals = async (leadData) => {
  if (moveInProgress.current) return;
  moveInProgress.current = true;

  try {
    const { autoId } = leadData;
    if (!autoId) return;

    // Step 1 → find if a deal already exists with this autoId
    const dealsRef = collection(db, "deals");
    const q = query(dealsRef, where("autoId", "==", autoId));
    const snap = await getDocs(q);

    let dealId = null;

    if (snap.size > 0) {
      // Deal already exists → update it (keep Firestore ID)
      const docSnap = snap.docs[0];
      dealId = docSnap.id;
    } else {
      // Create new deal doc with autogenerated Firestore ID
      const newRef = doc(collection(db, "deals"));
      dealId = newRef.id;
    }

    const payload = {
      ...leadData,
      autoId,
      kpiId: autoId,
      stage: "Qualification",
      updatedAt: serverTimestamp(),
      createdBy: currentUser?.email,
    };

    // Write to correct Firestore document ID
    await setDoc(doc(db, "deals", dealId), payload, { merge: true });

    // Remove lead
    if (leadData.id) {
      await deleteDoc(doc(db, "leads", leadData.id));
    }

    alert(`Lead ${autoId} moved successfully!`);
    onLeadAdded?.();
    onClose?.();

  } catch (err) {
    console.error(err);
    alert("Failed to move lead.");
  } finally {
    moveInProgress.current = false;
  }
};

  // ⭐ Save Lead (dynamic fields included)
  const handleSaveLead = async () => {
    if (!lead.name || !lead.phone || !lead.location) {
      alert("Fill Name, Phone & Location");
      return;
    }

    if (!currentUser) {
      alert("Login expired");
      return;
    }

    setLoading(true);

    try {
      const selected = consultants.find(
        (c) => c.email === lead.assignedConsultant
      );

      const dynamicFieldData = {};
      fieldsDef.forEach((fd) => {
        if (!STATIC_FIELD_NAMES.includes(fd.name)) {
          dynamicFieldData[fd.name] = lead[fd.name] ?? "";
        }
      });

      const leadData = {
        ...lead,
        ...dynamicFieldData,
        consultantName: selected?.name || "",
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.email,
      };

      if (isEdit) {
        await updateDoc(doc(db, "leads", existingLead.id), leadData);

        if (leadData.siteVisitArranged === "yes") {
          await moveLeadToDeals({
            id: existingLead.id,
            ...existingLead,
            ...leadData,
          });
        }

        alert("Lead updated!");
      } else {
        const autoId = await generateNextKPI();

        const newLead = {
          ...leadData,
          autoId,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email,
          ownerUid: currentUser.uid,
          status: "new",
        };

        const ref = await addDoc(collection(db, "leads"), newLead);

        if (leadData.siteVisitArranged === "yes") {
          await moveLeadToDeals({ id: ref.id, ...newLead });
        }

        alert(`Lead added with ID ${autoId}`);
      }

      onLeadAdded?.();
      setTimeout(onClose, 200);
    } catch (err) {
      alert("Failed to save lead.");
    } finally {
      setLoading(false);
    }
  };

  // input renderer (unchanged)
  const renderDynamicInput = (fd) => {
    const val = lead[fd.name] ?? "";
    const commonStyle = {
      padding: 10,
      borderRadius: 6,
      border: "1px solid #800000",
      color: "#800000",
      width: "100%",
    };

    const t = (fd.type || "text").toLowerCase();

    switch (t) {
      case "textarea":
        return (
          <textarea
            id={fd.name}
            value={val}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            rows={3}
            style={{ ...commonStyle, minHeight: 80 }}
          />
        );

      case "date":
        return (
          <input
            id={fd.name}
            type="date"
            value={val ? String(val).split("T")[0] : ""}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            style={commonStyle}
          />
        );

      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={!!val}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.checked })}
          />
        );

      case "select":
      case "picklist":
        return (
          <select
            id={fd.name}
            value={val ?? ""}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            style={commonStyle}
          >
            <option value="">Select</option>
            {fd.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );

      case "multiselect":
        return (
          <input
            placeholder="comma separated"
            value={Array.isArray(val) ? val.join(",") : val}
            onChange={(e) =>
              setLead({
                ...lead,
                [fd.name]: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            style={commonStyle}
          />
        );

      default:
        return (
          <input
            id={fd.name}
            type="text"
            value={val}
            onChange={(e) => setLead({ ...lead, [fd.name]: e.target.value })}
            style={commonStyle}
          />
        );
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.drawer}>
        <div style={styles.header}>
          <h2 style={styles.title}>{isEdit ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onClose} style={styles.closeBtn}>
            ✖
          </button>
        </div>

        <div style={styles.formContainer}>
          <div style={styles.form}>
            {fieldsDef.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontWeight: 700,
                    color: "#800000",
                    marginBottom: 8,
                  }}
                >
                  Dynamic Fields
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  {fieldsDef
                    .filter((fd) => !STATIC_FIELD_NAMES.includes(fd.name))
                    .map((fd) => (
                      <div key={fd.name} style={styles.inputGroup}>
                        <label style={styles.label}>
                          {fd.label}
                          {fd.required ? " *" : ""}
                        </label>
                        {renderDynamicInput(fd)}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* STATIC FIELDS (unchanged) */}
            {[
              { label: "Customer Name*", name: "name" },
              { label: "Contact Number*", name: "phone" },
              { label: "Email", name: "email" },
              { label: "Location*", name: "location" },
              { label: "Google Maps Link", name: "locationLink" },
              { label: "Lead Source", name: "source" },
              { label: "Tele-Sales Executive", name: "teleSale" },
            ].map((f) => (
              <div key={f.name} style={styles.inputGroup}>
                <label style={styles.label}>{f.label}</label>
                <input
                  name={f.name}
                  value={lead[f.name] || ""}
                  onChange={(e) =>
                    setLead({ ...lead, [e.target.name]: e.target.value })
                  }
                  style={styles.input}
                />
              </div>
            ))}

            <div style={styles.inputGroup}>
              <label style={styles.label}>Site Visit Arranged</label>
              <select
                name="siteVisitArranged"
                value={lead.siteVisitArranged}
                onChange={(e) =>
                  setLead({ ...lead, siteVisitArranged: e.target.value })
                }
                style={styles.select}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Assigned Consultant</label>
              <select
                name="assignedConsultant"
                value={lead.assignedConsultant}
                onChange={(e) =>
                  setLead({ ...lead, assignedConsultant: e.target.value })
                }
                style={styles.select}
              >
                <option value="">Select Consultant</option>
                {consultants.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name} ({c.email})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={styles.buttonGroup}>
          <button
            onClick={handleSaveLead}
            style={styles.addBtn}
            disabled={loading}
          >
            {loading ? "Saving..." : isEdit ? "Save Changes" : "Add Lead"}
          </button>

          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadDrawer;

/* --- Styles unchanged --- */
const styles = {
  overlay: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    background: "rgba(128,0,0,0.4)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 999,
  },
  drawer: {
    background: "#fff",
    width: 420,
    height: "100%",
    boxShadow: "-4px 0 12px rgba(128,0,0,0.3)",
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    padding: 20,
    borderBottom: "1px solid rgba(128,0,0,0.2)",
  },
  title: {
    fontSize: 20,
    color: "#800000",
    fontWeight: 700,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: "#800000",
    cursor: "pointer",
  },
  formContainer: {
    flex: 1,
    overflowY: "auto",
    padding: "0 20px 80px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
  },
  label: {
    color: "#800000",
    fontWeight: 600,
    marginBottom: 6,
  },
  input: {
    padding: 10,
    borderRadius: 6,
    border: "1px solid #800000",
    color: "#800000",
  },
  select: {
    padding: 10,
    borderRadius: 6,
    border: "1px solid #800000",
    color: "#800000",
  },
  buttonGroup: {
    padding: 12,
    display: "flex",
    gap: 10,
    borderTop: "1px solid rgba(128,0,0,0.2)",
    background: "#fff",
    position: "sticky",
    bottom: 0,
  },
  addBtn: {
    flex: 1,
    background: "#800000",
    color: "#fff",
    border: "none",
    padding: 10,
    borderRadius: 6,
    fontWeight: 700,
    cursor: "pointer",
  },
  cancelBtn: {
    flex: 1,
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    padding: 10,
    borderRadius: 6,
    fontWeight: 700,
    cursor: "pointer",
  },
};
