import React, { useEffect, useMemo, useState } from 'react';
import { auth, db, serverTimestamp } from '../../../firebaseConfig';
import { collection, doc, getDoc, onSnapshot, runTransaction, updateDoc } from 'firebase/firestore';
import { generateAndUploadGrnPdf, extractRoleFromSession, normalizeRole } from './purchaseHelpers';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';
const KAPIL_LOGO_URL = '/brands/kapil_power_logo.png';
const PRIVILEGED_ADMIN_UID = '26VHcREEDMMg8C24kXYVGzRXHe43';

const GRN = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [poRows, setPoRows] = useState([]);
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [receiveQty, setReceiveQty] = useState({});
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [currentUserUid, setCurrentUserUid] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const isAdmin = normalizeRole(currentUserRole) === 'admin' || String(currentUserUid || '') === PRIVILEGED_ADMIN_UID;

  useEffect(() => {
    const hydrateUser = async () => {
      let role = '';
      let uid = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = extractRoleFromSession(session);
        uid = String(session?.uid || session?.profile?.uid || session?.user?.uid || '');
      } catch {}
      if (!role && auth.currentUser?.getIdTokenResult) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          role = normalizeRole(token?.claims?.role || token?.claims?.Role || '');
          uid = uid || String(token?.claims?.user_id || auth.currentUser?.uid || '');
        } catch {}
      }
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
      if (!uid && auth.currentUser?.uid) {
        uid = String(auth.currentUser.uid);
      }
      setCurrentUserUid(uid);
      setCurrentUserRole(role);
    };
    hydrateUser();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [grnList, poList] = await Promise.all([
          fetchCollectionDocs('records_grn'),
          fetchCollectionDocs('purchaseOrders'),
        ]);
        if (!mounted) return;
        grnList.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        poList.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        setRows(grnList);
        setPoRows(poList);
        setSelectedPoId((prev) => prev || poList[0]?.id || '');
      } catch (err) {
        console.error('❌ Failed loading GRN data', err?.message || err);
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

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const selectedPo = useMemo(() => poRows.find((po) => po.id === selectedPoId) || null, [poRows, selectedPoId]);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = rows.slice(startIdx, startIdx + perPage);

  const getRemainingQty = (po, item) => {
    const poQty = Number(item?.quantity || 0);
    const received = Number(po?.grnReceivedByVariant?.[item?.variantId] || 0);
    return Math.max(0, poQty - received);
  };

  const getPoRemainingTotal = (po) => {
    return (po?.items || []).reduce((sum, item) => sum + getRemainingQty(po, item), 0);
  };

  const openAddModal = () => {
    const firstOpenPo = poRows.find((po) => getPoRemainingTotal(po) > 0);
    if (!firstOpenPo) return;
    const initial = {};
    (firstOpenPo.items || []).forEach((i) => { initial[i.variantId] = 0; });
    setSelectedPoId(firstOpenPo.id);
    setReceiveQty(initial);
    setOpenAdd(true);
  };

  const onPoChange = (poId) => {
    setSelectedPoId(poId);
    const po = poRows.find((p) => p.id === poId);
    const initial = {};
    (po?.items || []).forEach((i) => { initial[i.variantId] = 0; });
    setReceiveQty(initial);
  };

  const createGrnNumber = () => {
    const max = rows.reduce((m, r) => {
      const n = Number(String(r.grnNumber || r.id || '').replace('GRN-', ''));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return `GRN-${String(max + 1).padStart(3, '0')}`;
  };

  const handleCreateGrn = async () => {
    if (!selectedPo) return;
    const items = (selectedPo.items || [])
      .map((item) => {
        const remaining = getRemainingQty(selectedPo, item);
        const qty = Math.max(0, Math.min(Number(receiveQty[item.variantId] || 0), remaining));
        if (!qty) return null;
        return { ...item, quantity: qty };
      })
      .filter(Boolean);
    if (!items.length) return;

    const grnNumber = createGrnNumber();
    const createdDate = new Date().toISOString().slice(0, 10);
    const receivedItems = items.map((item) => {
      const poItem = (selectedPo.items || []).find((x) => x.variantId === item.variantId);
      return {
        ...item,
        poQuantity: Number(poItem?.quantity || 0),
      };
    });

    await runTransaction(db, async (transaction) => {
      const poRef = doc(db, 'purchaseOrders', selectedPo.id);
      const poSnap = await transaction.get(poRef);
      if (!poSnap.exists()) throw new Error('PO not found');
      const poData = poSnap.data() || {};

      const prevReceived = { ...(poData.grnReceivedByVariant || {}) };
      const variantAvailableById = {};

      for (const item of items) {
        const variantRef = doc(db, 'inventoryVariants', item.variantId);
        const variantSnap = await transaction.get(variantRef);
        if (!variantSnap.exists()) throw new Error(`Variant not found: ${item.variantId}`);
        variantAvailableById[item.variantId] = Number(variantSnap.data().availableQuantity || 0);
      }

      for (const item of items) {
        const poItem = (poData.items || []).find((x) => x.variantId === item.variantId);
        const poQty = Number(poItem?.quantity || 0);
        const alreadyReceived = Number(prevReceived[item.variantId] || 0);
        const remaining = Math.max(0, poQty - alreadyReceived);
        const requestQty = Number(item.quantity || 0);

        if (requestQty > remaining) {
          throw new Error(`Received qty exceeds remaining PO qty for ${item.variantName || item.variantId}`);
        }

        const variantRef = doc(db, 'inventoryVariants', item.variantId);
        const available = Number(variantAvailableById[item.variantId] || 0);
        transaction.update(variantRef, {
          availableQuantity: available + requestQty,
          lastUpdatedAt: serverTimestamp(),
        });

        const ledgerRef = doc(collection(db, 'stockLedger'));
        transaction.set(ledgerRef, {
          type: 'stockIN',
          referenceType: 'GRN',
          referenceId: grnNumber,
          variantId: item.variantId,
          productId: item.productId || '',
          quantity: requestQty,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || '',
        });

        prevReceived[item.variantId] = alreadyReceived + requestQty;
      }

      transaction.update(poRef, {
        grnReceivedByVariant: prevReceived,
        updatedAtMs: Date.now(),
      });

      const grnRef = doc(db, 'records_grn', grnNumber);
      transaction.set(grnRef, {
        grnNumber,
        createdDate,
        createdAtMs: Date.now(),
        vendorId: poData.vendorId || '',
        vendorName: poData.vendorName || '',
        referencePO: poData.poNumber || selectedPo.id,
        poId: selectedPo.id,
        items: receivedItems,
        grnPdfUrl: '',
      });
    });

    try {
      const grnPayload = {
        grnNumber,
        createdDate,
        vendorId: selectedPo.vendorId || '',
        vendorName: selectedPo.vendorName || '',
        referencePO: selectedPo.poNumber || selectedPo.id,
        poId: selectedPo.id,
        items: receivedItems,
      };
      const grnPdfUrl = await generateAndUploadGrnPdf({
        grn: grnPayload,
        logoUrl: KAPIL_LOGO_URL,
      });
      await updateDoc(doc(db, 'records_grn', grnNumber), {
        grnPdfUrl,
        updatedAtMs: Date.now(),
      });
    } catch (e) {
      // keep GRN creation successful even if PDF upload fails
      // eslint-disable-next-line no-console
      console.error('GRN PDF generation failed:', e);
    }

    setOpenAdd(false);
  };

  const handleDeleteGrn = async (grn) => {
    if (!isAdmin) return;
    if (!grn?.id) return;
    const previous = rows;
    setDeletingId(grn.id);
    setRows((prev) => prev.filter((r) => r.id !== grn.id));

    try {
      await runTransaction(db, async (transaction) => {
        const grnRef = doc(db, 'records_grn', grn.id);
        const grnSnap = await transaction.get(grnRef);
        if (!grnSnap.exists()) return;
        const grnData = grnSnap.data() || {};

        const poId = grnData.poId || '';
        const poRef = poId ? doc(db, 'purchaseOrders', poId) : null;
        let poExists = false;
        let poData = {};
        if (poRef) {
          const poSnap = await transaction.get(poRef);
          poExists = poSnap.exists();
          poData = poExists ? (poSnap.data() || {}) : {};
        }

        const nextReceived = { ...(poData.grnReceivedByVariant || {}) };
        const grnItems = Array.isArray(grnData.items) ? grnData.items : [];
        const variantAvailableById = {};

        for (const item of grnItems) {
          const variantId = item?.variantId;
          if (!variantId) continue;
          const variantRef = doc(db, 'inventoryVariants', variantId);
          const variantSnap = await transaction.get(variantRef);
          if (variantSnap.exists()) {
            variantAvailableById[variantId] = Number(variantSnap.data().availableQuantity || 0);
          }
        }

        for (const item of grnItems) {
          const variantId = item?.variantId;
          const qty = Number(item?.quantity || 0);
          if (!variantId || qty <= 0) continue;

          const variantRef = doc(db, 'inventoryVariants', variantId);
          if (Object.prototype.hasOwnProperty.call(variantAvailableById, variantId)) {
            const available = Number(variantAvailableById[variantId] || 0);
            transaction.update(variantRef, {
              availableQuantity: Math.max(0, available - qty),
              lastUpdatedAt: serverTimestamp(),
            });
          }

          const prev = Number(nextReceived[variantId] || 0);
          nextReceived[variantId] = Math.max(0, prev - qty);

          const ledgerRef = doc(collection(db, 'stockLedger'));
          transaction.set(ledgerRef, {
            type: 'stockOUT',
            referenceType: 'GRN_DELETE',
            referenceId: grnData.grnNumber || grn.id,
            variantId,
            productId: item?.productId || '',
            quantity: qty,
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.uid || '',
          });
        }

        if (poRef && poExists) {
          transaction.update(poRef, {
            grnReceivedByVariant: nextReceived,
            updatedAtMs: Date.now(),
          });
        }

        transaction.delete(grnRef);
      });
    } catch (e) {
      setRows(previous);
      alert(e?.message || 'Delete failed');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) return <div>Loading GRN...</div>;

  const grnEligiblePoRows = poRows.filter((po) => getPoRemainingTotal(po) > 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <button style={primaryBtn} onClick={openAddModal} disabled={!grnEligiblePoRows.length}>Add GRN</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f8' }}>
              <th style={th}>Created Date</th>
              <th style={th}>GRN Number</th>
              <th style={th}>Vendor Name</th>
              <th style={th}>Reference PO</th>
              <th style={th}>View GRN</th>
              {isAdmin && <th style={th}>Delete</th>}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => (
              <tr key={row.id}>
                <td style={td}>{row.createdDate}</td>
                <td style={td}>{row.grnNumber || row.id}</td>
                <td style={td}>{row.vendorName}</td>
                <td style={td}>{row.referencePO}</td>
                <td style={td}>{row.grnPdfUrl ? <a href={row.grnPdfUrl} target="_blank" rel="noreferrer">View</a> : '-'}</td>
                {isAdmin && (
                  <td style={td}>
                    <button style={dangerBtn} disabled={deletingId === row.id} onClick={() => handleDeleteGrn(row)}>
                      {deletingId === row.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: 'center' }} colSpan={isAdmin ? 6 : 5}>No GRN records yet</td>
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

      {openAdd && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>Add GRN</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <select value={selectedPoId} onChange={(e) => onPoChange(e.target.value)} style={inputStyle}>
                {grnEligiblePoRows.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNumber || po.id} | {po.vendorName} | Remaining: {getPoRemainingTotal(po)}
                  </option>
                ))}
              </select>
              <input readOnly value={createGrnNumber()} style={{ ...inputStyle, background: '#f7f7f7' }} />
            </div>

            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10 }}>
              {(selectedPo?.items || []).map((item) => (
                <div key={item.variantId} style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.8fr 0.8fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    {item.productName} | {item.brandName} | {item.variantName}
                    {item.specification ? ` (${item.specification})` : ''}
                  </div>
                  <div>
                    PO Qty: {Number(item.quantity || 0)}
                    <br />
                    Remaining: {getRemainingQty(selectedPo, item)}
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={getRemainingQty(selectedPo, item)}
                    value={receiveQty[item.variantId] ?? 0}
                    onChange={(e) => {
                      const raw = Number(e.target.value || 0);
                      const safe = Math.max(0, Math.min(raw, getRemainingQty(selectedPo, item)));
                      setReceiveQty((prev) => ({ ...prev, [item.variantId]: safe }));
                    }}
                    style={inputStyle}
                  />
                  <div>{item.unit || 'Nos'}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button style={secondaryBtn} onClick={() => setOpenAdd(false)}>Cancel</button>
              <button style={primaryBtn} onClick={handleCreateGrn}>Create GRN</button>
            </div>
          </div>
        </div>
      )}
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
};

export default GRN;
