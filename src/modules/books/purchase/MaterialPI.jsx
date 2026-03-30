import React, { useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import UploadPI from './UploadPI';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';
const PRIVILEGED_ADMIN_UID = '26VHcREEDMMg8C24kXYVGzRXHe43';

const normalizeRole = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const MaterialPI = () => {
  const [loading, setLoading] = useState(true);
  const [pis, setPis] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [openUpload, setOpenUpload] = useState(false);
  const [role, setRole] = useState('');
  const [currentUserUid, setCurrentUserUid] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const isAdmin = normalizeRole(role) === 'admin' || String(currentUserUid || '') === PRIVILEGED_ADMIN_UID;

  useEffect(() => {
    const hydrateUser = async () => {
      let nextRole = '';
      let uid = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        nextRole = String(session?.profile?.role || session?.profile?.Role || session?.role || session?.Role || '');
        uid = String(session?.uid || session?.profile?.uid || session?.user?.uid || '');
      } catch {}
      if (!nextRole && auth.currentUser?.getIdTokenResult) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          nextRole = String(token?.claims?.role || token?.claims?.Role || '');
          uid = uid || String(token?.claims?.user_id || auth.currentUser?.uid || '');
        } catch {}
      }
      if (!nextRole && uid) {
        try {
          const snap = await getDoc(doc(db, 'Users', uid));
          if (snap.exists()) {
            nextRole = String(snap.data()?.role || snap.data()?.Role || '');
          }
        } catch (err) {
          console.error('❌ Failed to hydrate role from Users collection', err?.message || err);
        }
      }
      if (!uid && auth.currentUser?.uid) {
        uid = String(auth.currentUser.uid);
      }
      setCurrentUserUid(uid);
      setRole(nextRole);
    };
    hydrateUser();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [piList, vendorList] = await Promise.all([
          fetchCollectionDocs('pis', 3500, 0),
          fetchCollectionDocs('records_materialVendors', 3500, 0),
        ]);
        if (!mounted) return;
        piList.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        setPis(piList);
        setVendors(vendorList);
      } catch (err) {
        console.error('❌ Failed loading PI data', err?.message || err);
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

  const rows = useMemo(() => pis.map((pi) => {
    const createdDate = pi.createdAt?.toDate ? pi.createdAt.toDate().toISOString().slice(0, 10) : '-';
    return {
      ...pi,
      createdDate,
    };
  }), [pis]);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = rows.slice(startIdx, startIdx + perPage);

  const handleDelete = async (id) => {
    if (!isAdmin) return;
    if (!id) return;
    const previous = pis;
    setDeletingId(id);
    setPis((prev) => prev.filter((row) => row.id !== id));
    try {
      await deleteDoc(doc(db, 'pis', id));
    } catch (e) {
      setPis(previous);
      alert(e?.message || 'Delete failed');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) return <div>Loading PI...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <button style={primaryBtn} onClick={() => setOpenUpload(true)}>Upload PI</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f8' }}>
              <th style={th}>Created Date</th>
              <th style={th}>PI Number</th>
              <th style={th}>Vendor Name</th>
              <th style={th}>PI Amount</th>
              <th style={th}>Upload / View</th>
              <th style={th}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => (
              <tr key={row.id}>
                <td style={td}>{row.createdDate}</td>
                <td style={td}>{row.piNumber}</td>
                <td style={td}>{row.vendorName}</td>
                <td style={td}>{Number(row.piAmount || 0).toLocaleString('en-IN')}</td>
                <td style={td}>
                  {row.piPdfUrl ? (
                    <a href={row.piPdfUrl} target="_blank" rel="noreferrer">View PI</a>
                  ) : (
                    <span>-</span>
                  )}
                </td>
                <td style={td}>
                  <button style={dangerBtn} disabled={!isAdmin || deletingId === row.id} onClick={() => handleDelete(row.id)}>
                    {deletingId === row.id ? 'Deleting...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: 'center' }} colSpan={6}>No PI records yet</td>
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

      <UploadPI
        open={openUpload}
        onClose={() => setOpenUpload(false)}
        vendors={vendors}
        onUploaded={(newPi) => {
          setPis((prev) => {
            const next = [{ ...newPi }, ...prev.filter((r) => r.id !== newPi.id)];
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

export default MaterialPI;
