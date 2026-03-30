import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import {
  generateAndUploadPoPdf,
  getNextCounter,
  MAROON,
  MATERIAL_TERMS_DEFAULT,
} from './purchaseHelpers';
import { getDocsWithFallback } from '../../../helpers/firestoreFetch';

const runInBackground = (task) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 250 });
    return;
  }
  setTimeout(() => task(), 0);
};

const resolveVariantSpec = (v) => {
  if (!v) return '-';

  const direct = v.specification || v.spec || v.Specification;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();

  const s = v.specifications || {};
  const wp = s.wattPeak;
  const kw = s.kiloWatt ?? s.kw ?? s.kW ?? s.KW;
  const meters = s.lengthMeters ?? s.meters ?? s.meter;

  if (wp != null && String(wp).trim() !== '') return `${wp}Wp`;
  if (kw != null && String(kw).trim() !== '') return `${kw}kW`;
  if (meters != null && String(meters).trim() !== '') return `${meters}m`;

  const capKw = v.capacityKw ?? v.capacityKW;
  if (capKw != null && String(capKw).trim() !== '') return `${capKw}kW`;

  const fromVariantName = String(v.variantName || v.variant_name || '').match(/(\d+(?:\.\d+)?)\s*(kw|wp|m)/i);
  if (fromVariantName) {
    const val = fromVariantName[1];
    const unit = fromVariantName[2].toLowerCase();
    if (unit === 'kw') return `${val}kW`;
    if (unit === 'wp') return `${val}Wp`;
    if (unit === 'm') return `${val}m`;
  }

  return '-';
};

const CreateMaterialPO = ({ open, onClose, vendors = [], variants = [], pis = [], logoUrl = '', onCreated }) => {
  const [selectedPiId, setSelectedPiId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedProductKey, setSelectedProductKey] = useState('');
  const [selectedBrandName, setSelectedBrandName] = useState('');
  const [selectedSpec, setSelectedSpec] = useState('');
  const [items, setItems] = useState([]);
  const [terms, setTerms] = useState(MATERIAL_TERMS_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [usedPiIds, setUsedPiIds] = useState(new Set());

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'purchaseOrders'), (snap) => {
      const used = new Set();
      snap.forEach((d) => {
        const v = d.data()?.linkedPiId;
        if (v) used.add(String(v));
      });
      setUsedPiIds(used);
    });
    return () => unsub();
  }, []);

  const eligiblePis = useMemo(
    () => pis.filter((p) => !usedPiIds.has(String(p.id))),
    [pis, usedPiIds]
  );

  useEffect(() => {
    if (!selectedPiId) return;
    const stillEligible = eligiblePis.some((p) => p.id === selectedPiId);
    if (!stillEligible) {
      setSelectedPiId('');
    }
  }, [eligiblePis, selectedPiId]);

  const selectedPi = useMemo(() => eligiblePis.find((p) => p.id === selectedPiId) || null, [eligiblePis, selectedPiId]);
  const selectedVendor = useMemo(() => vendors.find((v) => v.id === selectedPi?.vendorId) || null, [vendors, selectedPi]);

  const grandTotal = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.total || 0), 0),
    [items]
  );

  const productOptions = useMemo(() => {
    const map = new Map();
    variants.forEach((v) => {
      const productId = String(v.productId || v.product_id || '').trim();
      const productName = String(v.productName || v.product_name || '').trim() || 'Product';
      const key = `${productId}__${productName}`;
      if (!map.has(key)) map.set(key, { key, productName });
    });
    return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [variants]);

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
    const set = new Set();
    variants.forEach((v) => {
      const key = `${String(v.productId || v.product_id || '').trim()}__${String(v.productName || v.product_name || '').trim() || 'Product'}`;
      if (key === selectedProductKey) set.add(String(v.brandName || v.brand_name || '-').trim() || '-');
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [variants, selectedProductKey]);

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
    const set = new Set();
    variants.forEach((v) => {
      const key = `${String(v.productId || v.product_id || '').trim()}__${String(v.productName || v.product_name || '').trim() || 'Product'}`;
      if (key !== selectedProductKey) return;
      if (String(v.brandName || v.brand_name || '-').trim() !== selectedBrandName) return;
      const spec = String(resolveVariantSpec(v)).trim();
      if (spec && spec !== '-') set.add(spec);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [variants, selectedProductKey, selectedBrandName]);

  useEffect(() => {
    if (!specOptions.length) {
      setSelectedSpec('');
      return;
    }
    if (!specOptions.includes(selectedSpec)) {
      setSelectedSpec(specOptions[0]);
    }
  }, [specOptions, selectedSpec]);

  const selectableVariants = useMemo(() => {
    if (!selectedProductKey || !selectedBrandName) return [];
    return variants.filter((v) => {
      const key = `${String(v.productId || v.product_id || '').trim()}__${String(v.productName || v.product_name || '').trim() || 'Product'}`;
      if (key !== selectedProductKey) return false;
      if (String(v.brandName || v.brand_name || '-').trim() !== selectedBrandName) return false;
      if (!specOptions.length) return true;
      return String(resolveVariantSpec(v)).trim() === selectedSpec;
    });
  }, [variants, selectedProductKey, selectedBrandName, selectedSpec, specOptions.length]);

  useEffect(() => {
    if (!selectableVariants.length) {
      setSelectedVariantId('');
      return;
    }
    if (!selectableVariants.some((v) => v.id === selectedVariantId)) {
      setSelectedVariantId(selectableVariants[0].id);
    }
  }, [selectableVariants, selectedVariantId]);

  const addItem = () => {
    const v = variants.find((x) => x.id === selectedVariantId);
    if (!v) return;
    const specification = resolveVariantSpec(v);
    setItems((prev) => {
      if (prev.some((i) => i.variantId === v.id)) return prev;
      return [
        ...prev,
        {
          productId: v.productId || v.product_id || v.id,
          productName: v.productName || v.product_name || 'Product',
          brandName: v.brandName || v.brand_name || '-',
          variantId: v.id,
          variantName: v.variantName || v.variant_name || v.id,
          unit: v.unit || 'Nos',
          quantity: 1,
          rate: Number(v.defaultPrice || 0),
          total: Number(v.defaultPrice || 0),
          specification,
        },
      ];
    });
  };

  const updateItem = (variantId, key, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.variantId !== variantId) return item;
        const next = { ...item, [key]: Number(value || 0) };
        next.total = Number(next.quantity || 0) * Number(next.rate || 0);
        return next;
      })
    );
  };

  const removeItem = (variantId) => setItems((prev) => prev.filter((i) => i.variantId !== variantId));

  const handleCreate = async () => {
    setError('');
    if (!selectedPi) {
      setError('Upload/select PI first.');
      return;
    }

    if (usedPiIds.has(String(selectedPi.id))) {
      setError('This PI is already used for a PO. One PI can create only one PO.');
      return;
    }
    if (!items.length) {
      setError('At least one product is required.');
      return;
    }

    const cleanItems = items
      .map((i) => ({
        ...i,
        quantity: Math.max(0, Number(i.quantity || 0)),
        rate: Math.max(0, Number(i.rate || 0)),
        total: Math.max(0, Number(i.quantity || 0)) * Math.max(0, Number(i.rate || 0)),
      }))
      .filter((i) => i.quantity > 0);

    if (!cleanItems.length) {
      setError('Valid quantities are required.');
      return;
    }

    setSaving(true);
    try {
      const existingPiPoQ = query(
        collection(db, 'purchaseOrders'),
        where('linkedPiId', '==', selectedPi.id),
        limit(1)
      );
      const existingPiPoRows = await getDocsWithFallback(
        existingPiPoQ,
        'purchaseOrders',
        (row) => String(row?.linkedPiId || '') === String(selectedPi.id || ''),
        3500
      );
      if (existingPiPoRows.length) {
        throw new Error('This PI is already used for a PO. One PI can create only one PO.');
      }

      const poNumber = await getNextCounter({
        counterDocPath: 'poCounters/material',
        prefix: 'PO-M-',
        digits: 4,
        startFrom: 1001,
      });
      const poRef = doc(collection(db, 'purchaseOrders'));
      const basePo = {
        id: poRef.id,
        poNumber,
        vendorId: selectedPi.vendorId,
        vendorName: selectedPi.vendorName,
        linkedPiId: selectedPi.id,
        piNumber: selectedPi.piNumber,
        piPdfUrl: selectedPi.piPdfUrl,
        createdDate: new Date().toISOString().slice(0, 10),
        items: cleanItems,
        totalAmount: cleanItems.reduce((sum, i) => sum + Number(i.total || 0), 0),
        paymentAmount: 0,
        paymentStatus: 'pending',
        status: 'draft',
        approved: false,
        approvedBy: null,
        approvedAt: null,
        terms,
        poPdfUrl: '',
        createdBy: auth.currentUser?.uid || '',
        createdByEmail: auth.currentUser?.email || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        vendorTotalBooked: false,
      };

      await setDoc(poRef, basePo);
      if (onCreated) onCreated(basePo);
      onClose();
      setItems([]);
      setSelectedPiId('');
      setSelectedVariantId('');
      setSelectedProductKey('');
      setSelectedBrandName('');
      setSelectedSpec('');
      setTerms(MATERIAL_TERMS_DEFAULT);

      runInBackground(() => {
        generateAndUploadPoPdf({
          po: basePo,
          vendor: selectedVendor || {},
          terms,
          approved: false,
          signatureUrl: '',
          stampUrl: '',
          approvedByName: '',
          logoUrl,
          type: 'material',
        })
          .then(async (poPdfUrl) => {
            await updateDoc(poRef, {
              poPdfUrl,
              updatedAt: serverTimestamp(),
            });
          })
          .catch((pdfErr) => {
            console.error('Material PO PDF generation failed', pdfErr);
          });
        });
    } catch (e) {
      setError(e?.message || 'Failed to create PO');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ marginTop: 0 }}>Create Material PO</h3>

        <div style={modalBody}>

          <div style={{ border: '1px solid #ececec', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select value={selectedPiId} onChange={(e) => setSelectedPiId(e.target.value)} style={inputStyle}>
                <option value="">Select Uploaded PI</option>
                {eligiblePis.map((pi) => (
                  <option key={pi.id} value={pi.id}>{pi.piNumber} | {pi.vendorName}</option>
                ))}
              </select>
              <input readOnly value={selectedVendor ? `${selectedVendor.id} | ${selectedVendor.vendorName}` : ''} placeholder="Vendor" style={{ ...inputStyle, background: '#f8f8f8' }} />
            </div>
            {!eligiblePis.length ? <div style={{ marginTop: 8, color: '#8b0000', fontWeight: 600 }}>All uploaded PIs are already used for PO creation.</div> : null}
          </div>

          <div style={{ border: '1px solid #ececec', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Add Products</div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr auto' }}>
              <select value={selectedProductKey} onChange={(e) => setSelectedProductKey(e.target.value)} style={inputStyle}>
                {productOptions.length === 0 && <option value="">No products</option>}
                {productOptions.map((p) => (
                  <option key={p.key} value={p.key}>{p.productName}</option>
                ))}
              </select>
              <select value={selectedBrandName} onChange={(e) => setSelectedBrandName(e.target.value)} style={inputStyle}>
                {brandOptions.length === 0 && <option value="">No brands</option>}
                {brandOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select value={selectedSpec} onChange={(e) => setSelectedSpec(e.target.value)} disabled={!specOptions.length} style={inputStyle}>
                {!specOptions.length && <option value="">No specification</option>}
                {specOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button style={primaryBtn} onClick={addItem}>+ Add</button>
            </div>
            {!!selectedVariantId && (
              <div style={{ marginTop: 8, color: '#555', fontSize: 13 }}>
                Selected Variant: {selectableVariants.find((v) => v.id === selectedVariantId)?.variantName || selectedVariantId}
              </div>
            )}
          </div>

          {items.map((item) => (
            <div key={item.variantId} style={{ display: 'grid', gridTemplateColumns: '1.7fr .7fr .8fr .8fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <div>{item.productName} | {item.brandName} | {item.productId || '-'} | {item.specification || '-'}{item.variantName ? ` | ${item.variantName}` : ''}</div>
              <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(item.variantId, 'quantity', e.target.value)} style={inputStyle} />
              <input type="number" min={0} value={item.rate} onChange={(e) => updateItem(item.variantId, 'rate', e.target.value)} style={inputStyle} />
              <div style={{ textAlign: 'right' }}>{Number(item.total || 0).toLocaleString('en-IN')}</div>
              <button style={secondaryBtn} onClick={() => removeItem(item.variantId)}>Remove</button>
            </div>
          ))}

          <div style={{ border: '1px solid #ececec', borderRadius: 8, padding: 10, marginTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Terms & Conditions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {Object.entries(terms).map(([key, val]) => (
                <input key={key} value={val} onChange={(e) => setTerms((p) => ({ ...p, [key]: e.target.value }))} placeholder={key} style={inputStyle} />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10, fontWeight: 700 }}>Grand Total: INR {grandTotal.toLocaleString('en-IN')}</div>
          {error ? <div style={{ marginTop: 8, color: '#b00020', fontWeight: 600 }}>{error}</div> : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, borderTop: '1px solid #ececec', paddingTop: 10 }}>
          <button style={secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={primaryBtn} onClick={handleCreate} disabled={saving}>{saving ? 'Saving...' : 'Create PO'}</button>
        </div>
      </div>
    </div>
  );
};

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.25)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
};

const modal = {
  width: 'min(980px, 96vw)',
  background: '#fff',
  borderRadius: 10,
  padding: 16,
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
};

const modalBody = {
  overflowY: 'auto',
  minHeight: 0,
  paddingRight: 4,
};

const inputStyle = {
  height: 36,
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '0 10px',
};

const primaryBtn = {
  height: 34,
  border: 'none',
  borderRadius: 6,
  padding: '0 12px',
  background: MAROON,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn = {
  height: 34,
  border: '1px solid #d0d0d0',
  borderRadius: 6,
  padding: '0 12px',
  background: '#fff',
  cursor: 'pointer',
};

export default CreateMaterialPO;
