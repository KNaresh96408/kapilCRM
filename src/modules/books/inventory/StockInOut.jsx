import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import { fetchCollectionDocs, getDocsWithFallback } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';
const PRIVILEGED_ADMIN_UID = '26VHcREEDMMg8C24kXYVGzRXHe43';

const normalizeRole = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const toDateValue = (row) => {
  if (row?.createdAtMs) return Number(row.createdAtMs);
  const ts = row?.createdAt || row?.updatedAt || null;
  if (ts?.seconds) return Number(ts.seconds) * 1000;
  if (typeof ts === 'string' || ts instanceof Date) {
    const dt = new Date(ts).getTime();
    return Number.isFinite(dt) ? dt : 0;
  }
  if (row?.createdDate) {
    const dt = new Date(row.createdDate).getTime();
    return Number.isFinite(dt) ? dt : 0;
  }
  return 0;
};

const formatDate = (row) => {
  if (row?.createdDate) return String(row.createdDate);
  const t = toDateValue(row);
  if (!t) return '-';
  return new Date(t).toISOString().slice(0, 10);
};

const normalizeItems = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const qty = Number(item?.quantity || 0);
      if (!qty) return null;
      return {
        productName: String(item?.productName || item?.name || item?.productId || item?.variantId || '-'),
        variantName: String(item?.variantName || item?.variantId || '-'),
        specification: String(item?.specification || item?.spec || '-'),
        quantity: qty,
        unit: String(item?.unit || 'Nos'),
      };
    })
    .filter(Boolean);
};

const normalizeLedgerItems = (row = {}) => {
  const fromItems = normalizeItems(row.items || []);
  if (fromItems.length) return fromItems;

  const qty = Number(row.quantity || 0);
  if (!qty) return [];

  return [{
    productName: String(row.productName || row.productId || row.variantId || '-'),
    variantName: String(row.variantName || row.variantId || '-'),
    specification: String(row.specification || row.spec || '-'),
    quantity: Math.abs(qty),
    unit: String(row.unit || 'Nos'),
  }];
};

const toProductQtyMap = (items) => {
  const map = {};
  (items || []).forEach((item) => {
    const key = String(item.productName || '-').trim() || '-';
    map[key] = Number(map[key] || 0) + Number(item.quantity || 0);
  });
  return map;
};

const buildCsv = (headers, rows) => {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [headers.map(esc).join(',')];
  rows.forEach((r) => {
    lines.push(headers.map((h) => esc(r[h] ?? '')).join(','));
  });
  return lines.join('\n');
};

const downloadCsv = (fileName, headers, rows) => {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

const deleteCollectionInChunks = async (collectionName, chunkSize = 300) => {
  let cursor = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const q = cursor
      ? query(collection(db, collectionName), orderBy('__name__'), startAfter(cursor), limit(chunkSize))
      : query(collection(db, collectionName), orderBy('__name__'), limit(chunkSize));

    const rows = await getDocsWithFallback(q, collectionName, null, 3500);
    if (!rows.length) break;

    const batch = writeBatch(db);
    rows.forEach((row) => batch.delete(doc(db, collectionName, row.id)));
    await batch.commit();

    if (rows.length < chunkSize) break;
    const cursorSnap = await getDocs(q);
    if (cursorSnap.empty || cursorSnap.docs.length < chunkSize) break;
    cursor = cursorSnap.docs[cursorSnap.docs.length - 1];
  }
};

const updateCollectionInChunks = async (collectionName, updater, chunkSize = 300) => {
  let cursor = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const q = cursor
      ? query(collection(db, collectionName), orderBy('__name__'), startAfter(cursor), limit(chunkSize))
      : query(collection(db, collectionName), orderBy('__name__'), limit(chunkSize));

    const rows = await getDocsWithFallback(q, collectionName, null, 3500);
    if (!rows.length) break;

    const batch = writeBatch(db);
    rows.forEach((row) => {
      const payload = updater({ id: row.id, data: () => row.data });
      if (payload) batch.update(doc(db, collectionName, row.id), payload);
    });
    await batch.commit();

    if (rows.length < chunkSize) break;
    const cursorSnap = await getDocs(q);
    if (cursorSnap.empty || cursorSnap.docs.length < chunkSize) break;
    cursor = cursorSnap.docs[cursorSnap.docs.length - 1];
  }
};

const StockInOut = () => {
  const [activeTab, setActiveTab] = useState('stockin');
  const [grnRows, setGrnRows] = useState([]);
  const [creditRows, setCreditRows] = useState([]);
  const [dcRows, setDcRows] = useState([]);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [resetting, setResetting] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [currentUserUid, setCurrentUserUid] = useState('');

  const isAdmin = normalizeRole(currentUserRole) === 'admin' || String(currentUserUid || '') === PRIVILEGED_ADMIN_UID;

  useEffect(() => {
    const hydrateUser = async () => {
      let role = '';
      let uid = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = session?.profile?.role || session?.profile?.Role || session?.role || session?.Role || '';
        uid = String(session?.uid || session?.profile?.uid || session?.user?.uid || '');
      } catch {}

      if (!role && auth.currentUser?.getIdTokenResult) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          role = token?.claims?.role || token?.claims?.Role || '';
          uid = uid || String(token?.claims?.user_id || auth.currentUser?.uid || '');
        } catch {}
      }

      if (!role && uid) {
        try {
          const snap = await getDoc(doc(db, 'Users', uid));
          if (snap.exists()) {
            role = snap.data()?.role || snap.data()?.Role || '';
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
        const [grnDocs, creditDocs, dcDocs, ledgerDocs] = await Promise.all([
          fetchCollectionDocs('records_grn'),
          fetchCollectionDocs('creditNotes'),
          fetchCollectionDocs('deliveryChallans'),
          fetchCollectionDocs('stockLedger'),
        ]);
        if (!mounted) return;

        const nextGrnRows = grnDocs.map((row) => {
          const materials = normalizeItems(row.items || []);
          return {
            id: `grn:${row.id}`,
            sourceType: 'GRN',
            createdDate: formatDate(row),
            createdAtMs: toDateValue(row),
            docNumber: row.grnNumber || row.id,
            reference: row.referencePO || row.poId || '-',
            materials,
            productQtyMap: toProductQtyMap(materials),
            totalQty: materials.reduce((sum, x) => sum + Number(x.quantity || 0), 0),
            raw: row,
          };
        });

        const nextCreditRows = creditDocs.map((row) => {
          const materials = normalizeItems(row.items || []);
          const kpi = row.kpi_id || row.kpiId || '-';
          return {
            id: `cn:${row.id}`,
            sourceType: 'CN',
            createdDate: formatDate(row),
            createdAtMs: toDateValue(row),
            docNumber: row.creditNoteNumber || `CN/${kpi}`,
            reference: kpi,
            materials,
            productQtyMap: toProductQtyMap(materials),
            totalQty: materials.reduce((sum, x) => sum + Number(x.quantity || 0), 0),
            raw: row,
          };
        });

        const nextDcRows = dcDocs.map((row) => {
          const materials = normalizeItems(row.items || []);
          const kpi = row.kpi_id || row.kpiId || '-';
          return {
            id: `dc:${row.id}`,
            sourceType: 'DC',
            createdDate: formatDate(row),
            createdAtMs: toDateValue(row),
            docNumber: row.dcNumber || row.id,
            reference: kpi,
            materials,
            productQtyMap: toProductQtyMap(materials),
            totalQty: materials.reduce((sum, x) => sum + Number(x.quantity || 0), 0),
            raw: row,
          };
        });

        const nextLedgerRows = ledgerDocs.map((row) => {
          const materials = normalizeLedgerItems(row);
          const refType = String(row.referenceType || '').toUpperCase();
          const explicitType = String(row.type || '').toLowerCase();
          const sourceType = refType.startsWith('GRN')
            ? 'GRN'
            : refType.startsWith('DC')
              ? 'DC'
              : refType.includes('CREDIT') || refType.startsWith('CN')
                ? 'CN'
                : explicitType === 'stockout'
                  ? 'OUT'
                  : 'IN';

          return {
            id: `ledger:${row.id}`,
            sourceType,
            createdDate: formatDate(row),
            createdAtMs: toDateValue(row),
            docNumber: row.referenceId || row.id,
            reference: row.referenceType || '-',
            materials,
            productQtyMap: toProductQtyMap(materials),
            totalQty: materials.reduce((sum, x) => sum + Number(x.quantity || 0), 0),
            movementType: explicitType,
            raw: row,
          };
        });

        setGrnRows(nextGrnRows);
        setCreditRows(nextCreditRows);
        setDcRows(nextDcRows);
        setLedgerRows(nextLedgerRows);
      } catch (err) {
        console.error('❌ Failed loading stock in/out data', err?.message || err);
      }
    };

    loadData();
    const timer = setInterval(loadData, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const hasLedger = ledgerRows.length > 0;

  const stockInRows = useMemo(() => {
    const rows = hasLedger
      ? ledgerRows.filter((r) => String(r.movementType || '').toLowerCase() === 'stockin')
      : [...grnRows, ...creditRows];
    return rows.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  }, [hasLedger, ledgerRows, grnRows, creditRows]);

  const stockOutRows = useMemo(() => {
    const rows = hasLedger
      ? ledgerRows.filter((r) => String(r.movementType || '').toLowerCase() === 'stockout')
      : [...dcRows];
    return rows.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  }, [hasLedger, ledgerRows, dcRows]);

  const currentRows = activeTab === 'stockin' ? stockInRows : stockOutRows;

  useEffect(() => {
    setPage(1);
  }, [activeTab, currentRows.length]);

  const totalPages = Math.max(1, Math.ceil(currentRows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = currentRows.slice(startIdx, startIdx + perPage);

  const productColumns = useMemo(() => {
    const set = new Set();
    currentRows.forEach((row) => {
      Object.keys(row.productQtyMap || {}).forEach((k) => set.add(k));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [currentRows]);

  useEffect(() => {
    if (!currentRows.length) {
      setSelectedId('');
      return;
    }
    if (selectedId && !currentRows.some((r) => r.id === selectedId)) {
      setSelectedId('');
    }
  }, [currentRows, selectedId]);

  const selectedRow = useMemo(() => currentRows.find((r) => r.id === selectedId) || null, [currentRows, selectedId]);

  const exportCurrent = () => {
    const baseHeaders = ['Created Date', 'Type', 'Reference Number', 'Reference', 'Total Quantity'];

    const headers = [...baseHeaders, ...productColumns];

    const rows = currentRows.map((row) => {
      const obj = {
        'Created Date': row.createdDate,
        Type: row.sourceType,
        'Reference Number': row.docNumber,
        Reference: row.reference,
        'Total Quantity': row.totalQty,
      };
      productColumns.forEach((p) => {
        obj[p] = Number(row.productQtyMap?.[p] || 0);
      });
      return obj;
    });

    const name = activeTab === 'stockin' ? 'stock-in-report.csv' : 'stock-out-report.csv';
    downloadCsv(name, headers, rows);
  };

  const resetAllInventoryData = async () => {
    if (!isAdmin) {
      window.alert('Only admin can reset all inventory data.');
      return;
    }

    const token = window.prompt('This will permanently delete stock in/out history and reset all available quantity to 0. Type RESET to continue.');
    if (token !== 'RESET') return;

    setResetting(true);
    try {
      await deleteCollectionInChunks('stockLedger');
      await deleteCollectionInChunks('records_grn');
      await deleteCollectionInChunks('deliveryChallans');
      await deleteCollectionInChunks('creditNotes');
      await deleteCollectionInChunks('grns');

      await updateCollectionInChunks('inventoryVariants', () => ({
        availableQuantity: 0,
        lastUpdatedAt: serverTimestamp(),
      }));

      await updateCollectionInChunks('purchaseOrders', () => ({
        grnReceivedByVariant: {},
        updatedAtMs: Date.now(),
      }));

      window.alert('Inventory reset complete. All stock movement records removed and available quantity set to 0.');
      setSelectedId('');
      setPage(1);
    } catch (err) {
      window.alert(`Reset failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedRow ? 'minmax(0, 1fr) minmax(360px, 42%)' : 'minmax(0, 1fr)', gap: 12 }}>
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottom: '1px solid #eee' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={activeTab === 'stockin' ? primaryBtn : secondaryBtn} onClick={() => setActiveTab('stockin')}>Stock In</button>
            <button style={activeTab === 'stockout' ? primaryBtn : secondaryBtn} onClick={() => setActiveTab('stockout')}>Stock Out</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin ? (
              <button style={dangerBtn} onClick={resetAllInventoryData} disabled={resetting}>
                {resetting ? 'Resetting...' : 'Reset All'}
              </button>
            ) : null}
            <button style={primaryBtn} onClick={exportCurrent}>Export</button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '72vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f8f8' }}>
                <th style={th}>Created Date</th>
                <th style={th}>Type</th>
                <th style={th}>Reference Number</th>
                <th style={th}>Reference</th>
                <th style={th}>Total Qty</th>
                {productColumns.map((name) => (
                  <th key={name} style={th}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  style={{ cursor: 'pointer', background: row.id === selectedId ? '#f5f9ff' : '#fff' }}
                >
                  <td style={td}>{row.createdDate}</td>
                  <td style={td}>{row.sourceType}</td>
                  <td style={td}>{row.docNumber}</td>
                  <td style={td}>{row.reference}</td>
                  <td style={td}>{Number(row.totalQty || 0)}</td>
                  {productColumns.map((name) => (
                    <td key={`${row.id}-${name}`} style={td}>{Number(row.productQtyMap?.[name] || 0)}</td>
                  ))}
                </tr>
              ))}
              {!currentRows.length && (
                <tr>
                  <td style={{ ...td, textAlign: 'center' }} colSpan={5 + productColumns.length}>
                    No {activeTab === 'stockin' ? 'stock-in' : 'stock-out'} records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, color: MAROON, flexWrap: 'wrap', gap: 10, padding: '0 12px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>
              {currentRows.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, currentRows.length)} of {currentRows.length}
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
      </div>

      {selectedRow ? (
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: 12, minHeight: 240 }}>
        {
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2d3d' }}>{selectedRow.docNumber}</div>
                <div style={{ marginTop: 4, color: '#666' }}>
                  {selectedRow.sourceType === 'GRN' ? 'Reference PO' : selectedRow.sourceType === 'CN' ? 'Reference KPI' : 'Reference KPI'}: {selectedRow.reference}
                </div>
                <div style={{ marginTop: 2, color: '#666' }}>Created Date: {selectedRow.createdDate}</div>
                <div style={{ marginTop: 2, color: '#666' }}>
                  Type: {selectedRow.sourceType}
                </div>
              </div>
              <button style={secondaryBtn} onClick={() => setSelectedId('')}>Close</button>
            </div>

            <div style={{ marginTop: 12, fontWeight: 700 }}>Materials</div>
            <div style={{ marginTop: 8, border: '1px solid #ececec', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={thSmall}>Product</th>
                    <th style={thSmall}>Variant</th>
                    <th style={thSmall}>Specification</th>
                    <th style={thSmall}>Quantity</th>
                    <th style={thSmall}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedRow.materials || []).map((item, idx) => (
                    <tr key={`${selectedRow.id}-${idx}`}>
                      <td style={tdSmall}>{item.productName}</td>
                      <td style={tdSmall}>{item.variantName}</td>
                      <td style={tdSmall}>{item.specification}</td>
                      <td style={tdSmall}>{Number(item.quantity || 0)}</td>
                      <td style={tdSmall}>{item.unit}</td>
                    </tr>
                  ))}
                  {!selectedRow.materials?.length && (
                    <tr>
                      <td style={{ ...tdSmall, textAlign: 'center' }} colSpan={5}>No material rows</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        }
      </div>
      ) : null}
    </div>
  );
};

const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ececec', whiteSpace: 'nowrap' };
const td = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #f3f3f3', whiteSpace: 'nowrap' };
const thSmall = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #ececec', whiteSpace: 'nowrap', fontSize: 13 };
const tdSmall = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #f5f5f5', whiteSpace: 'nowrap', fontSize: 13 };

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
  fontWeight: 600,
  cursor: 'pointer',
};

const dangerBtn = {
  height: 34,
  border: 'none',
  borderRadius: 6,
  padding: '0 12px',
  background: '#B00020',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

export default StockInOut;
