import React, { useEffect, useState } from 'react';
import { runTransaction, doc } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const viewBtn = {
  backgroundColor: '#8B0000',
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

const Invoices = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterKpi, setFilterKpi] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [currentUser, setCurrentUser] = useState({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const isAdmin = normalizeRole(currentUser?.role) === 'admin' || String(currentUser?.uid || '') === ADMIN_UID;

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
    const fetchInvoices = async () => {
      setLoading(true);
      try {
        let rows = await fetchCollectionDocs('invoices');
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

        setInvoices(rows);
      } catch {
        setInvoices([]);
      } finally {
        setLoading(false);
      }
    };
    fetchInvoices();
  }, [filterKpi, filterDate]);

  const handleDelete = async (inv) => {
    setDeleting(true);
    try {
      await runTransaction(db, async (transaction) => {
        // Only delete invoice document
        transaction.delete(doc(db, 'invoices', inv.id));
      });
      setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
      setConfirmDeleteId(null);
    } catch (err) {
      alert('Failed to delete Invoice: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  const totalPages = Math.max(1, Math.ceil(invoices.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedInvoices = invoices.slice(startIdx, startIdx + perPage);

  return (
    <div>
      <h2>Invoices</h2>
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
            <th>Invoice Number</th>
            <th>Invoice Amount</th>
            <th>View Invoice</th>
            {isAdmin && <th>Delete</th>}
          </tr>
        </thead>
        <tbody>
          {pagedInvoices.map(inv => (
            <tr key={inv.id}>
              <td>{formatDate(inv.createdAt || inv.created_at || inv.date)}</td>
              <td>{inv.kpi_id}</td>
              <td>{inv.customerName}</td>
              <td>{inv.invoiceNumber}</td>
              <td>{inv.invoice_amount}</td>
              <td>
                {inv.invoicePdfUrl ? (
                  <a href={inv.invoicePdfUrl} target="_blank" rel="noopener noreferrer"><button style={viewBtn}>View Invoice</button></a>
                ) : (
                  <span>Generating PDF...</span>
                )}
              </td>
              {isAdmin && (
                <td>
                  <button
                    style={{ background: '#b00', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px' }}
                    onClick={() => setConfirmDeleteId(inv.id)}
                    disabled={deleting}
                  >
                    Delete
                  </button>
                  {confirmDeleteId === inv.id && (
                    <div style={{ position: 'absolute', background: '#fff', border: '1px solid #800000', padding: 12, zIndex: 10 }}>
                      <div>Are you sure you want to delete this Invoice?</div>
                      <button onClick={() => handleDelete(inv)} disabled={deleting} style={{ marginRight: 8 }}>Yes</button>
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
            {invoices.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, invoices.length)} of {invoices.length}
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

export default Invoices;
