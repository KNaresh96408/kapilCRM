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
import { usePermission } from "../hooks/usePermission";


/* ⭐ ADDED: prettyLabel function */
function prettyLabel(name) {
  if (!name) return "";
  return name
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const LeadDrawer = ({ onClose, onLeadAdded, existingLead, refreshLeads }) => {
  const auth = getAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(false);
  const moveInProgress = useRef(false);
  const isEdit = !!existingLead;
  const perm = usePermission("leads");
  const adminEmails = ["loan@kapilpower.com"];
const isAdmin = currentUser?.email && adminEmails.includes(currentUser.email);


  // --- dynamic fields support ---
  const [fieldsDef, setFieldsDef] = useState([]); 
  const [layoutDef, setLayoutDef] = useState([]); 

  const STATIC_FIELD_NAMES = [
    "name",
    "phone",
    "email",
    "location",
    "locationLink",
    "teleSale",
    "assignedConsultant",
    "status",
    "siteVisitArranged",
    "siteVisitArrangedDate",
  ];

  const [lead, setLead] = useState({
    name: "",
    phone: "",
    email: "",
    location: "",
    locationLink: "",
    teleSale: "",
    assignedConsultant: "",
    status: "new",
    siteVisitArranged: "no",
    siteVisitArrangedDate: "",
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
          .filter((u) => {
  const role = u.role?.toLowerCase();
  return (
    role === "consultant" ||
    role === "area_sales_manager" ||
    role === "zonal_manager"
  );
});

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
// ✅ FINAL & SAFE: Lead → Deal (NO DUPLICATES)
const moveLeadToDeals = async (leadData) => {
  if (moveInProgress.current) return;
  moveInProgress.current = true;

  try {
    const { autoId } = leadData;
    if (!autoId) return;

    // 🔒 Use KPI-ID as Deal document ID (guarantees uniqueness)
const dealRef = doc(db, "deals", autoId);

// 🚫 HARD BLOCK: if ANY deal already exists with same KPI anywhere
const q = query(
  collection(db, "deals"),
  where("kpiId", "==", autoId)
);
const snap = await getDocs(q);

if (!snap.empty) {
  console.warn("❌ Duplicate KPI detected. Deal creation blocked:", autoId);
  return;
}


    // -------- Get Consultant Name --------
    let consultantName = "";
    if (leadData?.assignedConsultant) {
      const usersSnap = await getDocs(collection(db, "Users"));
      usersSnap.forEach((u) => {
        const d = u.data();
        if (d?.email === leadData.assignedConsultant) {
          consultantName = d?.Name || d?.name || "";
        }
      });
    }

    // 🔥 REMOVE `source`, FORCE `lead_source`
const {
  source,        // ❌ remove from deal
  lead_source,   // ✅ preferred field
  ...cleanLeadData
} = leadData;

const payload = {
  ...cleanLeadData,

  // ✅ always keep ONLY lead_source in deal
  lead_source: lead_source || source || "",

  consultantName,
  autoId,
  kpiId: autoId,
  stage: "Qualification",
  siteVisitArrangedDate: leadData.siteVisitArrangedDate || null,
  createdAt: serverTimestamp(),
  createdBy: currentUser?.email || "",
};


    // ✅ Create Deal (ONLY ONCE)
    await setDoc(dealRef, payload);

    // ✅ Delete Lead after deal creation
    if (leadData.id) {
      await deleteDoc(doc(db, "leads", leadData.id));
    }

    if (refreshLeads) refreshLeads();

    alert(`Lead ${autoId} moved successfully!`);
    onLeadAdded?.();
    onClose?.();

  } catch (err) {
    console.error("Move Lead failed:", err);
    alert("Failed to move lead.");
  } finally {
    moveInProgress.current = false;
  }
};

const handleDeleteRecord = async () => {
  if (!isEdit) return;
  if (!window.confirm("Are you sure? This cannot be undone.")) return;

  try {
    await deleteDoc(doc(db, "leads", existingLead.id));

    alert("Lead deleted successfully");

    if (refreshLeads) refreshLeads();   // 🔥 refresh UI instantly
    onClose();                         // close drawer

  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};

  // ⭐ Save Lead (dynamic fields included)
  const handleSaveLead = async () => {
    // 🚫 Block update if user has no permission
if (isEdit && !perm.update) {
  alert("You do not have permission to update leads.");
  return;
}

// 🚫 Block creation if user has no permission
if (!isEdit && !perm.create) {
  alert("You do not have permission to create leads.");
  return;
}
    if (!lead.name || !lead.phone || !lead.location) {
      alert("Fill Name, Phone & Location");
      return;
    }
    // 🔒 Mandatory business fields
const REQUIRED_DYNAMIC_FIELDS = [
  "source", 
  "sales_zone",
  "sales_area",
  "state",
  "zonal_manager",
];

for (const field of REQUIRED_DYNAMIC_FIELDS) {
  if (!lead[field]) {
    alert(`${prettyLabel(field)} is required`);
    return;
  }
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
        updatedBy:
  currentUser.displayName ||
  currentUser.email ||
  "",
      };

if (isEdit) {

  // 🔒 REQUIRED VALIDATION
  if (
    leadData.siteVisitArranged === "yes" &&
    !leadData.siteVisitArrangedDate
  ) {
    alert("Please select Site Visit Arranged Date");
    return;
  }

  await updateDoc(doc(db, "leads", existingLead.id), leadData);

if (leadData.siteVisitArranged === "yes") {
  await moveLeadToDeals({
    id: existingLead.id,
    ...existingLead,
    ...leadData,
    siteVisitArrangedDate: leadData.siteVisitArrangedDate,
  });
  return; // ⛔ STOP here (lead is moved)
}

alert("Lead updated!");
      } else {
        const autoId = await generateNextKPI();

        const newLead = {
          ...leadData,
          autoId,
          createdAt: serverTimestamp(),
          createdBy: {
  uid: currentUser.uid,
  email: currentUser.email,
  name: currentUser.displayName || "",
},
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
  if (perm.loading) {
  return (
    <p style={{ padding: 20, color: "#800000" }}>
      Checking permissions...
    </p>
  );
}

if (!perm.read) {
  return (
    <div style={{ padding: 30, textAlign: "center", color: "#800000" }}>
      <h2>🚫 Access Denied</h2>
      <p>You do not have permission to view Leads.</p>
    </div>
  );
}

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

            {lead.siteVisitArranged === "yes" && (
  <div style={styles.inputGroup}>
    <label style={styles.label}>
      Site Visit Arranged Date *
    </label>
    <input
      type="date"
      value={lead.siteVisitArrangedDate || ""}
      onChange={(e) =>
        setLead({
          ...lead,
          siteVisitArrangedDate: e.target.value,
        })
      }
      style={styles.input}
    />
  </div>
)}


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
           {isAdmin && isEdit && (
    <button
      onClick={handleDeleteRecord}
      style={{
        background: "red",
        color: "white",
        padding: "10px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer"
      }}
    >
      Delete Lead
    </button>
  )}
          <button
  onClick={handleSaveLead}
  style={styles.addBtn}
  disabled={
    loading ||
    (isEdit && !perm.update) ||
    (!isEdit && !perm.create)
  }
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
