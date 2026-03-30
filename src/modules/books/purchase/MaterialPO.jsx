import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { auth, db } from '../../../firebaseConfig';
import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import UploadPI from './UploadPI';
import CreateMaterialPO from './CreateMaterialPO';
import MaterialPOApproval from './MaterialPOApproval';
import MaterialPOPayment from './MaterialPOPayment';
import {
  createNotificationIfNotExists,
  extractRoleFromSession,
  isFinanceOrAdminRole,
  normalizeRole,
} from './purchaseHelpers';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';

const formatMoney = (value) => Number(value || 0).toLocaleString('en-IN');

const MaterialPO = () => {
  const [currentUser, setCurrentUser] = useState({});
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [variants, setVariants] = useState([]);
  const [openCreatePo, setOpenCreatePo] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [poItems, setPoItems] = useState([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const isAdmin = String(currentUser?.role || '').toLowerCase() === 'admin';

  useEffect(() => {
    const fetchUser = async () => {
      const user = auth.currentUser;
      let role = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = extractRoleFromSession(session);
      } catch {}
      if (!role && user?.getIdTokenResult) {
        try {
          const token = await user.getIdTokenResult();
          role = normalizeRole(token?.claims?.role || token?.claims?.Role || '');
        } catch {}
      }
      setCurrentUser({ role });
    };
    fetchUser();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [poList, vendorList, variantDocs] = await Promise.all([
          fetchCollectionDocs('records_materialPO'),
          fetchCollectionDocs('records_materialVendors'),
          fetchCollectionDocs('inventoryVariants'),
        ]);
        if (!mounted) return;

        const sortedPo = [...poList].sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        setRows(sortedPo);
        setVendors(vendorList);
        setSelectedVendorId((prev) => prev || vendorList[0]?.id || '');

        const mappedVariants = variantDocs.map((v) => {
          const spec = v?.specifications?.wattPeak != null ? `${v.specifications.wattPeak}Wp` : '';
          return {
            id: v.id,
            productId: v.productId || v.product_id || v.id,
            productName: v.productName || v.product_name || 'Product',
            brandName: v.brandName || v.brand_name || '-',
            variantName: v.variantName || v.variant_name || v.variantId || v.id,
            unit: v.unit || 'Nos',
            defaultPrice: Number(v.defaultPrice || 0),
            specification: spec,
          };
        });
        setVariants(mappedVariants);
        setSelectedVariantId((prev) => prev || mappedVariants[0]?.id || '');
      } catch (err) {
        console.error('❌ Failed loading material PO screen data', err?.message || err);
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

  const createPoNumber = () => {
    const max = rows.reduce((m, r) => {
      const n = Number(String(r.poNumber || '').replace('PO-M-', ''));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 1000);
    return `PO-M-${max + 1}`;
  };

  const selectedVendor = useMemo(() => vendors.find((v) => v.id === selectedVendorId) || null, [vendors, selectedVendorId]);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = rows.slice(startIdx, startIdx + perPage);

  const addPoItem = () => {
    const variant = variants.find((v) => v.id === selectedVariantId);
    if (!variant) return;
    setPoItems((prev) => {
      if (prev.some((i) => i.variantId === variant.id)) return prev;
      return [
        ...prev,
        {
          productId: variant.productId,
          variantId: variant.id,
          productName: variant.productName,
          brandName: variant.brandName,
          variantName: variant.variantName,
          specification: variant.specification,
          unit: variant.unit,
          quantity: 1,
          unitPrice: Number(variant.defaultPrice || 0),
        },
      ];
    });
  };

  const updatePoItem = (variantId, key, value) => {
    setPoItems((prev) =>
      prev.map((i) => {
        if (i.variantId !== variantId) return i;
        return { ...i, [key]: Number(value || 0) };
      })
    );
  };

  const removePoItem = (variantId) => {
    setPoItems((prev) => prev.filter((i) => i.variantId !== variantId));
  };

  const handleCreatePo = async () => {
    if (!selectedVendor || poItems.length === 0) return;
    const cleanItems = poItems
      .map((i) => ({
        ...i,
        quantity: Math.max(0, Number(i.quantity || 0)),
        unitPrice: Math.max(0, Number(i.unitPrice || 0)),
        total: Math.max(0, Number(i.quantity || 0)) * Math.max(0, Number(i.unitPrice || 0)),
      }))
      .filter((i) => i.quantity > 0);
    if (!cleanItems.length) return;

    const poValue = cleanItems.reduce((sum, i) => sum + Number(i.total || 0), 0);
    const payload = {
      poNumber: createPoNumber(),
      createdDate: new Date().toISOString().slice(0, 10),
      createdAtMs: Date.now(),
      vendorId: selectedVendor.id,
      vendorName: selectedVendor.vendorName,
      items: cleanItems,
      poValue,
      paidAmount: 0,
      pendingAmount: poValue,
      approvalStatus: 'draft',
      receiptUrl: '',
      grnReceivedByVariant: {},
    };
    await setDoc(doc(db, 'records_materialPO', payload.poNumber), payload);
    setPoItems([]);
    setOpenCreatePo(false);
  };

  const sendForApproval = async (po) => {
    await updateDoc(doc(db, 'records_materialPO', po.id), {
      approvalStatus: 'sent_for_approval',
    });
  };

  const deletePo = async (po) => {
    if (!isAdmin) return;
    await deleteDoc(doc(db, 'records_materialPO', po.id));
  };

  if (loading) return <div>Loading PO...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <button style={primaryBtn} onClick={() => setOpenCreatePo(true)}>Create PO</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f8' }}>
              <th style={th}>Created Date</th>
              <th style={th}>PO Number</th>
              <th style={th}>PO Value</th>
              <th style={th}>Paid Amount</th>
              <th style={th}>Pending</th>
              <th style={th}>View PO</th>
              <th style={th}>Approval</th>
              {isAdmin && <th style={th}>Delete</th>}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => {
              const pending = Number(row.pendingAmount || 0);
              return (
                <tr key={row.id}>
                  <td style={td}>{row.createdDate}</td>
                  <td style={td}>{row.poNumber || row.id}</td>
                  <td style={td}>{formatMoney(row.poValue)}</td>
                  <td style={td}>{formatMoney(row.paidAmount)}</td>
                  <td style={td}>{formatMoney(pending)}</td>
                  <td style={td}><button style={secondaryBtn}>PDF</button></td>
                  <td style={td}>
                    {String(row.approvalStatus || '').toLowerCase() === 'approved' ? (
                      <span style={{ color: '#1f7a1f', fontWeight: 600 }}>Approved</span>
                    ) : String(row.approvalStatus || '').toLowerCase() === 'sent_for_approval' ? (
                      <span style={{ color: '#9c6f00', fontWeight: 600 }}>Sent</span>
                    ) : (
                      <button style={primaryBtn} onClick={() => sendForApproval(row)}>Send for Approval</button>
                    )}
                  </td>
                  {isAdmin && (
                    <td style={td}>
                      <button style={dangerBtn} onClick={() => deletePo(row)}>Delete</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: 'center' }} colSpan={isAdmin ? 8 : 7}>No PO records yet</td>
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

      {openCreatePo && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>Create Material PO</h3>
            <div style={{ overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <select value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)} style={inputStyle}>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.id} | {v.vendorName}</option>)}
                </select>
                <input readOnly value={createPoNumber()} style={{ ...inputStyle, background: '#f7f7f7' }} />
              </div>

              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Add Item</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.productName} | {v.brandName} | {v.variantName}{v.specification ? ` (${v.specification})` : ''}
                      </option>
                    ))}
                  </select>
                  <button style={primaryBtn} onClick={addPoItem}>+ Add</button>
                </div>
              </div>

              {poItems.map((item) => (
                <div key={item.variantId} style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.9fr 0.7fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <div>{item.productName} | {item.brandName} | {item.variantName}{item.specification ? ` (${item.specification})` : ''}</div>
                  <input type="number" min={1} value={item.quantity} onChange={(e) => updatePoItem(item.variantId, 'quantity', e.target.value)} style={inputStyle} />
                  <input type="number" min={0} value={item.unitPrice} onChange={(e) => updatePoItem(item.variantId, 'unitPrice', e.target.value)} style={inputStyle} />
                  <div style={{ textAlign: 'right' }}>{formatMoney(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</div>
                  <button style={secondaryBtn} onClick={() => removePoItem(item.variantId)}>Remove</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, borderTop: '1px solid #ececec', paddingTop: 10 }}>
              <div style={{ fontWeight: 700 }}>PO Value: {formatMoney(poItems.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0))}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={secondaryBtn} onClick={() => setOpenCreatePo(false)}>Cancel</button>
                <button style={primaryBtn} onClick={handleCreatePo}>Save PO</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MaterialPOWorkflow = () => {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [variants, setVariants] = useState([]);
  const [pis, setPis] = useState([]);
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [openUploadPi, setOpenUploadPi] = useState(false);
  const [openCreatePo, setOpenCreatePo] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [activeTab, setActiveTab] = useState('purchase');
  const [searchPo, setSearchPo] = useState('');
  const [periodDate, setPeriodDate] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const isAdmin = normalizeRole(currentUserRole) === 'admin';

  useEffect(() => {
    const hydrateUser = async () => {
      let role = '';
      let uid = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = extractRoleFromSession(session);
        uid = session?.uid || session?.profile?.uid || '';
      } catch {}
      if (!role && auth.currentUser?.getIdTokenResult) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          role = normalizeRole(token?.claims?.role || token?.claims?.Role || '');
          uid = uid || token?.claims?.user_id || auth.currentUser?.uid || '';
        } catch {}
      }

      // Fallback to Firestore profile if role is still empty
      if (!role && uid) {
        try {
          const snap = await getDoc(doc(db, 'Users', uid));
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
    const params = new URLSearchParams(location.search || '');
    const tab = String(params.get('tab') || '').toLowerCase();
    if (tab === 'approval') setActiveTab('approval');
  }, [location.search]);

  useEffect(() => {
    setPage(1);
  }, [searchPo, periodDate, activeTab]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [poList, vendorList, variantList, piList] = await Promise.all([
          fetchCollectionDocs('purchaseOrders', 3500, 0),
          fetchCollectionDocs('records_materialVendors', 3500, 0),
          fetchCollectionDocs('inventoryVariants', 3500, 0),
          fetchCollectionDocs('pis', 3500, 0),
        ]);
        if (!mounted) return;
        poList.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        piList.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        setRows(poList);
        setVendors(vendorList);
        setVariants(variantList);
        setPis(piList);
      } catch (err) {
        console.error('❌ Failed loading material workflow data', err?.message || err);
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
      await updateDoc(doc(db, 'purchaseOrders', row.id), {
        status: 'pending_approval',
        updatedAt: serverTimestamp(),
      });

      createNotificationIfNotExists({
        dedupeKey: `po_approval_${row.id}_pending_approval`,
        title: 'PO Approval Required',
        message: `${row.poNumber} requires approval`,
        type: 'po_approval',
        module: 'books',
        referenceId: row.id,
        referenceType: 'purchaseOrder',
        toRole: 'dgm',
      }).catch((notifyErr) => {
        console.error('PO approval notification failed', notifyErr);
      });
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: previousStatus } : r)));
      alert(e?.message || 'Failed to send for approval');
    } finally {
      setBusyId('');
    }
  };

  const handleDelete = async (row) => {
    if (!isAdmin) return;
    if (!row?.id) return;
    const previous = rows;
    setDeletingId(row.id);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      await deleteDoc(doc(db, 'purchaseOrders', row.id));
    } catch (e) {
      setRows(previous);
      alert(e?.message || 'Delete failed');
    } finally {
      setDeletingId('');
    }
  };

  const financeSectionVisible = isFinanceOrAdminRole(currentUserRole);

  const filteredRows = useMemo(() => {
    const term = String(searchPo || '').trim().toLowerCase();
    return rows.filter((row) => {
      const poMatch = !term || String(row.poNumber || '').toLowerCase().includes(term);
      const dateMatch = !periodDate || String(row.createdDate || '') === periodDate;
      return poMatch && dateMatch;
    });
  }, [rows, searchPo, periodDate]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = filteredRows.slice(startIdx, startIdx + perPage);

  if (loading) return <div>Loading material PO...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button
          style={activeTab === 'purchase' ? primaryBtn : tabBtn}
          onClick={() => setActiveTab('purchase')}
        >
          Purchase Orders
        </button>
        {financeSectionVisible && (
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
          <button style={secondaryBtn} onClick={() => setOpenUploadPi(true)}>Upload PI</button>
          <button style={primaryBtn} onClick={() => setOpenCreatePo(true)} disabled={!pis.length}>Create PO</button>
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
                <th style={th}>PI</th>
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
                const status = String(row.status || 'draft').toLowerCase();
                const pending = Math.max(0, Number(row.totalAmount || 0) - Number(row.paymentAmount || 0));
                const paymentStatus = String(row.paymentStatus || (pending <= 0 ? 'paid' : 'pending')).toLowerCase();
                return (
                  <tr key={row.id}>
                    <td style={td}>{row.createdDate || '-'}</td>
                    <td style={td}>{row.poNumber}</td>
                    <td style={td}>{row.vendorName}</td>
                    <td style={td}>{row.piPdfUrl ? <a href={row.piPdfUrl} target="_blank" rel="noreferrer">{row.piNumber || 'PI'}</a> : '-'}</td>
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
                        <span style={{ fontWeight: 700, color: status === 'approved' ? '#1f7a1f' : '#9c6f00' }}>{status.replaceAll('_', ' ')}</span>
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
              {!filteredRows.length && <tr><td style={{ ...td, textAlign: 'center' }} colSpan={isAdmin ? 12 : 11}>No purchase orders found</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        financeSectionVisible ? (
          <>
            <MaterialPOApproval
              rows={filteredRows}
              vendors={vendors}
              currentUserRole={currentUserRole}
              onRowStatusChange={(rowId, updates) => {
                setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...updates } : r)));
              }}
            />
            <MaterialPOPayment rows={filteredRows} currentUserRole={currentUserRole} />
          </>
        ) : (
          <div style={{ padding: 16, background: '#fff', border: '1px solid #ececec', borderRadius: 8 }}>Approval queue is visible only for Admin, Sales Head, Director, AGM and DGM.</div>
        )
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

      <UploadPI
        open={openUploadPi}
        onClose={() => setOpenUploadPi(false)}
        vendors={vendors}
        onUploaded={(newPi) => {
          setPis((prev) => {
            const next = [{ ...newPi }, ...prev.filter((r) => r.id !== newPi.id)];
            next.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
            return next;
          });
        }}
      />
      <CreateMaterialPO
        open={openCreatePo}
        onClose={() => setOpenCreatePo(false)}
        vendors={vendors}
        variants={variants}
        pis={pis}
        onCreated={(newPo) => {
          setRows((prev) => {
            const next = [{ ...newPo }, ...prev.filter((r) => r.id !== newPo.id)];
            next.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
            return next;
          });
          if (newPo?.linkedPiId) {
            setPis((prev) => prev.filter((p) => p.id !== newPo.linkedPiId));
          }
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

const secondaryBtn = {
  height: 30,
  border: '1px solid #d0d0d0',
  borderRadius: 6,
  padding: '0 10px',
  background: '#fff',
  cursor: 'pointer',
};

const tabBtn = {
  height: 34,
  border: '1px solid #2f2f2f',
  borderRadius: 0,
  padding: '0 16px',
  background: '#fff',
  color: '#111',
  fontWeight: 700,
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

const inputStyle = {
  height: 36,
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '0 10px',
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
  width: 'min(900px, 94vw)',
  background: '#fff',
  borderRadius: 10,
  padding: 16,
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
};

export default MaterialPOWorkflow;
