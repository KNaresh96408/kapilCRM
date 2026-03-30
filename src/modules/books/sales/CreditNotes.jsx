import React, { useEffect, useState } from 'react';
import { auth, db } from '../../../firebaseConfig';
import { doc, runTransaction } from 'firebase/firestore';
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

const CreditNotes = () => {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterKpi, setFilterKpi] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [currentUser, setCurrentUser] = useState({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const isAdmin = normalizeRole(currentUser?.role) === 'admin' || String(currentUser?.uid || '') === ADMIN_UID;

  const normalize = (v) => String(v || '').trim().toLowerCase();

  const formatDate = (value) => {
    if (!value) return '';
    const dt = value?.toDate ? value.toDate() : new Date(value);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleString();
  };

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
    const fetchNotes = async () => {
      setLoading(true);
      try {
        let rows = await fetchCollectionDocs('creditNotes');
        rows = Array.isArray(rows) ? rows : [];

        if (filterKpi) {
          const needle = normalize(filterKpi);
          rows = rows.filter((r) => normalize(r.kpi_id || r.kpiId).includes(needle));
        }

        if (filterDate) {
          const selected = new Date(filterDate);
          const y = selected.getFullYear();
          const m = selected.getMonth();
          const d = selected.getDate();
          rows = rows.filter((r) => {
            const raw = r.createdAt || r.created_at || r.updatedAt || r.updated_at;
            if (!raw) return false;
            const dt = raw?.toDate ? raw.toDate() : new Date(raw);
            if (isNaN(dt.getTime())) return false;
            return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
          });
        }

        rows.sort((a, b) => {
          const ad = a.updatedAt?.toDate ? a.updatedAt.toDate() : a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.updatedAt || a.createdAt || 0);
          const bd = b.updatedAt?.toDate ? b.updatedAt.toDate() : b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.updatedAt || b.createdAt || 0);
          return bd - ad;
        });

        setNotes(rows);
      } catch {
        setNotes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchNotes();
  }, [filterKpi, filterDate]);

  useEffect(() => {
    setPage(1);
  }, [filterKpi, filterDate]);

  const totalPages = Math.max(1, Math.ceil(notes.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedNotes = notes.slice(startIdx, startIdx + perPage);

  const handleDelete = async (note) => {
    setDeleting(true);
    try {
      await runTransaction(db, async (transaction) => {
        transaction.delete(doc(db, 'creditNotes', note.id));
      });
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setConfirmDeleteId(null);
    } catch (err) {
      alert('Failed to delete Credit Note: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Credit Notes</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <input
          type="text"
          placeholder="Filter by KPI-ID"
          value={filterKpi}
          onChange={(e) => setFilterKpi(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: '1px solid #800000' }}
        />
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: '1px solid #800000' }}
        />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Created At</th>
            <th>KPI-ID</th>
            <th>Customer Name</th>
            <th>Credit Note Number</th>
            <th>View Credit Note</th>
            {isAdmin && <th>Delete</th>}
          </tr>
        </thead>
        <tbody>
          {pagedNotes.map((note) => (
            <tr key={note.id}>
              <td>{formatDate(note.createdAt || note.created_at || note.updatedAt || note.updated_at)}</td>
              <td>{note.kpi_id || note.kpiId}</td>
              <td>{note.customerName}</td>
              <td>{note.creditNoteNumber}</td>
              <td>
                {note.creditNotePdfUrl ? (
                  <a href={note.creditNotePdfUrl} target="_blank" rel="noopener noreferrer"><button style={viewBtn}>View Credit Note</button></a>
                ) : String(note.status || '').toLowerCase() === 'pdf_failed' ? (
                  <span style={{ color: '#b00', fontWeight: 600 }}>PDF failed</span>
                ) : (
                  <span>Generating PDF...</span>
                )}
              </td>
              {isAdmin && (
                <td>
                  <button
                    style={{ background: '#b00', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px' }}
                    onClick={() => setConfirmDeleteId(note.id)}
                    disabled={deleting}
                  >
                    Delete
                  </button>
                  {confirmDeleteId === note.id && (
                    <div style={{ position: 'absolute', background: '#fff', border: '1px solid #800000', padding: 12, zIndex: 10 }}>
                      <div>Are you sure you want to delete this Credit Note?</div>
                      <button onClick={() => handleDelete(note)} disabled={deleting} style={{ marginRight: 8 }}>Yes</button>
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
            {notes.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, notes.length)} of {notes.length}
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

export default CreditNotes;
