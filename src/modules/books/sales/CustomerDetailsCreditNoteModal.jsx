import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { createCreditNote } from './createCreditNote';
import { generateAndUploadCreditNote } from './generateAndUploadCreditNote';

const runInBackground = (task) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 250 });
    return;
  }
  setTimeout(() => task(), 0);
};

const formatSpecification = (spec) => {
  if (!spec) return '';
  if (typeof spec === 'string' || typeof spec === 'number') return String(spec);
  if (typeof spec === 'object') {
    if (spec.wattPeak != null) return `${spec.wattPeak}Wp`;
    if (spec.wattage != null) return `${spec.wattage}W`;
    const entries = Object.entries(spec)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => `${k}: ${v}`);
    return entries.join(', ');
  }
  return '';
};

export default function CustomerDetailsCreditNoteModal({ open, onClose, salesOrder, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedDc, setSelectedDc] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [reason, setReason] = useState('Sales return against Delivery Challan');
  const [returnItems, setReturnItems] = useState([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedProductKey, setSelectedProductKey] = useState('');
  const [selectedBrandName, setSelectedBrandName] = useState('');
  const [selectedSpec, setSelectedSpec] = useState('');

  const normalize = (v) => String(v || '').trim().toLowerCase();

  useEffect(() => {
    if (!open || !salesOrder) return;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const kpi = String(salesOrder.kpi_id || salesOrder.kpiId || '').trim();
        if (!kpi) throw new Error('KPI-ID missing');

        const [dcSnap, cnSnap] = await Promise.all([
          getDocs(collection(db, 'deliveryChallans')),
          getDocs(collection(db, 'creditNotes')),
        ]);

        const dcRows = dcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const noteRows = cnSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const dc = dcRows
          .filter((row) => normalize(row.kpi_id || row.kpiId) === normalize(kpi))
          .sort((a, b) => {
            const ad = a.updatedAt?.toDate ? a.updatedAt.toDate() : a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.updatedAt || a.createdAt || 0);
            const bd = b.updatedAt?.toDate ? b.updatedAt.toDate() : b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.updatedAt || b.createdAt || 0);
            return bd - ad;
          })[0] || null;

        if (!dc) {
          throw new Error('Delivery Challan not found for this KPI-ID');
        }

        const note = noteRows
          .filter((row) => normalize(row.kpi_id || row.kpiId) === normalize(kpi))
          .sort((a, b) => {
            const ad = a.updatedAt?.toDate ? a.updatedAt.toDate() : a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.updatedAt || a.createdAt || 0);
            const bd = b.updatedAt?.toDate ? b.updatedAt.toDate() : b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.updatedAt || b.createdAt || 0);
            return bd - ad;
          })[0] || null;

        setSelectedDc(dc);
        setSelectedNote(note);

        const dcItems = Array.isArray(dc.items) ? dc.items : [];
        const normalizedExisting = (note?.items || [])
          .map((item) => {
            const dcMatch = dcItems.find((dcItem) => String(dcItem.variantId || '') === String(item.variantId || ''));
            if (!dcMatch) return null;
            return {
              ...dcMatch,
              sentQuantity: Number(dcMatch.quantity || 0),
              quantity: Math.max(0, Math.min(Number(item.quantity || 0), Number(dcMatch.quantity || 0))),
            };
          })
          .filter(Boolean);

        const existingVariantSet = new Set(normalizedExisting.map((i) => String(i.variantId || '')));
        const firstAddable = dcItems.find((i) => !existingVariantSet.has(String(i.variantId || '')));

        setReturnItems(normalizedExisting);
        setSelectedVariantId(String(firstAddable?.variantId || ''));
        setReason(String(note?.reason || 'Sales return against Delivery Challan'));
      } catch (err) {
        setSelectedDc(null);
        setSelectedNote(null);
        setReturnItems([]);
        setSelectedVariantId('');
        setSelectedProductKey('');
        setSelectedBrandName('');
        setSelectedSpec('');
        setError(err?.message || 'Failed to load credit note data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [open, salesOrder]);

  const dcItems = Array.isArray(selectedDc?.items) ? selectedDc.items : [];
  const addableItems = dcItems.filter(
    (item) => !returnItems.some((r) => String(r.variantId || '') === String(item.variantId || ''))
  );

  const productOptions = useMemo(() => {
    const map = new Map();
    addableItems.forEach((item) => {
      const productId = String(item.productId || '').trim();
      const productName = String(item.productName || '').trim() || 'Product';
      const key = `${productId}__${productName}`;
      if (!map.has(key)) map.set(key, { key, productName });
    });
    return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [addableItems]);

  useEffect(() => {
    if (!productOptions.length) {
      setSelectedProductKey('');
      return;
    }
    if (!productOptions.some((p) => p.key === selectedProductKey)) {
      setSelectedProductKey(productOptions[0].key);
    }
  }, [productOptions, selectedProductKey]);

  const brandOptions = useMemo(() => {
    if (!selectedProductKey) return [];
    const brands = new Set();
    addableItems.forEach((item) => {
      const key = `${String(item.productId || '').trim()}__${String(item.productName || '').trim() || 'Product'}`;
      if (key === selectedProductKey) brands.add(String(item.brandName || '-').trim() || '-');
    });
    return Array.from(brands).sort((a, b) => a.localeCompare(b));
  }, [addableItems, selectedProductKey]);

  useEffect(() => {
    if (!brandOptions.length) {
      setSelectedBrandName('');
      return;
    }
    if (!brandOptions.includes(selectedBrandName)) {
      setSelectedBrandName(brandOptions[0]);
    }
  }, [brandOptions, selectedBrandName]);

  const specOptions = useMemo(() => {
    if (!selectedProductKey || !selectedBrandName) return [];
    const specs = new Set();
    addableItems.forEach((item) => {
      const key = `${String(item.productId || '').trim()}__${String(item.productName || '').trim() || 'Product'}`;
      if (key !== selectedProductKey) return;
      if (String(item.brandName || '-').trim() !== selectedBrandName) return;
      const spec = String(formatSpecification(item.specification || item.specifications)).trim();
      if (spec && spec !== '-') specs.add(spec);
    });
    return Array.from(specs).sort((a, b) => a.localeCompare(b));
  }, [addableItems, selectedProductKey, selectedBrandName]);

  useEffect(() => {
    if (!specOptions.length) {
      setSelectedSpec('');
      return;
    }
    if (!specOptions.includes(selectedSpec)) {
      setSelectedSpec(specOptions[0]);
    }
  }, [specOptions, selectedSpec]);

  const selectableAddItems = useMemo(() => {
    if (!selectedProductKey || !selectedBrandName) return [];
    return addableItems.filter((item) => {
      const key = `${String(item.productId || '').trim()}__${String(item.productName || '').trim() || 'Product'}`;
      if (key !== selectedProductKey) return false;
      if (String(item.brandName || '-').trim() !== selectedBrandName) return false;
      if (!specOptions.length) return true;
      return String(formatSpecification(item.specification || item.specifications)).trim() === selectedSpec;
    });
  }, [addableItems, selectedProductKey, selectedBrandName, selectedSpec, specOptions.length]);

  useEffect(() => {
    if (!selectableAddItems.length) {
      setSelectedVariantId('');
      return;
    }
    if (!selectableAddItems.some((item) => String(item.variantId || '') === String(selectedVariantId || ''))) {
      setSelectedVariantId(String(selectableAddItems[0].variantId || ''));
    }
  }, [selectableAddItems, selectedVariantId]);

  const handleAddReturnItem = () => {
    if (!selectedVariantId) return;
    const picked = dcItems.find((i) => String(i.variantId || '') === String(selectedVariantId));
    if (!picked) return;

    setReturnItems((prev) => {
      if (prev.some((p) => String(p.variantId || '') === String(picked.variantId || ''))) return prev;
      return [...prev, { ...picked, sentQuantity: Number(picked.quantity || 0), quantity: 1 }];
    });

    const next = addableItems.find((i) => String(i.variantId || '') !== String(selectedVariantId));
    setSelectedVariantId(String(next?.variantId || ''));
  };

  const handleReturnQtyChange = (variantId, qty) => {
    setReturnItems((prev) =>
      prev.map((item) => {
        if (String(item.variantId || '') !== String(variantId || '')) return item;
        const maxQty = Number(item.sentQuantity || 0);
        const safeQty = Math.max(0, Math.min(Number(qty || 0), maxQty));
        return { ...item, quantity: safeQty };
      })
    );
  };

  const handleRemoveReturnItem = (variantId) => {
    setReturnItems((prev) => prev.filter((item) => String(item.variantId || '') !== String(variantId || '')));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedDc) return;
    setSubmitting(true);
    setError('');
    try {
      const validReturnItems = returnItems
        .map((item) => {
          const sentQty = Number(item.sentQuantity || item.quantity || 0);
          const safeQty = Math.max(0, Math.min(Number(item.quantity || 0), sentQty));
          if (!safeQty) return null;
          return { ...item, quantity: safeQty };
        })
        .filter(Boolean);

      if (validReturnItems.length === 0) {
        throw new Error('Please add at least one return item with quantity greater than 0');
      }

      const totalCreditAmount = validReturnItems.reduce((sum, item) => {
        const qty = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || item.rate || item.price || 0);
        return sum + qty * unitPrice;
      }, 0);

      const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
      const createdBy = session?.uid || session?.id || session?.user?.uid || '';

      const created = await createCreditNote({
        kpi_id: selectedDc.kpi_id || selectedDc.kpiId,
        customerName: selectedDc.customerName || selectedDc.customer_name || '',
        contactNumber: selectedDc.contactNumber || selectedDc.contact_number || '',
        address: selectedDc.address || '',
        sales_zone: selectedDc.sales_zone || selectedDc.salesZone || '',
        sales_area: selectedDc.sales_area || selectedDc.salesArea || '',
        items: validReturnItems,
        totalCreditAmount,
        reason,
        createdBy,
      });

      if (onSuccess) {
        onSuccess({
          id: created.id,
          cnNumber: created.creditNoteNumber,
          kpi_id: selectedDc.kpi_id || selectedDc.kpiId,
          kpiId: selectedDc.kpiId || selectedDc.kpi_id,
          status: 'generating',
        });
      }
      onClose();

      const logoUrl = typeof window !== 'undefined' ? `${window.location.origin}/brands/kapil_power_logo.png` : undefined;

      runInBackground(() => {
        generateAndUploadCreditNote(
          {
            id: created.id,
            creditNoteNumber: created.creditNoteNumber,
            kpi_id: selectedDc.kpi_id || selectedDc.kpiId,
            customerName: selectedDc.customerName || selectedDc.customer_name || '',
            contactNumber: selectedDc.contactNumber || selectedDc.contact_number || '',
            address: selectedDc.address || '',
            sales_zone: selectedDc.sales_zone || selectedDc.salesZone || '',
            sales_area: selectedDc.sales_area || selectedDc.salesArea || '',
            createdAt: new Date().toISOString(),
          },
          validReturnItems,
          logoUrl
        ).catch((err) => {
          console.error('Credit Note PDF generation failed', err);
        });
      });
    } catch (err) {
      setError(err?.message || 'Failed to create credit note');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'hidden', background: '#fff', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Create Credit Note</h3>

        {loading ? (
          <div>Loading...</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ overflowY: 'auto', paddingRight: 4, maxHeight: 'min(62vh, 640px)' }}>
              <div style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Customer Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>
                    KPI-ID
                    <input value={selectedDc?.kpi_id || selectedDc?.kpiId || ''} readOnly style={{ width: '100%', padding: 6 }} />
                  </label>
                  <label>
                    Contact
                    <input value={selectedDc?.contactNumber || selectedDc?.contact_number || ''} readOnly style={{ width: '100%', padding: 6 }} />
                  </label>
                  <label style={{ gridColumn: '1 / span 2' }}>
                    Customer Name
                    <input value={selectedDc?.customerName || selectedDc?.customer_name || ''} readOnly style={{ width: '100%', padding: 6 }} />
                  </label>
                  <label style={{ gridColumn: '1 / span 2' }}>
                    Address
                    <input value={selectedDc?.address || ''} readOnly style={{ width: '100%', padding: 6 }} />
                  </label>
                </div>
              </div>

              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Return Item</div>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr auto' }}>
                  <select
                    value={selectedProductKey}
                    onChange={(e) => setSelectedProductKey(e.target.value)}
                    style={{ padding: 8 }}
                  >
                    {productOptions.length === 0 && <option value="">No products</option>}
                    {productOptions.map((p) => (
                      <option key={p.key} value={p.key}>{p.productName}</option>
                    ))}
                  </select>
                  <select
                    value={selectedBrandName}
                    onChange={(e) => setSelectedBrandName(e.target.value)}
                    style={{ padding: 8 }}
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
                    style={{ padding: 8 }}
                  >
                    {!specOptions.length && <option value="">No specification</option>}
                    {specOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button type="button" onClick={handleAddReturnItem} style={{ padding: '8px 12px', borderRadius: 4, border: 'none', background: '#800000', color: '#fff' }}>
                    + Add
                  </button>
                </div>
                {!!selectedVariantId && (
                  <div style={{ marginTop: 8, color: '#555', fontSize: 13 }}>
                    Selected Variant: {selectableAddItems.find((i) => String(i.variantId || '') === String(selectedVariantId || ''))?.variantName || selectedVariantId}
                  </div>
                )}
              </div>

              {returnItems.map((item) => (
                <div key={item.variantId} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f8f8f8', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{item.productName || '-'}</div>
                    <div style={{ color: '#555' }}>
                      {item.brandName || '-'} | {item.variantName || item.variantId || '-'}
                      {formatSpecification(item.specification || item.specifications) ? ` | ${formatSpecification(item.specification || item.specifications)}` : ''}
                    </div>
                  </div>
                  <div style={{ color: '#555' }}>Sent: {Number(item.sentQuantity || 0)}</div>
                  <input
                    type="number"
                    min={0}
                    max={Number(item.sentQuantity || 0)}
                    value={item.quantity ?? ''}
                    onChange={(e) => handleReturnQtyChange(item.variantId, e.target.value)}
                    style={{ width: 90, padding: 6 }}
                  />
                  <span>{item.unit || 'Nos'}</span>
                  <button type="button" onClick={() => handleRemoveReturnItem(item.variantId)} style={{ background: '#ddd', border: 'none', borderRadius: 4, padding: '6px 10px' }}>
                    Remove
                  </button>
                </div>
              ))}

              <label style={{ display: 'block', marginBottom: 12 }}>
                Reason
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc', marginTop: 4 }}
                />
              </label>

              {error && <div style={{ color: '#b00', marginBottom: 10 }}>{error}</div>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #ececec', paddingTop: 10, marginTop: 10 }}>
              <button type="button" onClick={onClose} disabled={submitting} style={{ padding: '8px 14px' }}>Cancel</button>
              <button type="submit" disabled={submitting || loading} style={{ background: '#800000', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 14px' }}>
                {submitting ? 'Saving...' : 'Save Credit Note'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
