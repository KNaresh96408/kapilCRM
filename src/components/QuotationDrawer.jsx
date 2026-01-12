// ✅ src/components/QuotationDrawer.jsx
import React, { useEffect, useState } from "react";

/**
 * QuotationDrawer
 *
 * Props:
 *  - open: boolean
 *  - onClose: fn()
 *  - deal: object (a deal row OR a deal doc that may contain `quotation` fields)
 *  - onSave: async fn(quotationObj) => Promise
 *
 * Behavior:
 *  - Auto-fills customerName, customerPhone, capacity from deal.
 *  - If deal already contains quotation-like fields, those populate the form.
 *  - Address is intentionally manual and never overwritten by incoming deal props.
 *  - Calls onSave(quotationObj) and closes (parent should persist to Firestore).
 */

const QuotationDrawer = ({ open, onClose, deal, onSave }) => {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    address: "",
    capacity: "",
    templateType: "Residential-OnGrid",
    panelBrand: "Premier Solar",
    panelWatt: "545 Wp",
    panelType: "Topcon",
    inverterBrand: "Polycab",
    inverterSize: "10kW",
    systemCost: "",
    gst: "8.9",
    subsidy: "0",
  });

  const [saving, setSaving] = useState(false);

  // Auto-fill when `deal` changes.
  // Preserve any address the user typed (do not overwrite).
  useEffect(() => {
    if (!deal) return;

    setForm((prev) => ({
      ...prev,
      // basic mapping (prefer explicit quotation fields if present)
      customerName: deal.customerName || deal.name || prev.customerName || "",
      customerPhone: deal.customerPhone || deal.phone || prev.customerPhone || "",
      capacity:
        deal.capacity !== undefined && deal.capacity !== null
          ? deal.capacity
          : prev.capacity || "",
      // preserve address user typed previously
      address: prev.address || (deal.address || ""),

      // quotation-specific fields (if present on deal or existing quotation)
      templateType: deal.templateType || prev.templateType,
      panelBrand: deal.panelBrand || prev.panelBrand,
      panelWatt: deal.panelWatt || prev.panelWatt,
      panelType: deal.panelType || prev.panelType,
      inverterBrand: deal.inverterBrand || prev.inverterBrand,
      inverterSize: deal.inverterSize || prev.inverterSize,
      systemCost:
        deal.systemCost !== undefined && deal.systemCost !== null
          ? deal.systemCost
          : prev.systemCost || "",
      gst: deal.gst !== undefined && deal.gst !== null ? deal.gst : prev.gst,
      subsidy:
        deal.subsidy !== undefined && deal.subsidy !== null
          ? deal.subsidy
          : prev.subsidy || "0",
    }));
  }, [deal]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };

  const handleSave = async () => {
    // determine a stable deal/document id
    const dealId = deal?.id || deal?.dealId || deal?.autoId || deal?.kpiId || "";
    if (!dealId) {
      alert("⚠️ Unable to determine deal id. Please refresh and try again.");
      return;
    }

    const quotationObj = {
      quotationId: `QTN-${String(Date.now()).slice(-6)}`,
      dealId,
      kpiId: deal.autoId || deal.kpiId || dealId,
      projectType: deal.projectType || "Residential",

        teleSale:
  deal.teleSale ||
  deal.tele_sale ||
  deal.telecaller ||
  "",

consultantName:
  deal.consultantName ||
  deal.assignedConsultant ||
  deal.assignedConsultantName ||
  "",


      // form fields (no undefined)
      customerName: form.customerName || "",
      customerPhone: form.customerPhone || "",
      address: form.address || "",
      capacity: form.capacity || "",

      templateType: form.templateType || "Residential-OnGrid",
      panelBrand: form.panelBrand || "",
      panelWatt: form.panelWatt || "",
      panelType: form.panelType || "",
      inverterBrand: form.inverterBrand || "",
      inverterSize: form.inverterSize || "",

      systemCost: form.systemCost || "",
      gst: form.gst || "",
      subsidy: form.subsidy || "",

      createdAt: new Date(),
    };

    try {
      setSaving(true);
      if (typeof onSave === "function") {
        await onSave(quotationObj);
      } else {
        console.warn("onSave not provided — quotation not persisted.");
      }
      onClose();
    } catch (err) {
      console.error("Error saving quotation:", err);
      alert("❌ Error saving quotation: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "420px",
maxWidth: "100%",
        height: "100vh",
        backgroundColor: "#fff",
        borderLeft: "1px solid #ddd",
        padding: 20,
        overflowY: "auto",
        boxShadow: "-2px 0 12px rgba(0,0,0,0.12)",
        zIndex: 2000,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0, color: "#800000" }}>Create / Update Quotation</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#800000", cursor: "pointer", fontSize: 18 }}>
          ✖
        </button>
      </div>

      <label>Template Type</label>
      <select name="templateType" value={form.templateType} onChange={handleChange} style={styles.input}>
        <option value="Residential-OnGrid">Residential-OnGrid</option>
        <option value="Commercial-General">Commercial</option>
      </select>

      <h4 style={styles.sectionTitle}>Customer Details</h4>
      <input name="customerName" value={form.customerName} placeholder="Customer Name" onChange={handleChange} style={styles.input} />
      <input name="customerPhone" value={form.customerPhone} placeholder="Customer Phone" onChange={handleChange} style={styles.input} />
      <input name="address" value={form.address} placeholder="Address (type manually)" onChange={handleChange} style={styles.input} />
      <input name="capacity" value={form.capacity} placeholder="Capacity (kW)" onChange={handleChange} style={styles.input} />

      <h4 style={styles.sectionTitle}>Panel</h4>
      <select name="panelBrand" value={form.panelBrand} onChange={handleChange} style={styles.input}>
        <option>Premier Solar</option>
        <option>Renew Power</option>
        <option>Adani</option>
        <option>Tata</option>
      </select>

      <select name="panelWatt" value={form.panelWatt} onChange={handleChange} style={styles.input}>
        <option>530 Wp</option>
        <option>545 Wp</option>
        <option>550 Wp</option>
        <option>580 Wp</option>
      </select>

      <select name="panelType" value={form.panelType} onChange={handleChange} style={styles.input}>
        <option>Topcon</option>
        <option>Monofacial</option>
        <option>Bifacial</option>
      </select>

      <h4 style={styles.sectionTitle}>Inverter</h4>
      <select name="inverterBrand" value={form.inverterBrand} onChange={handleChange} style={styles.input}>
        <option>Powerone</option>
        <option>Polycab</option>
        <option>Fronius</option>
      </select>

      <select name="inverterSize" value={form.inverterSize} onChange={handleChange} style={styles.input}>
        <option>5kW</option>
        <option>10kW</option>
        <option>20kW</option>
      </select>

      <h4 style={styles.sectionTitle}>Pricing</h4>
      <input type="number" name="systemCost" value={form.systemCost} placeholder="System Cost" onChange={handleChange} style={styles.input} />
      <input type="number" name="gst" value={form.gst} placeholder="GST (%)" onChange={handleChange} style={styles.input} />
      <input type="number" name="subsidy" value={form.subsidy} placeholder="Subsidy" onChange={handleChange} style={styles.input} />

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          onClick={handleSave}
          style={{
            ...styles.saveBtn,
            opacity: saving ? 0.7 : 1,
            pointerEvents: saving ? "none" : "auto",
          }}
        >
          💾 {saving ? "Saving..." : "Save Quotation"}
        </button>
        <button onClick={onClose} style={styles.cancelBtn}>
          ❌ Cancel
        </button>
      </div>
    </div>
  );
};

const styles = {
  input: {
    width: "100%",
    padding: 8,
    marginBottom: 10,
    borderRadius: 6,
    border: "1px solid #ccc",
    fontSize: 14,
  },
  sectionTitle: {
    color: "#800000",
    marginTop: 12,
    marginBottom: 6,
  },
  saveBtn: {
    flex: 1,
    background: "#800000",
    color: "#fff",
    border: "none",
    padding: "10px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 700,
  },
  cancelBtn: {
    flex: 1,
    background: "#fff",
    color: "#800000",
    border: "1px solid #800000",
    padding: "10px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 700,
  },
  drawerMobile: {
  width: "100%",
  maxWidth: "100%",
},
};

export default QuotationDrawer;
