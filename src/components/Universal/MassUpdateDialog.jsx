import React from "react";

export default function MassUpdateDialog({
  open,
  rowCount,
  fields = [],
  selectedField = "",
  onFieldChange,
  inputOptions = [],
  selectedInput = "",
  onInputChange,
  value = "",
  onValueChange,
  onApply,
  onClose,
  loading = false,
}) {
  if (!open) return null;

  const normalizedField = String(selectedField || "")
    .trim()
    .toLowerCase();
  const isDateField =
    normalizedField.includes("date") ||
    normalizedField === "sitevisitarrangeddate" ||
    normalizedField === "sitevisitcompleteddate";

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.headerRow}>
          <h3 style={styles.title}>Mass Update <span style={styles.subtle}>({rowCount} rows)</span></h3>
          <button type="button" style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.grid}>
          <div>
            <label style={styles.label}>Field</label>
            <select
              value={selectedField}
              onChange={(e) => onFieldChange?.(e.target.value)}
              style={styles.input}
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={styles.label}>Select Input</label>
            <select
              value={selectedInput}
              onChange={(e) => onInputChange?.(e.target.value)}
              style={styles.input}
              disabled={!inputOptions.length}
            >
              <option value="">{inputOptions.length ? "Select" : "No predefined options"}</option>
              {inputOptions.map((opt) => (
                <option key={`${opt.value}-${opt.label}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={styles.label}>Value</label>
          <input
            type={isDateField ? "date" : "text"}
            value={value}
            onChange={(e) => onValueChange?.(e.target.value)}
            placeholder={isDateField ? "Select date" : "Enter value"}
            style={styles.input}
          />
        </div>

        <div style={styles.actions}>
          <button type="button" style={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={styles.applyBtn} onClick={onApply} disabled={loading}>
            {loading ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.5)",
    zIndex: 120000,
    display: "grid",
    placeItems: "center",
    padding: 16,
    backdropFilter: "blur(6px)",
  },
  modal: {
    width: "min(520px, 94vw)",
    background: "linear-gradient(180deg, #ffffff 0%, #fff6f8 100%)",
    border: "1px solid #f0c9d4",
    borderRadius: 20,
    boxShadow: "0 18px 40px rgba(63, 11, 28, 0.22)",
    padding: "20px 22px",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    margin: 0,
    color: "#800000",
    fontSize: 18,
    fontWeight: 800,
  },
  subtle: {
    color: "#666",
    fontWeight: 600,
  },
  closeBtn: {
    border: "none",
    background: "transparent",
    color: "#800000",
    cursor: "pointer",
    fontSize: 20,
    lineHeight: 1,
    padding: "2px 6px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  label: {
    display: "block",
    fontWeight: 600,
    color: "#1f2937",
    marginBottom: 4,
    fontSize: 13,
  },
  input: {
    width: "100%",
    border: "1px solid #e3b1c0",
    borderRadius: 12,
    padding: "11px 14px",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
    background: "#fff",
  },
  actions: {
    marginTop: 14,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelBtn: {
    border: "1px solid #800000",
    background: "#fff",
    color: "#800000",
    borderRadius: 10,
    padding: "9px 16px",
    fontWeight: 600,
    cursor: "pointer",
  },
  applyBtn: {
    border: "none",
    background: "#7d0d2d",
    color: "#fff",
    borderRadius: 10,
    padding: "9px 16px",
    fontWeight: 700,
    cursor: "pointer",
  },
};
