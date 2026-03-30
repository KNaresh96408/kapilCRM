import React, { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import {
  generateAndUploadPoPdf,
  getNextCounter,
  MAROON,
  SERVICE_TERMS_DEFAULT,
} from './purchaseHelpers';

const runInBackground = (task) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 250 });
    return;
  }
  setTimeout(() => task(), 0);
};

const CreateServicePO = ({ open, onClose, vendors = [], logoUrl = '', onCreated }) => {
  const [vendorId, setVendorId] = useState('');
  const [assignedProjectsCount, setAssignedProjectsCount] = useState('1');
  const [ratePerProject, setRatePerProject] = useState('0');
  const [terms, setTerms] = useState(SERVICE_TERMS_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const vendor = useMemo(() => vendors.find((v) => v.id === vendorId) || null, [vendors, vendorId]);
  const totalAmount = Number(assignedProjectsCount || 0) * Number(ratePerProject || 0);

  const handleCreate = async () => {
    setError('');
    if (!vendor) {
      setError('Vendor is mandatory.');
      return;
    }

    setSaving(true);
    try {
      const poNumber = await getNextCounter({ counterDocPath: 'poCounters/service', prefix: 'SV/PO-' });
      const poRef = doc(collection(db, 'servicePurchaseOrders'));
      const po = {
        id: poRef.id,
        poNumber,
        vendorId: vendor.id,
        vendorName: vendor.vendorName,
        assignedProjectsCount: Number(assignedProjectsCount || 0),
        ratePerProject: Number(ratePerProject || 0),
        totalAmount,
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
      };

      await setDoc(poRef, po);
      if (onCreated) onCreated(po);
      onClose();
      setVendorId('');
      setAssignedProjectsCount('1');
      setRatePerProject('0');
      setTerms(SERVICE_TERMS_DEFAULT);

      runInBackground(() => {
        generateAndUploadPoPdf({
          po,
          vendor,
          terms,
          approved: false,
          signatureUrl: '',
          stampUrl: '',
          approvedByName: '',
          logoUrl,
          type: 'service',
        })
          .then(async (poPdfUrl) => {
            await updateDoc(poRef, {
              poPdfUrl,
              updatedAt: serverTimestamp(),
            });
          })
          .catch((pdfErr) => {
            console.error('Service PO PDF generation failed', pdfErr);
          });
        });
    } catch (e) {
      setError(e?.message || 'Failed to create Service PO');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ marginTop: 0 }}>Create Service PO</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inputStyle}>
            <option value="">Select Service Vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.id} | {v.vendorName}</option>)}
          </select>
          <input type="number" min={1} value={assignedProjectsCount} onChange={(e) => setAssignedProjectsCount(e.target.value)} style={inputStyle} placeholder="Assigned Projects Count" />
          <input type="number" min={0} value={ratePerProject} onChange={(e) => setRatePerProject(e.target.value)} style={inputStyle} placeholder="Rate per Project" />
          <input readOnly value={`Total: INR ${totalAmount.toLocaleString('en-IN')}`} style={{ ...inputStyle, background: '#f7f7f7' }} />
        </div>

        <div style={{ border: '1px solid #ececec', borderRadius: 8, padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Service Terms</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(terms).map(([k, v]) => (
              <input key={k} value={v} onChange={(e) => setTerms((p) => ({ ...p, [k]: e.target.value }))} placeholder={k} style={inputStyle} />
            ))}
          </div>
        </div>

        {error ? <div style={{ marginTop: 8, color: '#b00020', fontWeight: 600 }}>{error}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button style={secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={primaryBtn} onClick={handleCreate} disabled={saving}>{saving ? 'Saving...' : 'Create Service PO'}</button>
        </div>
      </div>
    </div>
  );
};

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 };
const modal = { width: 'min(880px, 94vw)', background: '#fff', borderRadius: 10, padding: 16 };
const inputStyle = { height: 36, border: '1px solid #d9d9d9', borderRadius: 6, padding: '0 10px' };
const primaryBtn = { height: 34, border: 'none', borderRadius: 6, padding: '0 12px', background: MAROON, color: '#fff', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn = { height: 34, border: '1px solid #d0d0d0', borderRadius: 6, padding: '0 12px', background: '#fff', cursor: 'pointer' };

export default CreateServicePO;
