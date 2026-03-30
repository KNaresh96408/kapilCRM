import React, { useState, useEffect, useMemo } from "react";
import { createDeliveryChallan } from "./createDeliveryChallan";
import { generateAndUploadDC } from "./generateAndUploadDC";

const runInBackground = (task) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 250 });
    return;
  }
  setTimeout(() => task(), 0);
};
import { db } from "../../../firebaseConfig";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";

const formatSpecification = (spec) => {
  if (!spec) return "";
  if (typeof spec === "string" || typeof spec === "number") return String(spec);
  if (typeof spec === "object") {
    if (spec.wattPeak != null) return `${spec.wattPeak}Wp`;
    if (spec.wattage != null) return `${spec.wattage}W`;
    const entries = Object.entries(spec)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => `${k}: ${v}`);
    return entries.join(", ");
  }
  return "";
};


export default function CustomerDetailsDCModal({ open, onClose, salesOrder, onSuccess }) {
  const [items, setItems] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [inventory, setInventory] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [variants, setVariants] = useState([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedProductKey, setSelectedProductKey] = useState("");
  const [selectedBrandName, setSelectedBrandName] = useState("");
  const [selectedSpec, setSelectedSpec] = useState("");
  const [form, setForm] = useState({
    customerName: "",
    address: "",
    contactNumber: "",
    kpi_id: "",
    sales_zone: "",
    sales_area: "",
  });

  useEffect(() => {
    if (!open || !salesOrder) return;
    // Assume salesOrder.items = [{ productId, productName, variantId, brandName, quantity, unit }]
    setItems(salesOrder.items || []);
    setQuantities(
      (salesOrder.items || []).reduce((acc, item) => {
        acc[item.variantId] = item.quantity;
        return acc;
      }, {})
    );
    // Fetch all inventory variants (for picker + stock map)
    getDocs(collection(db, "inventoryVariants")).then((snap) => {
      const rows = snap.docs.map((d) => {
        const v = d.data() || {};
        return {
          id: d.id,
          productId: v.productId || v.product_id || d.id,
          productName: v.productName || v.product_name || v.name || "Product",
          brandName: v.brandName || v.brand_name || v.brand || "-",
          variantName: v.variantName || v.variant_name || v.model || v.wattage || d.id,
          specification:
            formatSpecification(
              v.specification ||
              v.specifications ||
              v.wattage ||
              v.capacity ||
              v.variantSpec ||
              ""
            ),
          unit: v.unit || v.uom || "Nos",
          availableQuantity: Number(v.availableQuantity || v.available_quantity || 0),
        };
      });
      const inv = {};
      rows.forEach((r) => {
        inv[r.id] = r.availableQuantity;
      });
      // merge existing SO item inventory if any variant is missing in inventoryVariants list
      (salesOrder.items || []).forEach((item) => {
        if (item?.variantId && inv[item.variantId] == null) {
          inv[item.variantId] = Number(item.availableQuantity || 0);
        }
      });
      setVariants(rows);
      setSelectedVariantId(rows[0]?.id || "");
      setInventory(inv);
    }).catch(() => {
      setVariants([]);
      setSelectedVariantId("");
    });

    const customerName =
      salesOrder.customer_name ||
      salesOrder.customerName ||
      salesOrder.customer ||
      salesOrder.clientName ||
      salesOrder.accountName ||
      salesOrder.name ||
      salesOrder.customerDetails?.name ||
      salesOrder.customerDetails?.customerName ||
      salesOrder.customerInfo?.name ||
      "";

    const address =
      salesOrder.address ||
      salesOrder.location ||
      salesOrder.customerAddress ||
      salesOrder.siteAddress ||
      salesOrder.customerDetails?.address ||
      salesOrder.customerInfo?.address ||
      "";

    const contactNumber =
      salesOrder.contact_number ||
      salesOrder.contactNumber ||
      salesOrder.customerPhone ||
      salesOrder.phone ||
      salesOrder.mobile ||
      salesOrder.customerDetails?.contactNumber ||
      salesOrder.customerInfo?.phone ||
      "";

    setForm({
      customerName: String(customerName || ""),
      address: String(address || ""),
      contactNumber: String(contactNumber || ""),
      kpi_id: salesOrder.kpi_id || salesOrder.kpiId || "",
      sales_zone: salesOrder.sales_zone || salesOrder.salesZone || "",
      sales_area: salesOrder.sales_area || salesOrder.salesArea || "",
    });
  }, [open, salesOrder]);

  const handleQtyChange = (variantId, value) => {
    setQuantities({ ...quantities, [variantId]: value });
  };

  const productOptions = useMemo(() => {
    const map = new Map();
    variants.forEach((v) => {
      const productId = String(v.productId || "").trim();
      const productName = String(v.productName || "").trim() || "Product";
      const key = `${productId}__${productName}`;
      if (!map.has(key)) map.set(key, { key, productId, productName });
    });
    return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [variants]);

  useEffect(() => {
    if (!productOptions.length) {
      setSelectedProductKey("");
      return;
    }
    if (!productOptions.some((p) => p.key === selectedProductKey)) {
      setSelectedProductKey(productOptions[0].key);
    }
  }, [productOptions, selectedProductKey]);

  const brandOptions = useMemo(() => {
    if (!selectedProductKey) return [];
    const brands = new Set();
    variants.forEach((v) => {
      const key = `${String(v.productId || "").trim()}__${String(v.productName || "").trim() || "Product"}`;
      if (key === selectedProductKey) brands.add(String(v.brandName || "-").trim() || "-");
    });
    return Array.from(brands).sort((a, b) => a.localeCompare(b));
  }, [variants, selectedProductKey]);

  useEffect(() => {
    if (!brandOptions.length) {
      setSelectedBrandName("");
      return;
    }
    if (!brandOptions.includes(selectedBrandName)) {
      setSelectedBrandName(brandOptions[0]);
    }
  }, [brandOptions, selectedBrandName]);

  const specOptions = useMemo(() => {
    if (!selectedProductKey || !selectedBrandName) return [];
    const specs = new Set();
    variants.forEach((v) => {
      const key = `${String(v.productId || "").trim()}__${String(v.productName || "").trim() || "Product"}`;
      if (key !== selectedProductKey) return;
      if (String(v.brandName || "-").trim() !== selectedBrandName) return;
      const spec = String(v.specification || "").trim();
      if (spec && spec !== "-") specs.add(spec);
    });
    return Array.from(specs).sort((a, b) => a.localeCompare(b));
  }, [variants, selectedProductKey, selectedBrandName]);

  useEffect(() => {
    if (!specOptions.length) {
      setSelectedSpec("");
      return;
    }
    if (!specOptions.includes(selectedSpec)) {
      setSelectedSpec(specOptions[0]);
    }
  }, [specOptions, selectedSpec]);

  const selectableVariants = useMemo(() => {
    if (!selectedProductKey || !selectedBrandName) return [];
    return variants.filter((v) => {
      const key = `${String(v.productId || "").trim()}__${String(v.productName || "").trim() || "Product"}`;
      if (key !== selectedProductKey) return false;
      if (String(v.brandName || "-").trim() !== selectedBrandName) return false;
      if (specOptions.length) return String(v.specification || "").trim() === selectedSpec;
      return true;
    });
  }, [variants, selectedProductKey, selectedBrandName, selectedSpec, specOptions.length]);

  useEffect(() => {
    if (!selectableVariants.length) {
      setSelectedVariantId("");
      return;
    }
    if (!selectableVariants.some((v) => v.id === selectedVariantId)) {
      setSelectedVariantId(selectableVariants[0].id);
    }
  }, [selectableVariants, selectedVariantId]);

  const handleAddItem = () => {
    if (!selectedVariantId) return;
    const picked = variants.find((v) => v.id === selectedVariantId);
    if (!picked) return;

    setItems((prev) => {
      if (prev.some((it) => it.variantId === selectedVariantId)) return prev;
      return [
        ...prev,
        {
          productId: picked.productId,
          productName: picked.productName,
          brandName: picked.brandName,
          variantId: picked.id,
          variantName: picked.variantName,
          specification: picked.specification || "",
          quantity: 1,
          unit: picked.unit,
        },
      ];
    });
    setQuantities((prev) => ({
      ...prev,
      [selectedVariantId]: Number(prev[selectedVariantId] || 1),
    }));
  };

  const handleRemoveItem = (variantId) => {
    const key = String(variantId || "").trim();
    if (!key) return;

    setItems((prev) => prev.filter((it) => String(it.variantId || "") !== key));
    setQuantities((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const dcItems = items.map((item) => ({
        ...item,
        quantity: Number(quantities[item.variantId]) || 0,
      })).filter((item) => Number(item.quantity || 0) > 0);

      if (!form.kpi_id || !form.customerName || !form.address || !form.contactNumber || !form.sales_zone) {
        setError("Please fill all mandatory customer fields.");
        setSubmitting(false);
        return;
      }

      if (dcItems.length === 0) {
        setError("Please add at least one item quantity greater than 0.");
        setSubmitting(false);
        return;
      }

      // Validate quantities
      for (const item of dcItems) {
        if (item.quantity > inventory[item.variantId]) {
          setError(`Insufficient stock for ${item.productName} (${item.brandName})`);
          setSubmitting(false);
          return;
        }
      }
      // Prepare DC data
      const dcData = {
        kpi_id: form.kpi_id,
        kpiId: form.kpi_id,
        salesOrderId: salesOrder.id,
        customerName: form.customerName,
        customer_name: form.customerName,
        contactNumber: form.contactNumber,
        contact_number: form.contactNumber,
        address: form.address,
        sales_zone: form.sales_zone,
        sales_area: form.sales_area,
      };
      const created = await createDeliveryChallan(dcData, dcItems);

      if (onSuccess) {
        onSuccess({
          id: created.id,
          dcNumber: created.dcNumber,
          kpi_id: dcData.kpi_id,
          kpiId: dcData.kpiId,
          status: 'generating',
        });
      }
      onClose();

      const logoUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/brands/kapil_power_logo.png`
          : undefined;

      runInBackground(() => {
        generateAndUploadDC(
          {
            ...dcData,
            id: created.id,
            dcNumber: created.dcNumber,
            createdAt: new Date().toISOString(),
          },
          created.items || dcItems,
          logoUrl
        ).catch((err) => {
          console.error('DC PDF generation failed', err);
        });
      });
    } catch (err) {
      setError(err.message || "Error creating Delivery Challan");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content mobile-modal">
        <h3 style={{ fontSize: 20, marginBottom: 16 }}>Create Delivery Challan</h3>
        <form onSubmit={handleSubmit} className="dc-form">
          <div className="dc-scroll-body">
            <div style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Customer Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  KPI-ID *
                  <input value={form.kpi_id} onChange={(e) => setForm((f) => ({ ...f, kpi_id: e.target.value }))} style={{ width: '100%', padding: 6, border: '1px solid #ccc', borderRadius: 4 }} required />
                </label>
                <label>
                  Contact *
                  <input value={form.contactNumber} onChange={(e) => setForm((f) => ({ ...f, contactNumber: e.target.value }))} style={{ width: '100%', padding: 6, border: '1px solid #ccc', borderRadius: 4 }} required />
                </label>
                <label style={{ gridColumn: '1 / span 2' }}>
                  Customer Name *
                  <input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} style={{ width: '100%', padding: 6, border: '1px solid #ccc', borderRadius: 4 }} required />
                </label>
                <label style={{ gridColumn: '1 / span 2' }}>
                  Address *
                  <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} style={{ width: '100%', padding: 6, border: '1px solid #ccc', borderRadius: 4 }} required />
                </label>
                <label>
                  Sales Zone *
                  <input value={form.sales_zone} onChange={(e) => setForm((f) => ({ ...f, sales_zone: e.target.value }))} style={{ width: '100%', padding: 6, border: '1px solid #ccc', borderRadius: 4 }} required />
                </label>
                <label>
                  Sales Area
                  <input value={form.sales_area} onChange={(e) => setForm((f) => ({ ...f, sales_area: e.target.value }))} style={{ width: '100%', padding: 6, border: '1px solid #ccc', borderRadius: 4 }} />
                </label>
              </div>
            </div>

            <div className="dc-items-list">
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, background: '#fafafa' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Add Item</div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr auto' }}>
                <select
                  value={selectedProductKey}
                  onChange={(e) => setSelectedProductKey(e.target.value)}
                  style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
                >
                  {productOptions.length === 0 && <option value="">No products</option>}
                  {productOptions.map((p) => (
                    <option key={p.key} value={p.key}>{p.productName}</option>
                  ))}
                </select>
                <select
                  value={selectedBrandName}
                  onChange={(e) => setSelectedBrandName(e.target.value)}
                  style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
                >
                  {brandOptions.length === 0 && <option value="">No brands</option>}
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <select
                  value={selectedSpec}
                  onChange={(e) => setSelectedSpec(e.target.value)}
                  disabled={!specOptions.length}
                  style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
                >
                  {!specOptions.length && <option value="">No specification</option>}
                  {specOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button type="button" onClick={handleAddItem} style={{ padding: '8px 12px', borderRadius: 4, border: 'none', background: '#800000', color: '#fff' }}>
                  + Add
                </button>
              </div>
              {!!selectedVariantId && (
                <div style={{ marginTop: 8, color: '#444', fontSize: 13 }}>
                  Selected Variant: {selectableVariants.find((v) => v.id === selectedVariantId)?.variantName || selectedVariantId} (Avail: {Number(inventory[selectedVariantId] || 0)})
                </div>
              )}
            </div>

              {items.map((item) => (
                <div className="dc-item-row" key={item.variantId}>
                  <div className="dc-item-labels">
                    <div className="dc-item-product">{item.productName || '-'}</div>
                    <div className="dc-item-brand">{item.brandName || '-'}</div>
                    <div className="dc-item-brand">{formatSpecification(item.specification || item.specifications || '')}</div>
                  </div>
                  <div className="dc-item-fields">
                    <div className="dc-item-available">Available: {Number(inventory[item.variantId] || 0)}</div>
                    <input
                      type="number"
                      min={0}
                      max={Number(inventory[item.variantId] || 0)}
                      value={quantities[item.variantId] || ""}
                      onChange={(e) => handleQtyChange(item.variantId, e.target.value)}
                      required
                      className="dc-item-input"
                      style={{ width: 70, fontSize: 16, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
                    />
                    <span className="dc-item-unit">{item.unit}</span>
                    <button
                      type="button"
                      className="dc-item-remove"
                      onClick={() => handleRemoveItem(item.variantId)}
                      disabled={submitting}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}
          <div className="dc-footer-actions" style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={submitting} className="dc-btn dc-btn-cancel">Cancel</button>
            <button type="submit" disabled={submitting} className="dc-btn dc-btn-submit">Create DC</button>
          </div>
        </form>
      </div>
      <style>{`
        .modal-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background: #fff; padding: 18px 12px; border-radius: 10px; min-width: 90vw; max-width: 480px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.15);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
        }
        @media (min-width: 600px) {
          .modal-content { min-width: 400px; max-width: 600px; }
        }
        .dc-form {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .dc-scroll-body {
          overflow-y: auto;
          padding-right: 2px;
          max-height: min(62vh, 620px);
        }
        .dc-items-list {
          display: flex; flex-direction: column; gap: 18px;
        }
        .dc-item-row {
          display: flex; flex-direction: column; background: #f8f8f8; border-radius: 6px; padding: 10px 8px;
        }
        .dc-item-labels {
          display: flex; flex-direction: row; gap: 12px; font-weight: 600; font-size: 16px;
        }
        .dc-item-fields {
          display: flex; flex-direction: row; align-items: center; gap: 10px; margin-top: 8px;
        }
        .dc-item-available {
          font-size: 14px; color: #555;
        }
        .dc-item-input {
          width: 70px; font-size: 16px;
        }
        .dc-item-unit {
          font-size: 15px; color: #333;
        }
        .dc-item-remove {
          margin-left: auto;
          background: #ef4444;
          color: #fff;
          border: 1px solid #dc2626;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        .dc-item-remove:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .dc-btn {
          font-size: 16px; padding: 8px 18px; border-radius: 6px; border: none; cursor: pointer;
        }
        .dc-btn-cancel {
          background: #eee; color: #333;
        }
        .dc-btn-submit {
          background: #1976d2; color: #fff;
        }
        .dc-footer-actions {
          border-top: 1px solid #eee;
          padding-top: 10px;
          background: #fff;
        }
      `}</style>
    </div>
  );
}
