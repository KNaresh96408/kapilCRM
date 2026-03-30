import React, { useMemo, useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { serverTimestamp } from 'firebase/firestore';
import { storage } from '../../../firebaseConfig';
import {
  createNotificationIfNotExists,
  isFinanceOrAdminRole,
  MAROON,
  updateVendorTotalsOnServicePayment,
} from './purchaseHelpers';

const ServicePOPayment = ({ rows = [], currentUserRole = '' }) => {
  const [selected, setSelected] = useState(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const isFinance = isFinanceOrAdminRole(currentUserRole);

  const payableRows = useMemo(
    () => rows.filter((r) => {
      const approved = String(r.status || '').toLowerCase() === 'approved';
      const paymentStatus = String(r.paymentStatus || '').toLowerCase();
      return approved && paymentStatus !== 'paid';
    }),
    [rows]
  );

  const openModal = (row) => {
    setSelected(row);
    setPaidAmount(String(row.paymentAmount || 0));
    setUtrNumber(row.utrNumber || '');
    setFile(null);
  };

  const savePayment = async () => {
    if (!selected || !isFinance) return;
    setSaving(true);
    try {
      let receiptUrl = selected.receiptUrl || '';
      if (file) {
        const storageRef = ref(storage, `serviceReceipts/${selected.poNumber}.pdf`);
        await uploadBytes(storageRef, file, { contentType: file.type || 'application/pdf' });
        receiptUrl = await getDownloadURL(storageRef);
      }

      await updateVendorTotalsOnServicePayment({
        poId: selected.id,
        newPaymentAmount: Number(paidAmount || 0),
        receiptUrl,
        utrNumber,
        paymentDate: serverTimestamp(),
      });

      await createNotificationIfNotExists({
        dedupeKey: `service_po_payment_update_${selected.id}_${Number(paidAmount || 0)}`,
        title: 'PO Payment Done',
        message: `Payment done for PO ${selected.poNumber}`,
        type: 'po_payment_update',
        module: 'books',
        referenceId: selected.id,
        referenceType: 'servicePurchaseOrder',
        toUserId: selected.createdBy || '',
        toEmails: [selected.createdByEmail || selected.createdByMail || selected.createdByUserEmail || ''],
      });

      setSelected(null);
    } catch (e) {
      alert(e?.message || 'Payment update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 14, background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8f8f8' }}>
            <th style={th}>PO Number</th>
            <th style={th}>Vendor</th>
            <th style={th}>Amount</th>
            <th style={th}>Paid</th>
            <th style={th}>Status</th>
            <th style={th}>Receipt</th>
            <th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {payableRows.map((row) => (
            <tr key={row.id}>
              <td style={td}>{row.poNumber}</td>
              <td style={td}>{row.vendorName}</td>
              <td style={td}>{Number(row.totalAmount || 0).toLocaleString('en-IN')}</td>
              <td style={td}>{Number(row.paymentAmount || 0).toLocaleString('en-IN')}</td>
              <td style={td}>{row.paymentStatus || 'pending'}</td>
              <td style={td}>{row.receiptUrl ? <a href={row.receiptUrl} target="_blank" rel="noreferrer">View Receipt</a> : '-'}</td>
              <td style={td}><button style={primaryBtn} disabled={!isFinance} onClick={() => openModal(row)}>Enter Payment</button></td>
            </tr>
          ))}
          {payableRows.length === 0 && (
            <tr><td style={{ ...td, textAlign: 'center' }} colSpan={7}>No pending/partial PO available for payment</td></tr>
          )}
        </tbody>
      </table>

      {selected ? (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>Payment Entry - {selected.poNumber}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input type="number" min={0} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="Paid Amount" style={inputStyle} />
              <input value={utrNumber} onChange={(e) => setUtrNumber(e.target.value)} placeholder="UTR Number" style={inputStyle} />
              <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...inputStyle, paddingTop: 7 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={secondaryBtn} onClick={() => setSelected(null)} disabled={saving}>Cancel</button>
              <button style={primaryBtn} onClick={savePayment} disabled={saving}>{saving ? 'Saving...' : 'Save Payment'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const th = { textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid #ececec', whiteSpace: 'nowrap' };
const td = { padding: '12px 10px', borderBottom: '1px solid #f1f1f1', whiteSpace: 'nowrap' };
const inputStyle = { height: 36, border: '1px solid #d9d9d9', borderRadius: 6, padding: '0 10px' };
const primaryBtn = { height: 34, border: 'none', borderRadius: 6, padding: '0 12px', background: MAROON, color: '#fff', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn = { height: 34, border: '1px solid #d0d0d0', borderRadius: 6, padding: '0 12px', background: '#fff', cursor: 'pointer' };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 };
const modal = { width: 'min(640px, 92vw)', background: '#fff', borderRadius: 10, padding: 16 };

export default ServicePOPayment;
