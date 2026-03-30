import React, { useEffect, useState } from 'react';
import { runTransaction, doc, collection as fbCollection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../../../firebaseConfig';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const viewBtn = {
  background: '#8B0000',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontWeight: 600,
  cursor: 'pointer',
};

const ADMIN_UID = "26VHcREEDMMg8C24kXYVGzRXHe43";

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const extractRoleFromSession = (session = {}) => {
  return (
    session?.profile?.role ||
    session?.profile?.Role ||
    session?.role ||
    session?.Role ||
    session?.user?.role ||
    session?.user?.Role ||
    ""
  );
};


const DeliveryChallans = () => {
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterKpi, setFilterKpi] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [ewayFiles, setEwayFiles] = useState({});
  const [uploadingEwayId, setUploadingEwayId] = useState('');
  const [currentUser, setCurrentUser] = useState({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const isAdmin = normalizeRole(currentUser?.role) === 'admin' || String(currentUser?.uid || '') === ADMIN_UID;

  useEffect(() => {
    const fetchUser = async () => {
      const user = auth.currentUser;
      let role = '';
      let uid = user?.uid || '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = extractRoleFromSession(session);
        uid = uid || session?.uid || session?.profile?.uid || '';
      } catch {}

      if (!role && user?.getIdTokenResult) {
        try {
          const token = await user.getIdTokenResult();
          role = token?.claims?.role || '';
        } catch {}
      }

      setCurrentUser({ role: normalizeRole(role), uid });
    };
    fetchUser();
  }, []);

  useEffect(() => {
    const fetchChallans = async () => {
      setLoading(true);
      try {
        let rows = await fetchCollectionDocs('deliveryChallans');
        rows = Array.isArray(rows) ? rows : [];

        if (filterKpi) {
          const needle = filterKpi.toLowerCase();
          rows = rows.filter((r) => String(r.kpi_id || r.kpiId || '').toLowerCase().includes(needle));
        }

        if (filterDate) {
          const selected = new Date(filterDate);
          const y = selected.getFullYear();
          const m = selected.getMonth();
          const d = selected.getDate();
          rows = rows.filter((r) => {
            const raw = r.createdAt || r.created_at;
            if (!raw) return false;
            const dt = raw?.toDate ? raw.toDate() : new Date(raw);
            if (isNaN(dt.getTime())) return false;
            return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
          });
        }

        rows.sort((a, b) => {
          const ad = (a.createdAt || a.created_at)?.toDate ? (a.createdAt || a.created_at).toDate() : new Date(a.createdAt || a.created_at || 0);
          const bd = (b.createdAt || b.created_at)?.toDate ? (b.createdAt || b.created_at).toDate() : new Date(b.createdAt || b.created_at || 0);
          return bd - ad;
        });

        setChallans(rows);
      } catch {
        setChallans([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChallans();
  }, [filterKpi, filterDate]);

  const handleDelete = async (dc) => {
    setDeleting(true);
    try {
      await runTransaction(db, async (transaction) => {
        const qtyByVariant = new Map();
        for (const item of dc.items || []) {
          const variantId = String(item?.variantId || '').trim();
          if (!variantId) continue;
          const qty = Number(item?.quantity || 0);
          if (qty <= 0) continue;
          qtyByVariant.set(variantId, Number(qtyByVariant.get(variantId) || 0) + qty);
        }

        // Firestore transactions require all reads before writes.
        const availableByVariant = new Map();
        for (const [variantId] of qtyByVariant) {
          const variantRef = doc(db, 'inventoryVariants', variantId);
          const variantSnap = await transaction.get(variantRef);
          if (!variantSnap.exists()) throw new Error(`Variant not found: ${variantId}`);
          availableByVariant.set(variantId, Number(variantSnap.data().availableQuantity || 0));
        }

        // 1. Reverse stock movement
        for (const [variantId, qty] of qtyByVariant) {
          const variantRef = doc(db, 'inventoryVariants', variantId);
          const prevQty = Number(availableByVariant.get(variantId) || 0);
          transaction.update(variantRef, {
            availableQuantity: prevQty + qty,
          });
        }

        // 2. Add stockLedger entry
        const ledgerRef = doc(fbCollection(db, 'stockLedger'));
        transaction.set(ledgerRef, {
          type: 'stockIN',
          referenceType: 'DC_DELETE',
          referenceId: dc.dcNumber,
          items: dc.items || [],
          createdAt: serverTimestamp(),
        });

        // 3. Delete deliveryChallans document
        transaction.delete(doc(db, 'deliveryChallans', dc.id));
      });
      setChallans((prev) => prev.filter((c) => c.id !== dc.id));
      setConfirmDeleteId(null);
    } catch (err) {
      alert('Failed to delete DC: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleEwayFileChange = (dcId, file) => {
    setEwayFiles((prev) => ({ ...prev, [dcId]: file || null }));
  };

  const handleUploadEwayBill = async (dc) => {
    const file = ewayFiles[dc.id];
    if (!file) {
      alert('Please choose an E-way Bill file first');
      return;
    }

    const fileName = String(file.name || 'eway-bill').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `deliveryChallans/eWayBills/${dc.id}/${Date.now()}_${fileName}`;

    setUploadingEwayId(dc.id);
    try {
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, file, { contentType: file.type || undefined });
      const eWayBillUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, 'deliveryChallans', dc.id), {
        eWayBillUrl,
        eWayBillFileName: file.name || '',
        eWayBillContentType: file.type || '',
        eWayBillUploadedAt: serverTimestamp(),
      });

      setChallans((prev) => prev.map((row) => (
        row.id === dc.id
          ? {
              ...row,
              eWayBillUrl,
              eWayBillFileName: file.name || '',
              eWayBillContentType: file.type || '',
            }
          : row
      )));
      setEwayFiles((prev) => ({ ...prev, [dc.id]: null }));
    } catch (err) {
      alert(`Failed to upload E-way Bill: ${err?.message || 'Unknown error'}`);
    } finally {
      setUploadingEwayId('');
    }
  };

  if (loading) return <div>Loading...</div>;

  const totalPages = Math.max(1, Math.ceil(challans.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedChallans = challans.slice(startIdx, startIdx + perPage);

  return (
    <div>
      <h2>Delivery Challans</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <input
          type="text"
          placeholder="Filter by KPI-ID"
          value={filterKpi}
          onChange={e => setFilterKpi(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: '1px solid #800000' }}
        />
        <input
          type="date"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: '1px solid #800000' }}
        />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Created At</th>
            <th>KPI-ID</th>
            <th>Customer Name</th>
            <th>Sales Zone</th>
            <th>DC Number</th>
            <th>View DC</th>
            <th>E-way Bill</th>
            {isAdmin && <th>Delete</th>}
          </tr>
        </thead>
        <tbody>
          {pagedChallans.map(dc => (
            <tr key={dc.id}>
              <td>{dc.createdAt?.toDate ? dc.createdAt.toDate().toLocaleString() : ''}</td>
              <td>{dc.kpi_id}</td>
              <td>{dc.customerName}</td>
              <td>{dc.sales_zone}</td>
              <td>{dc.dcNumber}</td>
              <td>
                {dc.dcPdfUrl ? (
                  <a href={dc.dcPdfUrl} target="_blank" rel="noopener noreferrer"><button style={viewBtn}>View DC</button></a>
                ) : String(dc.status || "").toLowerCase() === 'pdf_failed' ? (
                  <span style={{ color: '#b00', fontWeight: 600 }}>PDF failed</span>
                ) : (
                  <span>Generating PDF...</span>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {dc.eWayBillUrl ? (
                    <a href={dc.eWayBillUrl} target="_blank" rel="noopener noreferrer">
                      <button style={{ ...viewBtn, padding: '6px 10px', fontSize: 13 }}>View</button>
                    </a>
                  ) : (
                    <span style={{ color: '#555', fontSize: 13 }}>No E-way Bill</span>
                  )}

                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => handleEwayFileChange(dc.id, e.target.files?.[0])}
                    style={{ maxWidth: 160 }}
                  />
                  <button
                    style={{ ...viewBtn, padding: '6px 10px', fontSize: 13, opacity: uploadingEwayId === dc.id ? 0.8 : 1 }}
                    onClick={() => handleUploadEwayBill(dc)}
                    disabled={uploadingEwayId === dc.id}
                  >
                    {uploadingEwayId === dc.id ? 'Uploading...' : (dc.eWayBillUrl ? 'Replace' : 'Upload')}
                  </button>
                </div>
              </td>
              {isAdmin && (
                <td>
                  <button
                    style={{ background: '#b00', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px' }}
                    onClick={() => setConfirmDeleteId(dc.id)}
                    disabled={deleting}
                  >
                    Delete
                  </button>
                  {confirmDeleteId === dc.id && (
                    <div style={{ position: 'absolute', background: '#fff', border: '1px solid #800000', padding: 12, zIndex: 10 }}>
                      <div>Are you sure you want to delete this DC?</div>
                      <button onClick={() => handleDelete(dc)} disabled={deleting} style={{ marginRight: 8 }}>Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} disabled={deleting}>No</button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: '#800000', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {challans.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, challans.length)} of {challans.length}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Records per page</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
              style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid #800000', color: '#800000' }}
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
            style={{ background: '#fff', border: '1px solid #800000', color: '#800000', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Prev
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{ background: '#fff', border: '1px solid #800000', color: '#800000', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryChallans;
