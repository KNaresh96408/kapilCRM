import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../../../firebaseConfig';
import { getNextCounter, MAROON, peekNextCounter } from './purchaseHelpers';

const UploadPI = ({ open, onClose, vendors = [], onUploaded }) => {
  const [vendorId, setVendorId] = useState('');
  const [piNumber, setPiNumber] = useState('');
  const [piAmount, setPiAmount] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const vendor = useMemo(() => vendors.find((v) => v.id === vendorId) || null, [vendors, vendorId]);

  useEffect(() => {
    let mounted = true;
    const loadNext = async () => {
      if (!open) return;
      try {
        const nextPi = await peekNextCounter({
          counterDocPath: 'poCounters/materialPI',
          prefix: 'PI-',
          digits: 3,
          startFrom: 1,
        });
        if (mounted) setPiNumber(nextPi);
      } catch {
        if (mounted) setPiNumber('PI-001');
      }
    };
    loadNext();
    return () => { mounted = false; };
  }, [open]);

  const handleSubmit = async () => {
    setError('');
    if (!vendorId || !Number(piAmount) || !file) {
      setError('Vendor, PI Number, PI Amount and PI PDF are mandatory.');
      return;
    }

    setSaving(true);
    try {
      const finalPiNumber = await getNextCounter({
        counterDocPath: 'poCounters/materialPI',
        prefix: 'PI-',
        digits: 3,
        startFrom: 1,
      });
      const piRef = doc(collection(db, 'pis'));
      const storageRef = ref(storage, `materialPI/${piRef.id}.pdf`);
      await uploadBytes(storageRef, file, { contentType: file.type || 'application/pdf' });
      const piPdfUrl = await getDownloadURL(storageRef);

      const payload = {
        vendorId,
        vendorName: vendor?.vendorName || '',
        piNumber: finalPiNumber,
        piAmount: Number(piAmount || 0),
        piPdfUrl,
        status: 'uploaded',
        createdBy: auth.currentUser?.uid || '',
        createdAt: serverTimestamp(),
      };
      await setDoc(piRef, payload);

      if (onUploaded) onUploaded({ id: piRef.id, ...payload });
      onClose();
      setVendorId('');
      setPiNumber('PI-001');
      setPiAmount('');
      setFile(null);
    } catch (e) {
      setError(e?.message || 'PI upload failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ marginTop: 0 }}>Upload PI (Mandatory)</h3>

        <div style={grid}>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inputStyle}>
            <option value="">Select Vendor</option>
            {vendors.map((v) => (
              <option value={v.id} key={v.id}>{v.id} | {v.vendorName}</option>
            ))}
          </select>
          <input value={piNumber} readOnly placeholder="PI Number" style={{ ...inputStyle, background: '#f7f7f7' }} />
          <input type="number" min={0} value={piAmount} onChange={(e) => setPiAmount(e.target.value)} placeholder="PI Amount" style={inputStyle} />
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...inputStyle, paddingTop: 7 }} />
        </div>

        {error ? <div style={{ marginTop: 8, color: '#b00020', fontWeight: 600 }}>{error}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button style={secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={primaryBtn} onClick={handleSubmit} disabled={saving}>{saving ? 'Uploading...' : 'Upload PI'}</button>
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
  width: 'min(760px, 94vw)',
  background: '#fff',
  borderRadius: 10,
  padding: 16,
};

const grid = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
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

export default UploadPI;
