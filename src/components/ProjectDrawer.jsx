import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import {
  doc,
  updateDoc,
  getDoc,
  setDoc,
  serverTimestamp,
  getDocs,
  collection,
  deleteDoc,
} from "firebase/firestore";
import { usePermission } from "../hooks/usePermission";


/**
 * ProjectDrawer.jsx
 *
 * External drawer (admin-editable). Added dynamic fields support:
 * - Loads crm_fields/projects fields array
 * - Renders dynamic inputs below existing inputs
 * - Persists dynamic field values into project doc on save
 *
 * Important: This file was augmented only to add dynamic behaviour.
 */

function prettyLabel(name) {
  if (!name) return "";
  return name.toString().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default function ProjectDrawer(props) {
  const perm = usePermission("projects");

  // Loading UI
  if (perm.loading) {
    return (
      <div style={{ padding: 40, color: "#800000", textAlign: "center" }}>
        Checking permissions…
      </div>
    );
  }

  // No READ access — cannot even open project
  if (!perm.read) {
    return (
      <div style={{ padding: 40, color: "#800000", textAlign: "center" }}>
        <h2>🚫 Access Denied</h2>
        <p>You do not have permission to view Projects.</p>
        <button onClick={props.onClose}>Close</button>
      </div>
    );
  }

  return <ProjectDrawerInner {...props} perm={perm} />;
}

function ProjectDrawerInner({ project, onClose, refresh, perm }) {

  const canEdit = perm.update;    // whoever has UPDATE can edit+save
  const isAdmin = perm.delete;    // delete used as super admin if needed

  const [form, setForm] = useState({ ...project });
  const [saving, setSaving] = useState(false);

  // -------------------------
  // Dynamic fields
  // -------------------------
  const [fieldsDef, setFieldsDef] = useState([]);
  const [layoutDef, setLayoutDef] = useState([]);


  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ref = doc(db, "crm_fields", "projects");
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

        // initialize missing defaults in form
        setForm((prev) => {
          const next = { ...prev };
          normalized.forEach((fd) => {
            if (next[fd.name] === undefined) {
              if (fd.type === "checkbox") next[fd.name] = !!fd.default;
              else if (fd.type === "multiselect") next[fd.name] = Array.isArray(fd.default) ? fd.default : [];
              else next[fd.name] = fd.default ?? "";
            }
          });
          return next;
        });
      } catch (err) {
        console.error("Failed to load crm_fields/projects", err);
      }
    })();
    return () => (mounted = false);
  }, []);

  // Reload drawer data if project changes
  useEffect(() => {
    setForm((prev) => {
      const merged = { ...(prev || {}), ...(project || {}) };
      fieldsDef.forEach((fd) => {
        if (merged[fd.name] === undefined) {
          if (fd.type === "checkbox") merged[fd.name] = !!fd.default;
          else if (fd.type === "multiselect") merged[fd.name] = Array.isArray(fd.default) ? fd.default : [];
          else merged[fd.name] = fd.default ?? "";
        }
      });
      return merged;
    });
  }, [project, fieldsDef.length]);

  const currentUser =
  typeof window !== "undefined"
    ? JSON.parse(localStorage.getItem("kp-user") || "{}")
    : {};

  // -------------------------
  // Handle Input Change
  // -------------------------
  const handleChange = (field, value) => {
    if (!canEdit) return;// block edits
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // -------------------------
  // AUTO-CALCULATION LOGIC
  // -------------------------
  const toISO = (val) => {
    if (!val) return "";
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  };

  const dateOrNull = (d) => (d ? new Date(d) : null);

  const sixtyDate = dateOrNull(project?.sixtyPercentDate);
  const dispatchDate = dateOrNull(form.dispatchDate);
  const installationDate = dateOrNull(form.installationDate);
  const netMeterDate = dateOrNull(form.netMeterDate);
  const today = new Date();

  const computeDelay = (d1, d2) => {
    if (!d1 || !d2) return "";
    const diff = Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
    return diff + " days";
  };

  const dispatchDelay = computeDelay(dispatchDate, sixtyDate);
  const installationDelay = computeDelay(installationDate, dispatchDate);
  const netMeterDelay = computeDelay(netMeterDate, today);

  const handleDeleteProject = async () => {
  if (!isAdmin) return alert("Only admin can delete projects.");
  if (!window.confirm("Are you sure? This cannot be undone.")) return;

  try {
    await deleteDoc(doc(db, "projects", project.id));
    alert("Project deleted successfully");

    if (refresh) refresh();
    onClose();
  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};

  // -------------------------
  // Save Project
  // -------------------------
  const saveProject = async () => {
    if (!perm.update) {
  alert("You do not have permission to update this project.");
  return;
}

    setSaving(true);

    try {
      const ref = doc(db, "projects", project.id);
      const updateData = {
        name: form.name ?? null,
        phone: form.phone ?? null,
        address: form.address ?? null,
        capacity: form.capacity !== undefined ? Number(form.capacity || 0) : null,
        status: form.status ?? null,
        startDate: form.startDate ?? null,
        endDate: form.endDate ?? null,
        notes: form.notes ?? null,

        // NEW FIELDS
        dispatchDate: form.dispatchDate || null,
        installationDate: form.installationDate || null,
        netMeterDate: form.netMeterDate || null,
        nationalPortalStage: form.nationalPortalStage || null,

        dispatchStatus: form.dispatchDate ? "Done" : "Pending",
        installationStatus: form.installationDate ? "Done" : "Pending",
        netMeterStatus: form.netMeterDate ? "Done" : "Pending",

        dispatchDelay,
        installationDelay,
        netMeterDelay,

        updatedAt: serverTimestamp(),
        updatedBy:
    currentUser.displayName ||
    currentUser.email ||
    "",
      };

      // add dynamic fields
      fieldsDef.forEach((fd) => {
        const val = form[fd.name];
        if (fd.type === "checkbox") {
          updateData[fd.name] = !!val;
        } else if (fd.type === "multiselect") {
          updateData[fd.name] = Array.isArray(val)
            ? val
            : val
            ? String(val)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
        } else if (fd.type === "date") {
          if (!val) updateData[fd.name] = null;
          else if (val?.toDate) updateData[fd.name] = val;
          else {
            const dt = new Date(val);
            updateData[fd.name] = isNaN(dt.getTime()) ? val : dt;
          }
        } else {
          if (val === undefined) updateData[fd.name] = null;
          else updateData[fd.name] = val === "" ? null : val;
        }
      });

      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          ...updateData,
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, updateData);
      }

      alert("Project saved successfully");
      if (refresh) refresh();
      onClose();
    } catch (err) {
      console.error("Error saving project:", err);
      alert("Could not save project: " + (err.message || err));
    }
    setSaving(false);
  };

  // -------------------------
  // Render dynamic fields
  // -------------------------
  const renderDynamicInput = (fd) => {
    const val = form[fd.name] ?? "";
    const commonStyle = {
      width: "100%",
      padding: 8,
      borderRadius: 6,
      border: "1px solid #ccc",
      marginBottom: 12,
      background: isAdmin ? "#fff" : "#f3f3f3",
    };

    const type = (fd.type || "text").toLowerCase();

    switch (type) {
      case "textarea":
        return (
          <textarea
            value={val}
            onChange={(e) => handleChange(fd.name, e.target.value)}
            rows={3}
            style={{ ...commonStyle, minHeight: 80 }}
            disabled={!canEdit}
          />
        );

      case "date":
        const dateVal =
          val?.toDate ? toISO(val.toDate()) : val ? toISO(new Date(val)) : "";
        return (
          <input
            type="date"
            value={dateVal}
            onChange={(e) =>
              handleChange(fd.name, e.target.value ? new Date(e.target.value) : null)
            }
            style={commonStyle}
            disabled={!canEdit}
          />
        );

      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={!!val}
            onChange={(e) => handleChange(fd.name, e.target.checked)}
            disabled={!canEdit}
          />
        );

      case "select":
      case "picklist":
        return (
          <select
            value={val ?? ""}
            onChange={(e) => handleChange(fd.name, e.target.value)}
            style={commonStyle}
            disabled={!canEdit}
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
              handleChange(
                fd.name,
                e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean)
              )
            }
            style={commonStyle}
            disabled={!canEdit}
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={val ?? ""}
            onChange={(e) =>
              handleChange(fd.name, e.target.value ? Number(e.target.value) : "")
            }
            style={commonStyle}
            disabled={!canEdit}
          />
        );

      default:
        return (
          <input
            type="text"
            value={val ?? ""}
            onChange={(e) => handleChange(fd.name, e.target.value)}
            style={commonStyle}
            disabled={!canEdit}
          />
        );
    }
  };

  // -------------------------
  // Styles
  // -------------------------
  const inputStyle = {
    width: "100%",
    padding: "8px",
    borderRadius: "6px",
    border: "1px solid #ccc",
    marginBottom: "12px",
    background: isAdmin ? "#fff" : "#f3f3f3",
  };

  const label = {
    display: "block",
    marginBottom: "6px",
    fontWeight: 600,
  };

  // -------------------------
  // Render UI
  // -------------------------
  return (
 <div
  style={{
    position: "fixed",
    right: 0,
    top: 0,
    width: window.innerWidth <= 768 ? "100%" : "460px",
    height: "100vh",
    background: "#fff",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.2)",
      padding: 7,
    overflowY: "auto",
    overscrollBehavior: "contain",
    overflowX: "auto",               // ⭐ ADD THIS
    WebkitOverflowScrolling: "touch",// ⭐ ADD THIS
    zIndex: 999999,
  }}
>
      <h2 style={{ color: "#800000", marginTop: 0 }}>Project Details</h2>

      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 15,
          right: 15,
          padding: "6px 10px",
          border: "1px solid #800000",
          background: "transparent",
          color: "#800000",
          borderRadius: 4,
        }}
      >
        Close
      </button>

      {/* KPI ID */}
      <p style={{ fontWeight: "bold" }}>KPI ID: {form.kpiId}</p>

      {/* Project Name */}
      <label style={label}>Project Name</label>
      <input
        style={inputStyle}
        value={form.name || ""}
        onChange={(e) => handleChange("name", e.target.value)}
        disabled={!canEdit}
      />

      {/* Customer Name */}
      <label style={label}>Customer Name</label>
      <input
        style={inputStyle}
        value={form.customerName || ""}
        onChange={(e) => handleChange("customerName", e.target.value)}
        disabled={!canEdit}
      />

      {/* Phone */}
      <label style={label}>Phone</label>
      <input
        style={inputStyle}
        value={form.phone || ""}
        onChange={(e) => handleChange("phone", e.target.value)}
        disabled={!canEdit}
      />

      {/* Address */}
      <label style={label}>Address</label>
      <textarea
        rows={3}
        style={{ ...inputStyle, resize: "vertical" }}
        value={form.address || ""}
        onChange={(e) => handleChange("address", e.target.value)}
        disabled={!canEdit}
      />

      {/* Capacity */}
      <label style={label}>Capacity (kW)</label>
      <input
        style={inputStyle}
        type="number"
        value={form.capacity || 0}
        onChange={(e) => handleChange("capacity", e.target.value)}
        disabled={!canEdit}
      />

      {/* 60% Received Date */}
      <label style={label}>60% Received Date (Auto)</label>
      <input style={inputStyle} value={toISO(project.sixtyPercentDate)} disabled />

      {/* Dispatch */}
      <label style={label}>Dispatch Date</label>
      <input
        type="date"
        style={inputStyle}
        value={toISO(form.dispatchDate)}
        onChange={(e) => handleChange("dispatchDate", e.target.value)}
        disabled={!canEdit}
      />

      <label style={label}>Dispatch Status</label>
      <input style={inputStyle} value={form.dispatchDate ? "Done" : "Pending"} disabled />

      <label style={label}>Dispatch Delay</label>
      <input style={inputStyle} value={dispatchDelay} disabled />

      {/* Installation */}
      <label style={label}>Installation Date</label>
      <input
        type="date"
        style={inputStyle}
        value={toISO(form.installationDate)}
        onChange={(e) => handleChange("installationDate", e.target.value)}
        disabled={!canEdit}
      />

      <label style={label}>Installation Status</label>
      <input style={inputStyle} value={form.installationDate ? "Done" : "Pending"} disabled />

      <label style={label}>Installation Delay</label>
      <input style={inputStyle} value={installationDelay} disabled />

      {/* Net Meter */}
      <label style={label}>Net Meter Date</label>
      <input
        type="date"
        style={inputStyle}
        value={toISO(form.netMeterDate)}
        onChange={(e) => handleChange("netMeterDate", e.target.value)}
        disabled={!canEdit}
      />

      <label style={label}>Net Meter Status</label>
      <input style={inputStyle} value={form.netMeterDate ? "Done" : "Pending"} disabled />

      <label style={label}>Net Meter Delay</label>
      <input style={inputStyle} value={netMeterDelay} disabled />

      {/* National Portal */}
      <label style={label}>National Portal Stage</label>
      <select
        style={inputStyle}
        value={form.nationalPortalStage || ""}
        onChange={(e) => handleChange("nationalPortalStage", e.target.value)}
        disabled={!canEdit}
      >
        <option value="">Select</option>
        <option>Registration Pending</option>
        <option>Solar Installation Details Pending</option>
        <option>Subsidy Pending</option>
        <option>Subsidy Disbursed</option>
      </select>

      {/* Status */}
      <label style={label}>Status</label>
      <select
        style={inputStyle}
        value={form.status || "Not Started"}
        onChange={(e) => handleChange("status", e.target.value)}
        disabled={!canEdit}
      >
        <option>Not Started</option>
        <option>In Progress</option>
        <option>Completed</option>
        <option>On Hold</option>
      </select>

      {/* Start Date */}
      <label style={label}>Start Date</label>
      <input
        style={inputStyle}
        type="date"
        value={form.startDate ? form.startDate.split("T")[0] : ""}
        onChange={(e) => handleChange("startDate", e.target.value)}
        disabled={!canEdit}
      />

      {/* End Date */}
      <label style={label}>End Date</label>
      <input
        style={inputStyle}
        type="date"
        value={form.endDate ? form.endDate.split("T")[0] : ""}
        onChange={(e) => handleChange("endDate", e.target.value)}
        disabled={!canEdit}
      />

      {/* Notes */}
      <label style={label}>Notes</label>
      <textarea
        rows={4}
        style={{ ...inputStyle, resize: "vertical" }}
        value={form.notes || ""}
        onChange={(e) => handleChange("notes", e.target.value)}
        disabled={!canEdit}
      />

      {/* DYNAMIC FIELDS */}
      {fieldsDef.length > 0 && (
        <>
          <hr />
          <h3 style={{ color: "#800000", marginTop: 8 }}>Custom Fields</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginTop: 8,
            }}
          >
            {fieldsDef.map((fd) => (
              <div
                key={fd.name}
                style={{ display: "flex", flexDirection: "column" }}
              >
                <label style={{ marginBottom: 6, fontWeight: 600 }}>
                  {fd.label}
                  {fd.required ? " *" : ""}
                </label>
                {renderDynamicInput(fd)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Save */}
     {/* Spacer so content doesn't hide behind fixed buttons */}
<div style={{ height: "140px" }}></div>

{/* FIXED BOTTOM BUTTON BAR */}
<div
  style={{
    borderTop: "1px solid #eee",
    padding: 12,
    display: "flex",
    gap: 10,
    marginTop: 20,
  }}
>
         {canEdit && (
    <button
      onClick={saveProject}
      disabled={saving}
      style={{
        flex: 1,
        background: "#800000",
        color: "#fff",
        padding: "12px 0",
        borderRadius: "8px",
        border: "none",
        fontWeight: "bold",
      }}
    >
      {saving ? "Saving..." : "Save"}
    </button>
  )}
  {isAdmin && (
  <button
    onClick={handleDeleteProject}
    style={{
      flex: 1,
      background: "red",
      color: "white",
      padding: "12px 0",
      borderRadius: "8px",
      border: "none",
      fontWeight: "bold",
      marginRight: 10
    }}
  >
    Delete Project
  </button>
)}

  <button
    onClick={onClose}
    style={{
      flex: 1,
      background: "#fff",
      color: "#800000",
      border: "2px solid #800000",
      padding: "12px 0",
      borderRadius: "8px",
      fontWeight: 700,
    }}
  >
    Cancel
  </button>
</div>
    </div>
  );
};
