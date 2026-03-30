import React, { useEffect, useMemo, useState } from 'react';
import { auth, db, storage } from '../../../firebaseConfig';
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';

const initialVendors = [
  {
    id: 'SV-001',
    createdDate: '2026-02-20',
    vendorName: 'PowerTech Installations',
    contact: '9000011122',
    address: 'Hyderabad',
    gst: '36ABCDE1234F1Z9',
    bankName: 'HDFC Bank',
    accountNumber: 'XXXXXX4521',
    ifsc: 'HDFC0001234',
  },
  {
    id: 'SV-002',
    createdDate: '2026-02-24',
    vendorName: 'GridWorks Services',
    contact: '9000066677',
    address: 'Vijayawada',
    gst: '37PQRSX9012A1Z3',
    bankName: 'SBI',
    accountNumber: 'XXXXXX1180',
    ifsc: 'SBIN0007788',
  },
];

const formatMoney = (value) => Number(value || 0).toLocaleString('en-IN');

const inDateRange = (dateStr, fromDate, toDate) => {
  if (!fromDate && !toDate) return true;
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return false;
  if (fromDate) {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    if (dt < from) return false;
  }
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    if (dt > to) return false;
  }
  return true;
};

const dateFromPo = (po) => {
  if (po.createdDate) return po.createdDate;
  const ts = po.createdAt?.seconds ? new Date(po.createdAt.seconds * 1000) : po.createdAtMs ? new Date(po.createdAtMs) : null;
  return ts ? ts.toISOString().slice(0, 10) : '-';
};

const ServiceVendors = () => {
  const [vendors, setVendors] = useState([]);
  const [poRows, setPoRows] = useState([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingPos, setLoadingPos] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [poPage, setPoPage] = useState(1);
  const [poPerPage, setPoPerPage] = useState(10);
  const [openAddVendor, setOpenAddVendor] = useState(false);
  const [vendorForm, setVendorForm] = useState({
    vendorName: '',
    contact: '',
    address: '',
    gst: '',
    bankName: '',
    accountNumber: '',
    ifsc: '',
  });
  const [currentUser, setCurrentUser] = useState({});
  const [uploadingPoId, setUploadingPoId] = useState('');
  const [uploadingVendorBillPoId, setUploadingVendorBillPoId] = useState('');

  const isAdmin = String(currentUser?.role || '').toLowerCase() === 'admin';

  useEffect(() => {
    const fetchUser = async () => {
      const user = auth.currentUser;
      let role = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = session?.profile?.role || session?.role || '';
      } catch {}

      if (!role && user?.getIdTokenResult) {
        try {
          const token = await user.getIdTokenResult();
          role = token?.claims?.role || '';
        } catch {}
      }
      setCurrentUser({ role });
    };
    fetchUser();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadVendors = async () => {
      try {
        let rows = await fetchCollectionDocs('records_serviceVendors');
        if (!rows.length) {
          await Promise.all(
            initialVendors.map((v) =>
              setDoc(doc(db, 'records_serviceVendors', v.id), {
                ...v,
                createdAtMs: new Date(v.createdDate).getTime(),
              })
            )
          );
          rows = await fetchCollectionDocs('records_serviceVendors');
        }
        if (!mounted) return;
        rows.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        setVendors(rows);
      } catch (err) {
        console.error('❌ Failed loading service vendors', err?.message || err);
      } finally {
        if (mounted) setLoadingVendors(false);
      }
    };

    loadVendors();
    const timer = setInterval(loadVendors, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchText, fromDate, toDate]);

  useEffect(() => {
    setPoPage(1);
  }, [selectedVendorId]);

  useEffect(() => {
    let mounted = true;

    const loadPurchaseOrders = async () => {
      try {
        const rows = await fetchCollectionDocs('servicePurchaseOrders');
        if (!mounted) return;
        rows.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        setPoRows(rows);
      } catch (err) {
        console.error('❌ Failed loading service purchase orders', err?.message || err);
      } finally {
        if (mounted) setLoadingPos(false);
      }
    };

    loadPurchaseOrders();
    const timer = setInterval(loadPurchaseOrders, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) || null,
    [vendors, selectedVendorId]
  );

  const poByVendor = useMemo(() => {
    const map = new Map();
    for (const po of poRows) {
      const vId = String(po.vendorId || '').trim();
      if (!vId) continue;
      if (!map.has(vId)) map.set(vId, []);
      map.get(vId).push(po);
    }
    return map;
  }, [poRows]);

  const rows = useMemo(() => {
    return vendors
      .map((row) => {
        const vendorPos = poByVendor.get(row.id) || [];
        const assignedProjectsCount = vendorPos.reduce((sum, po) => sum + Number(po.assignedProjectsCount || 0), 0);
        const totalPurchasedValue = vendorPos.reduce((sum, po) => sum + Number(po.totalAmount || 0), 0);
        const paidAmount = vendorPos.reduce((sum, po) => sum + Number(po.paymentAmount || 0), 0);
        return {
          ...row,
          assignedProjectsCount,
          totalPurchasedValue,
          paidAmount,
        };
      })
      .filter((row) => {
        const matchesName = row.vendorName?.toLowerCase?.().includes(searchText.trim().toLowerCase());
        const matchesDate = inDateRange(row.createdDate, fromDate, toDate);
        return matchesName && matchesDate;
      });
  }, [vendors, poByVendor, searchText, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = rows.slice(startIdx, startIdx + perPage);

  const createVendorId = () => {
    const max = vendors.reduce((m, v) => {
      const n = Number(String(v.id || '').replace('SV-', ''));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return `SV-${String(max + 1).padStart(3, '0')}`;
  };

  const handleAddVendor = async () => {
    if (!vendorForm.vendorName.trim() || !vendorForm.contact.trim()) return;
    const next = {
      id: createVendorId(),
      createdDate: new Date().toISOString().slice(0, 10),
      createdAtMs: Date.now(),
      vendorName: vendorForm.vendorName.trim(),
      contact: vendorForm.contact.trim(),
      address: vendorForm.address.trim(),
      gst: vendorForm.gst.trim(),
      bankName: vendorForm.bankName.trim(),
      accountNumber: vendorForm.accountNumber.trim(),
      ifsc: vendorForm.ifsc.trim(),
      totalPurchasedValue: 0,
      paidAmount: 0,
    };
    await setDoc(doc(db, 'records_serviceVendors', next.id), next);
    setVendorForm({ vendorName: '', contact: '', address: '', gst: '', bankName: '', accountNumber: '', ifsc: '' });
    setOpenAddVendor(false);
  };

  const handleUploadReceipt = async (poId, file) => {
    if (!poId || !file) return;
    setUploadingPoId(poId);
    try {
      const safeName = String(file.name || 'receipt').replace(/\s+/g, '_');
      const fileRef = ref(storage, `service/po-receipts/${poId}/${Date.now()}_${safeName}`);
      await uploadBytes(fileRef, file, { contentType: file.type || undefined });
      const receiptUrl = await getDownloadURL(fileRef);
      await updateDoc(doc(db, 'servicePurchaseOrders', poId), { receiptUrl });
    } finally {
      setUploadingPoId('');
    }
  };

  const handleUploadVendorBill = async (poId, file) => {
    if (!poId || !file) return;
    setUploadingVendorBillPoId(poId);
    try {
      const safeName = String(file.name || 'vendor-bill').replace(/\s+/g, '_');
      const fileRef = ref(storage, `service/vendor-bills/${poId}/${Date.now()}_${safeName}`);
      await uploadBytes(fileRef, file, { contentType: file.type || undefined });
      const vendorBillUrl = await getDownloadURL(fileRef);
      await updateDoc(doc(db, 'servicePurchaseOrders', poId), { vendorBillUrl });
    } finally {
      setUploadingVendorBillPoId('');
    }
  };

  const handleDeleteVendor = async (vendorId) => {
    if (!isAdmin) return;
    const vendorPos = poRows.filter((po) => String(po.vendorId || '') === String(vendorId || ''));
    await Promise.all(vendorPos.map((po) => deleteDoc(doc(db, 'servicePurchaseOrders', po.id))));
    await deleteDoc(doc(db, 'records_serviceVendors', vendorId));
    if (selectedVendorId === vendorId) setSelectedVendorId(null);
  };

  const detailRows = useMemo(() => {
    if (!selectedVendor) return [];
    return (poByVendor.get(selectedVendor.id) || []).map((po) => ({
      id: po.poNumber || po.id,
      date: dateFromPo(po),
      assignedProjectsCount: Number(po.assignedProjectsCount || 0),
      value: Number(po.totalAmount || 0),
      paid: Number(po.paymentAmount || 0),
      pending: Math.max(0, Number(po.totalAmount || 0) - Number(po.paymentAmount || 0)),
      receiptUrl: po.receiptUrl || '',
      vendorBillUrl: po.vendorBillUrl || '',
      poDocId: po.id,
    }));
  }, [selectedVendor, poByVendor]);

  const totalPoPages = Math.max(1, Math.ceil(detailRows.length / poPerPage));
  const poStartIdx = (poPage - 1) * poPerPage;
  const pagedDetailRows = detailRows.slice(poStartIdx, poStartIdx + poPerPage);

  if (loadingVendors || loadingPos) {
    return <div>Loading vendors...</div>;
  }

  if (selectedVendor) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, color: '#1f2d3d' }}>{selectedVendor.vendorName}</h3>
            <div style={{ color: '#555' }}>{selectedVendor.id} • {selectedVendor.contact}</div>
            <div style={{ color: '#555' }}>{selectedVendor.address}</div>
          </div>
          <button
            onClick={() => setSelectedVendorId(null)}
            style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
          >
            Back to Vendors
          </button>
        </div>

        <div style={{ border: '1px solid #ececec', borderRadius: 8, padding: 14, marginBottom: 12, background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 10 }}>
            <div><strong>GST:</strong> {selectedVendor.gst || '-'}</div>
            <div><strong>Bank:</strong> {selectedVendor.bankName || '-'}</div>
            <div><strong>Account:</strong> {selectedVendor.accountNumber || '-'}</div>
            <div><strong>IFSC:</strong> {selectedVendor.ifsc || '-'}</div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f8f8' }}>
                <th style={th}>Created Date</th>
                <th style={th}>PO Number</th>
                <th style={th}>Assigned Projects Count</th>
                <th style={th}>PO Value</th>
                <th style={th}>Paid Amount</th>
                <th style={th}>Pending</th>
                <th style={th}>PO Receipt</th>
                <th style={th}>Vendor Bill</th>
              </tr>
            </thead>
            <tbody>
              {pagedDetailRows.map((po) => (
                <tr key={po.id}>
                  <td style={td}>{po.date}</td>
                  <td style={td}>{po.id}</td>
                  <td style={td}>{po.assignedProjectsCount}</td>
                  <td style={td}>{formatMoney(po.value)}</td>
                  <td style={td}>{formatMoney(po.paid)}</td>
                  <td style={td}>{formatMoney(po.pending)}</td>
                  <td style={td}>
                    {po.receiptUrl ? (
                      <a href={po.receiptUrl} target="_blank" rel="noopener noreferrer" style={{ color: MAROON, fontWeight: 600 }}>
                        View Receipt
                      </a>
                    ) : (
                      <>
                        <input
                          id={`service-po-receipt-${po.id}`}
                          type="file"
                          accept="image/*,application/pdf"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            handleUploadReceipt(po.poDocId, file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          style={secondaryBtn}
                          disabled={uploadingPoId === po.id}
                          onClick={() => document.getElementById(`service-po-receipt-${po.id}`)?.click()}
                        >
                          {uploadingPoId === po.id ? 'Uploading...' : 'Upload'}
                        </button>
                      </>
                    )}
                  </td>
                  <td style={td}>
                    {po.vendorBillUrl ? (
                      <a href={po.vendorBillUrl} target="_blank" rel="noopener noreferrer" style={{ color: MAROON, fontWeight: 600 }}>
                        View Vendor Bill
                      </a>
                    ) : (
                      <>
                        <input
                          id={`service-po-vendor-bill-${po.id}`}
                          type="file"
                          accept="image/*,application/pdf"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            handleUploadVendorBill(po.poDocId, file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          style={secondaryBtn}
                          disabled={uploadingVendorBillPoId === po.poDocId}
                          onClick={() => document.getElementById(`service-po-vendor-bill-${po.id}`)?.click()}
                        >
                          {uploadingVendorBillPoId === po.poDocId ? 'Uploading...' : 'Upload Bill'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {detailRows.length === 0 && (
                <tr>
                  <td style={{ ...td, textAlign: 'center' }} colSpan={8}>No PO records yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: MAROON, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>
              {detailRows.length === 0 ? 0 : poStartIdx + 1}–{Math.min(poStartIdx + poPerPage, detailRows.length)} of {detailRows.length}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Records per page</span>
              <select
                value={poPerPage}
                onChange={(e) => {
                  setPoPerPage(Number(e.target.value));
                  setPoPage(1);
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
              disabled={poPage <= 1}
              onClick={() => setPoPage((p) => Math.max(1, p - 1))}
              style={{ background: '#fff', border: `1px solid ${MAROON}`, color: MAROON, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Prev
            </button>
            <button
              disabled={poPage >= totalPoPages}
              onClick={() => setPoPage((p) => Math.min(totalPoPages, p + 1))}
              style={{ background: '#fff', border: `1px solid ${MAROON}`, color: MAROON, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginTop: 0, marginBottom: 12, color: '#1f2d3d' }}>Service Vendors</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search by Vendor Name"
            style={inputStyle}
          />
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
        </div>

        <button style={primaryBtn} onClick={() => setOpenAddVendor(true)}>Add Vendor</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f8' }}>
              <th style={th}>Created Date</th>
              <th style={th}>Vendor ID</th>
              <th style={th}>Vendor Name</th>
              <th style={th}>Contact</th>
              <th style={th}>Address</th>
              <th style={th}>Assigned Projects Count</th>
              <th style={th}>Total Purchased Value</th>
              <th style={th}>Paid Amount</th>
              <th style={th}>Pending Amount</th>
              {isAdmin && <th style={th}>Delete</th>}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => {
              const pending = Number(row.totalPurchasedValue || 0) - Number(row.paidAmount || 0);
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedVendorId(row.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={td}>{row.createdDate}</td>
                  <td style={td}>{row.id}</td>
                  <td style={td}>{row.vendorName}</td>
                  <td style={td}>{row.contact}</td>
                  <td style={td}>{row.address}</td>
                  <td style={td}>{row.assignedProjectsCount}</td>
                  <td style={td}>{formatMoney(row.totalPurchasedValue)}</td>
                  <td style={td}>{formatMoney(row.paidAmount)}</td>
                  <td style={td}>{formatMoney(pending)}</td>
                  {isAdmin && (
                    <td style={td}>
                      <button
                        style={dangerBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteVendor(row.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: 'center' }} colSpan={isAdmin ? 10 : 9}>No vendors found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: MAROON, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {rows.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, rows.length)} of {rows.length}
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

      {openAddVendor && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>Add Service Vendor</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input placeholder="Vendor Name *" value={vendorForm.vendorName} onChange={(e) => setVendorForm((p) => ({ ...p, vendorName: e.target.value }))} style={inputStyle} />
              <input placeholder="Contact *" value={vendorForm.contact} onChange={(e) => setVendorForm((p) => ({ ...p, contact: e.target.value }))} style={inputStyle} />
              <input placeholder="Address" value={vendorForm.address} onChange={(e) => setVendorForm((p) => ({ ...p, address: e.target.value }))} style={inputStyle} />
              <input placeholder="GST" value={vendorForm.gst} onChange={(e) => setVendorForm((p) => ({ ...p, gst: e.target.value }))} style={inputStyle} />
              <input placeholder="Bank Name" value={vendorForm.bankName} onChange={(e) => setVendorForm((p) => ({ ...p, bankName: e.target.value }))} style={inputStyle} />
              <input placeholder="Account Number" value={vendorForm.accountNumber} onChange={(e) => setVendorForm((p) => ({ ...p, accountNumber: e.target.value }))} style={inputStyle} />
              <input placeholder="IFSC" value={vendorForm.ifsc} onChange={(e) => setVendorForm((p) => ({ ...p, ifsc: e.target.value }))} style={inputStyle} />
              <input value={createVendorId()} readOnly style={{ ...inputStyle, background: '#f7f7f7' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={secondaryBtn} onClick={() => setOpenAddVendor(false)}>Cancel</button>
              <button style={primaryBtn} onClick={handleAddVendor}>Save Vendor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const th = { textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid #ececec', whiteSpace: 'nowrap' };
const td = { padding: '12px 10px', borderBottom: '1px solid #f1f1f1', whiteSpace: 'nowrap' };

const inputStyle = {
  height: 36,
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '0 10px',
  minWidth: 180,
};

const primaryBtn = {
  height: 36,
  border: 'none',
  borderRadius: 6,
  padding: '0 14px',
  background: MAROON,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const secondaryBtn = {
  height: 34,
  border: '1px solid #d0d0d0',
  borderRadius: 6,
  padding: '0 12px',
  background: '#fff',
  color: '#222',
  cursor: 'pointer',
  fontWeight: 600,
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

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.25)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modal = {
  width: 'min(760px, 92vw)',
  background: '#fff',
  borderRadius: 10,
  padding: 16,
};

export default ServiceVendors;
