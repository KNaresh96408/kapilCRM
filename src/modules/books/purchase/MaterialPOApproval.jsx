import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import {
  createNotificationIfNotExists,
  generateAndUploadPoPdf,
  getApprovalAssets,
  isFinanceOrAdminRole,
  MAROON,
} from './purchaseHelpers';

const runInBackground = (task) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 250 });
    return;
  }
  setTimeout(() => task(), 0);
};

const MaterialPOApproval = ({ rows = [], vendors = [], logoUrl = '', currentUserRole = '', onRowStatusChange }) => {
  const [busyId, setBusyId] = useState('');
  const [reasonById, setReasonById] = useState({});
  const isFinance = isFinanceOrAdminRole(currentUserRole);

  const vendorMap = useMemo(() => {
    const map = new Map();
    vendors.forEach((v) => map.set(v.id, v));
    return map;
  }, [vendors]);

  const actionable = rows.filter((r) => ['pending_approval', 'hold', 'rejected'].includes(String(r.status || '').toLowerCase()));

  const updateStatus = async (row, nextStatus) => {
    if (!isFinance) return;

    const reason = String(reasonById[row.id] || '').trim();
    if ((nextStatus === 'hold' || nextStatus === 'rejected') && !reason) {
      alert('Reason is mandatory for Hold/Reject.');
      return;
    }

    setBusyId(row.id);
    const previous = {
      status: row.status,
      approved: row.approved,
      approvalReason: row.approvalReason,
      poPdfUrl: row.poPdfUrl,
    };
    try {
      const poRef = doc(db, 'purchaseOrders', row.id);
      const baseUpdate = {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      };

      onRowStatusChange?.(row.id, {
        status: nextStatus,
        approved: nextStatus === 'approved',
        approvalReason: nextStatus === 'approved' ? '' : reason,
      });

      if (nextStatus === 'approved') {
        await updateDoc(poRef, {
          ...baseUpdate,
          approved: true,
          approvedBy: auth.currentUser?.uid || '',
          approvedAt: serverTimestamp(),
          approvalReason: '',
        });

        createNotificationIfNotExists({
          dedupeKey: `po_status_update_${row.id}_approved`,
          title: 'PO Approved',
          message: `PO ${row.poNumber} was approved`,
          type: 'po_status_update',
          module: 'books',
          referenceId: row.id,
          referenceType: 'purchaseOrder',
          toUserId: row.createdBy || '',
          toEmails: [row.createdByEmail || row.createdByMail || row.createdByUserEmail || ''],
        }).catch((notifyErr) => {
          console.error('PO approved notification failed', notifyErr);
        });

        runInBackground(async () => {
          try {
            const assets = await getApprovalAssets();
            const approvedPoForPdf = {
              ...row,
              status: 'approved',
              approved: true,
            };
            const poPdfUrl = await generateAndUploadPoPdf({
              po: approvedPoForPdf,
              vendor: vendorMap.get(row.vendorId) || {},
              terms: row.terms || {},
              approved: true,
              signatureUrl: assets.signatureUrl,
              stampUrl: assets.stampUrl,
              approvedByName: assets.approvedByName || auth.currentUser?.displayName || '',
              logoUrl,
              type: 'material',
            });

            await updateDoc(poRef, {
              poPdfUrl,
              updatedAt: serverTimestamp(),
            });
            onRowStatusChange?.(row.id, { poPdfUrl });
          } catch (pdfErr) {
            console.error('Material PO approved PDF generation failed', pdfErr);
          }
        });
      } else {
        await updateDoc(poRef, {
          ...baseUpdate,
          approved: false,
          approvalReason: reason,
        });

        createNotificationIfNotExists({
          dedupeKey: `po_status_update_${row.id}_${nextStatus}`,
          title: nextStatus === 'hold' ? 'PO On Hold' : 'PO Rejected',
          message: `${row.poNumber} ${nextStatus}${reason ? `: ${reason}` : ''}`,
          type: 'po_status_update',
          module: 'books',
          referenceId: row.id,
          referenceType: 'purchaseOrder',
          toUserId: row.createdBy || '',
          toEmails: [row.createdByEmail || row.createdByMail || row.createdByUserEmail || ''],
        }).catch((notifyErr) => {
          console.error('PO status notification failed', notifyErr);
        });
      }
    } catch (e) {
      onRowStatusChange?.(row.id, previous);
      alert(e?.message || 'Approval update failed');
    } finally {
      setBusyId('');
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
            <th style={th}>PI</th>
            <th style={th}>PO PDF</th>
            <th style={th}>Reason</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {actionable.map((row) => (
            <tr key={row.id}>
              <td style={td}>{row.poNumber}</td>
              <td style={td}>{row.vendorName}</td>
              <td style={td}>{Number(row.totalAmount || 0).toLocaleString('en-IN')}</td>
              <td style={td}>{row.piPdfUrl ? <a href={row.piPdfUrl} target="_blank" rel="noreferrer">View PI</a> : '-'}</td>
              <td style={td}>{row.poPdfUrl ? <a href={row.poPdfUrl} target="_blank" rel="noreferrer">View PO</a> : '-'}</td>
              <td style={td}>
                <input
                  style={inputStyle}
                  value={reasonById[row.id] || ''}
                  onChange={(e) => setReasonById((p) => ({ ...p, [row.id]: e.target.value }))}
                  placeholder="Reason for hold/reject"
                  disabled={!isFinance || busyId === row.id}
                />
              </td>
              <td style={td}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={approveBtn} disabled={!isFinance || busyId === row.id} onClick={() => updateStatus(row, 'approved')}>Approve</button>
                  <button style={holdBtn} disabled={!isFinance || busyId === row.id} onClick={() => updateStatus(row, 'hold')}>Hold</button>
                  <button style={rejectBtn} disabled={!isFinance || busyId === row.id} onClick={() => updateStatus(row, 'rejected')}>Reject</button>
                </div>
              </td>
            </tr>
          ))}
          {actionable.length === 0 && (
            <tr><td style={{ ...td, textAlign: 'center' }} colSpan={7}>No pending approvals</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const th = { textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid #ececec', whiteSpace: 'nowrap' };
const td = { padding: '12px 10px', borderBottom: '1px solid #f1f1f1', whiteSpace: 'nowrap' };
const inputStyle = { height: 32, border: '1px solid #d9d9d9', borderRadius: 6, padding: '0 8px', minWidth: 220 };
const approveBtn = { height: 30, border: 'none', borderRadius: 6, padding: '0 10px', background: '#1f7a1f', color: '#fff', cursor: 'pointer' };
const holdBtn = { height: 30, border: 'none', borderRadius: 6, padding: '0 10px', background: '#9c6f00', color: '#fff', cursor: 'pointer' };
const rejectBtn = { height: 30, border: 'none', borderRadius: 6, padding: '0 10px', background: MAROON, color: '#fff', cursor: 'pointer' };

export default MaterialPOApproval;
