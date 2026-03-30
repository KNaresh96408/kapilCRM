import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import CreateServicePO from './CreateServicePO';
import ServicePOApproval from './ServicePOApproval';
import ServicePOPayment from './ServicePOPayment';
import {
  extractRoleFromSession,
  isFinanceOrAdminRole,
  MAROON,
  normalizeRole,
  createNotificationIfNotExists,
} from './purchaseHelpers';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const formatMoney = (value) => Number(value || 0).toLocaleString('en-IN');

const ServicePO = () => {
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('purchase');
  const [searchPo, setSearchPo] = useState('');
  const [periodDate, setPeriodDate] = useState('');
  const [openCreate, setOpenCreate] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const tab = String(params.get('tab') || '').toLowerCase();
    if (tab === 'approval') setActiveTab('approval');
  }, [location.search]);

  useEffect(() => {
    setPage(1);
  }, [searchPo, periodDate, activeTab]);

  useEffect(() => {
    const hydrateUser = async () => {
      let role = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = extractRoleFromSession(session);
      } catch {}
      if (!role && auth.currentUser?.getIdTokenResult) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          role = normalizeRole(token?.claims?.role || token?.claims?.Role || '');
        } catch {}
      }
      if (!role && auth.currentUser?.uid) {
        try {
          const snap = await getDoc(doc(db, 'Users', auth.currentUser.uid));
          if (snap.exists()) {
            role = normalizeRole(snap.data()?.role || snap.data()?.Role || '');
          }
        } catch (err) {
          console.error('❌ Failed to hydrate role from Users collection', err?.message || err);
        }
      }
      setCurrentUserRole(role);
    };
    hydrateUser();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [poList, vendorList] = await Promise.all([
          fetchCollectionDocs('servicePurchaseOrders', 3500, 0),
          fetchCollectionDocs('records_serviceVendors', 3500, 0),
        ]);
        if (!mounted) return;
        poList.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        setRows(poList);
        setVendors(vendorList);
      } catch (err) {
        console.error('❌ Failed loading service PO data', err?.message || err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();
    const timer = setInterval(loadData, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const sendForApproval = async (row) => {
    setBusyId(row.id);
    const previousStatus = row.status;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'pending_approval' } : r)));
    try {
      await updateDoc(doc(db, 'servicePurchaseOrders', row.id), {
        status: 'pending_approval',
        updatedAt: serverTimestamp(),
      });

      createNotificationIfNotExists({
        dedupeKey: `service_po_approval_${row.id}_pending_approval`,
        title: 'PO Approval Required',
        message: `${row.poNumber} requires approval`,
        type: 'po_approval',
        module: 'books',
        referenceId: row.id,
        referenceType: 'servicePurchaseOrder',
        toRole: 'dgm',
      }).catch((notifyErr) => {
        console.error('Service PO approval notification failed', notifyErr);
      });
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: previousStatus } : r)));
      alert(e?.message || 'Failed to send approval');
    } finally {
      setBusyId('');
    }
  };

  const financeVisible = isFinanceOrAdminRole(currentUserRole);
  const isAdmin = normalizeRole(currentUserRole) === 'admin';

  const filteredRows = useMemo(() => {
    const term = String(searchPo || '').trim().toLowerCase();
    return rows.filter((row) => {
      const poMatch = !term || String(row.poNumber || '').toLowerCase().includes(term);
      const createdDate = row.createdDate || (row.createdAt?.seconds ? new Date(row.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
      const dateMatch = !periodDate || createdDate === periodDate;
      return poMatch && dateMatch;
    });
  }, [rows, searchPo, periodDate]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = filteredRows.slice(startIdx, startIdx + perPage);

  const handleDelete = async (row) => {
    if (!isAdmin || !row?.id) return;
    const previous = rows;
    setDeletingId(row.id);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      await deleteDoc(doc(db, 'servicePurchaseOrders', row.id));
    } catch (e) {
      setRows(previous);
      alert(e?.message || 'Delete failed');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) return <div>Loading service PO...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button
          style={activeTab === 'purchase' ? primaryBtn : tabBtn}
          onClick={() => setActiveTab('purchase')}
        >
          Purchase Orders
        </button>
        {financeVisible && (
          <button
            style={activeTab === 'approval' ? primaryBtn : tabBtn}
            onClick={() => setActiveTab('approval')}
          >
            Financial approval Queue
          </button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={searchPo}
            onChange={(e) => setSearchPo(e.target.value)}
            placeholder="Search by PO number"
            style={{ ...inputStyle, minWidth: 170, background: '#cfeaf7' }}
          />
          <input
            type="date"
            value={periodDate}
            onChange={(e) => setPeriodDate(e.target.value)}
            style={{ ...inputStyle, minWidth: 170, background: '#d9eef8' }}
            title="Select period(date)"
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryBtn} onClick={() => setOpenCreate(true)}>Create PO</button>
        </div>
      </div>

      {activeTab === 'purchase' ? (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f8f8' }}>
                <th style={th}>Created Date</th>
                <th style={th}>PO Number</th>
                <th style={th}>Vendor</th>
                <th style={th}>Assigned Projects Count</th>
                <th style={th}>PO Value</th>
                <th style={th}>Paid Amount</th>
                <th style={th}>Pending</th>
                <th style={th}>View PO</th>
                <th style={th}>Approval</th>
                <th style={th}>Status</th>
                <th style={th}>Receipt</th>
                {isAdmin && <th style={th}>Delete</th>}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const pending = Math.max(0, Number(row.totalAmount || 0) - Number(row.paymentAmount || 0));
                const status = String(row.status || 'draft').toLowerCase();
                const paymentStatus = String(row.paymentStatus || (pending <= 0 ? 'paid' : Number(row.paymentAmount || 0) > 0 ? 'partial' : 'pending')).toLowerCase();
                const createdDate = row.createdDate || (row.createdAt?.seconds ? new Date(row.createdAt.seconds * 1000).toISOString().slice(0, 10) : '-');
                return (
                  <tr key={row.id}>
                    <td style={td}>{createdDate}</td>
                    <td style={td}>{row.poNumber}</td>
                    <td style={td}>{row.vendorName || '-'}</td>
                    <td style={td}>{Number(row.assignedProjectsCount || 0)}</td>
                    <td style={td}>{formatMoney(row.totalAmount)}</td>
                    <td style={td}>{formatMoney(row.paymentAmount)}</td>
                    <td style={td}>{formatMoney(pending)}</td>
                    <td style={td}>{row.poPdfUrl ? <a href={row.poPdfUrl} target="_blank" rel="noreferrer">PDF</a> : '-'}</td>
                    <td style={td}>
                      {status === 'draft' ? (
                        <button style={primaryBtn} disabled={busyId === row.id} onClick={() => sendForApproval(row)}>
                          {busyId === row.id ? 'Sending...' : 'Send for Approval'}
                        </button>
                      ) : (
                        <span style={{ color: status === 'approved' ? '#1f7a1f' : '#9c6f00', fontWeight: 700 }}>{status.replaceAll('_', ' ')}</span>
                      )}
                    </td>
                    <td style={td}>
                      <span style={{ fontWeight: 700, color: paymentStatus === 'paid' ? '#1f7a1f' : paymentStatus === 'partial' ? '#9c6f00' : '#444' }}>
                        {paymentStatus}
                      </span>
                    </td>
                    <td style={td}>
                      {row.receiptUrl ? (
                        <a href={row.receiptUrl} target="_blank" rel="noreferrer">View Receipt</a>
                      ) : (
                        '-'
                      )}
                    </td>
                    {isAdmin && (
                      <td style={td}>
                        <button style={dangerBtn} disabled={deletingId === row.id} onClick={() => handleDelete(row)}>
                          {deletingId === row.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!filteredRows.length && <tr><td style={{ ...td, textAlign: 'center' }} colSpan={isAdmin ? 12 : 11}>No service PO records yet</td></tr>}
            </tbody>
          </table>
        </div>
      ) : financeVisible ? (
        <>
          <ServicePOApproval
            rows={filteredRows}
            vendors={vendors}
            currentUserRole={currentUserRole}
            onRowStatusChange={(rowId, updates) => {
              setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...updates } : r)));
            }}
          />
          <ServicePOPayment rows={filteredRows} currentUserRole={currentUserRole} />
        </>
      ) : (
        <div style={{ padding: 16, background: '#fff', border: '1px solid #ececec', borderRadius: 8 }}>Approval queue is visible only for Admin, Sales Head, Director, AGM and DGM.</div>
      )}

      {activeTab === 'purchase' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: MAROON, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>
              {filteredRows.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, filteredRows.length)} of {filteredRows.length}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Records per page</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                style={{ padding: '6px 8px', borderRadius: 4, border: `1px solid ${MAROON}`, color: MAROON }}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ background: '#fff', border: `1px solid ${MAROON}`, color: MAROON, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ background: '#fff', border: `1px solid ${MAROON}`, color: MAROON, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <CreateServicePO
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        vendors={vendors}
        onCreated={(newPo) => {
          setRows((prev) => {
            const next = [{ ...newPo }, ...prev.filter((r) => r.id !== newPo.id)];
            next.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
            return next;
          });
        }}
      />
    </div>
  );
};

const th = { textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid #ececec', whiteSpace: 'nowrap' };
const td = { padding: '12px 10px', borderBottom: '1px solid #f1f1f1', whiteSpace: 'nowrap' };

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

const dangerBtn = {
  height: 30,
  border: 'none',
  borderRadius: 6,
  padding: '0 10px',
  background: '#b00',
  color: '#fff',
  cursor: 'pointer',
};

const tabBtn = {
  height: 34,
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '0 12px',
  background: '#f7f7f7',
  cursor: 'pointer',
};

const inputStyle = {
  height: 36,
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '0 10px',
};

export default ServicePO;
