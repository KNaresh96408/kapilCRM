import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerDetailsDCModal from './CustomerDetailsDCModal';
import { createAndUploadInvoice } from './createAndUploadInvoice';
import CustomerDetailsCreditNoteModal from './CustomerDetailsCreditNoteModal';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const SALES_ORDER_THRESHOLD = 40;

const getPaymentReceived = (order) => {
  const payments = [
    order?.firstPayment,
    order?.first_payment,
    order?.secondPayment,
    order?.second_payment,
    order?.thirdPayment,
    order?.third_payment,
    order?.fourthPayment,
    order?.fourth_payment,
  ];

  return payments.reduce((sum, p) => {
    const value = Number(p || 0);
    return sum + (Number.isNaN(value) ? 0 : value);
  }, 0);
};

const getPaymentPercentage = (order) => {
  const directPct = Number(order?.paymentPercentage || order?.payment_percentage || 0);
  if (directPct > 0) return directPct;

  const invoiceAmount = Number(order?.invoice_amount ?? order?.invoiceAmount ?? 0);
  if (invoiceAmount <= 0) return 0;

  const received = getPaymentReceived(order);
  return (received / invoiceAmount) * 100;
};

const runInBackground = (task) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 250 });
    return;
  }
  setTimeout(() => task(), 0);
};

const CustomerDetails = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dcModalOpen, setDCModalOpen] = useState(false);
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [dcCreated, setDCCreated] = useState({});
  const [dcKpiSet, setDcKpiSet] = useState(new Set());
  const [invoiceKpiSet, setInvoiceKpiSet] = useState(new Set());
  const [creditNoteKpiSet, setCreditNoteKpiSet] = useState(new Set());
  const [filterKpi, setFilterKpi] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [creatingInvoiceId, setCreatingInvoiceId] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [ordersRows, dcRows, invRows, cnRows] = await Promise.all([
          fetchCollectionDocs('salesOrders', 2500, 0),
          fetchCollectionDocs('deliveryChallans', 2500, 0),
          fetchCollectionDocs('invoices', 2500, 0),
          fetchCollectionDocs('creditNotes', 2500, 0),
        ]);

        let rows = Array.isArray(ordersRows) ? [...ordersRows] : [];

        // Customer Details should only show Salesorders bucket (>=40% received)
        rows = rows.filter((o) => Number(getPaymentPercentage(o) || 0) >= SALES_ORDER_THRESHOLD);

        if (filterKpi) {
          const needle = filterKpi.toLowerCase();
          rows = rows.filter((o) => {
            const kpi = String(o.kpi_id || o.kpiId || '').toLowerCase();
            return kpi.includes(needle);
          });
        }

        if (filterDate) {
          const selected = new Date(filterDate);
          const y = selected.getFullYear();
          const m = selected.getMonth();
          const d = selected.getDate();

          rows = rows.filter((o) => {
            const raw = o.createdAt || o.created_at || o.updatedAt || o.updated_at || null;
            if (!raw) return false;
            const dt = raw?.toDate ? raw.toDate() : new Date(raw);
            if (isNaN(dt.getTime())) return false;
            return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
          });
        }

        setOrders(rows);
        setDcKpiSet(new Set(
          (dcRows || [])
            .map((row) => String(row.kpi_id || row.kpiId || '').trim().toLowerCase())
            .filter(Boolean)
        ));
        setInvoiceKpiSet(new Set(
          (invRows || [])
            .map((row) => String(row.kpi_id || row.kpiId || '').trim().toLowerCase())
            .filter(Boolean)
        ));
        setCreditNoteKpiSet(new Set(
          (cnRows || [])
            .map((row) => String(row.kpi_id || row.kpiId || '').trim().toLowerCase())
            .filter(Boolean)
        ));
      } catch (err) {
        setOrders([]);
        setDcKpiSet(new Set());
        setInvoiceKpiSet(new Set());
        setCreditNoteKpiSet(new Set());
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [filterKpi, filterDate]);

  const handleOpenDCModal = (order) => {
    setSelectedOrder(order);
    setDCModalOpen(true);
  };
  const handleCloseDCModal = () => {
    setDCModalOpen(false);
    setSelectedOrder(null);
  };
  const handleDCSuccess = (created = null) => {
    if (selectedOrder?.id) {
      setDCCreated((prev) => ({ ...prev, [selectedOrder.id]: true }));
    }
    const normalizedKpi = String(created?.kpi_id || created?.kpiId || selectedOrder?.kpi_id || selectedOrder?.kpiId || '').trim().toLowerCase();
    if (normalizedKpi) {
      setDcKpiSet((prev) => {
        const next = new Set(prev);
        next.add(normalizedKpi);
        return next;
      });
    }
  };

  const handleOpenCreditNoteModal = (order) => {
    setSelectedOrder(order);
    setCreditNoteModalOpen(true);
  };

  const handleCloseCreditNoteModal = () => {
    setCreditNoteModalOpen(false);
    setSelectedOrder(null);
  };

  const handleCreditNoteSuccess = (created = null) => {
    const normalizedKpi = String(created?.kpi_id || created?.kpiId || selectedOrder?.kpi_id || selectedOrder?.kpiId || '').trim().toLowerCase();
    setCreditNoteKpiSet((prev) => {
      const next = new Set(prev);
      if (normalizedKpi) next.add(normalizedKpi);
      return next;
    });
  };

  const handleCreateInvoice = async (order) => {
    const normalizedKpi = String(order.kpi_id || order.kpiId || '').trim().toLowerCase();
    setInvoiceKpiSet((prev) => {
      const next = new Set(prev);
      if (normalizedKpi) next.add(normalizedKpi);
      return next;
    });

    try {
      setCreatingInvoiceId(order.id);
      navigate('/books/sales/invoices');
      runInBackground(() => {
        createAndUploadInvoice(order).catch((err) => {
          alert(err?.message || 'Failed to create invoice');
        });
      });
    } catch (err) {
      alert(err?.message || 'Failed to create invoice');
    } finally {
      setCreatingInvoiceId(null);
    }
  };

  if (loading) return <div>Loading...</div>;

  const totalPages = Math.max(1, Math.ceil(orders.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedOrders = orders.slice(startIdx, startIdx + perPage);

  return (
    <div style={{ paddingLeft: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 8 }}>
        <h2 style={{ color: '#800000', fontWeight: 700, marginBottom: 0 }}>Customer Details</h2>
        <button style={{ background: '#800000', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 24px', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}>Export</button>
      </div>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
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
      <div style={{ height: 8 }} />
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
        <thead>
          <tr style={{ background: '#800000' }}>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>KPI-ID</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Customer Name</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Contact Number</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Address</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Sales Zone</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Sales Area</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Invoice Amount</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Payment Received</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Pending Amount</th>
            <th style={{ color: '#fff', fontWeight: 700, padding: '12px 8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pagedOrders.map(order => {
            const paymentReceived = getPaymentReceived(order);
            const invoiceAmount = Number(order.invoice_amount ?? order.invoiceAmount ?? 0);
            const pendingAmount = invoiceAmount - paymentReceived;
            const rowKpiId = order.kpi_id || order.kpiId || '';
            const rowCustomerName =
              order.customer_name ||
              order.customerName ||
              order.customer ||
              order.clientName ||
              order.accountName ||
              order.name ||
              '';
            const rowContact =
              order.contact_number ||
              order.contactNumber ||
              order.customerPhone ||
              order.phone ||
              order.mobile ||
              '';
            const rowAddress = order.address || order.location || '';
            const rowZone = order.sales_zone || order.salesZone || '';
            const rowArea = order.sales_area || order.salesArea || '';
            // Button logic using normalized KPI + local DC creation state
            const normalizedKpi = String(rowKpiId || '').trim().toLowerCase();
            const hasDC = dcKpiSet.has(normalizedKpi) || !!dcCreated[order.id];
            const hasInvoice = invoiceKpiSet.has(normalizedKpi);
            const hasCreditNote = creditNoteKpiSet.has(normalizedKpi);
            const dcDisabled = false;
            const invoiceDisabled = !hasDC || hasInvoice;
            const creditNoteDisabled = !hasInvoice;
            return (
              <tr key={order.id}>
                <td>{rowKpiId}</td>
                <td>{rowCustomerName}</td>
                <td>{rowContact}</td>
                <td>{rowAddress}</td>
                <td>{rowZone}</td>
                <td>{rowArea}</td>
                <td>{invoiceAmount}</td>
                <td>{paymentReceived}</td>
                <td>{pendingAmount}</td>
                <td style={{ minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                    <button
                    onClick={() => handleOpenDCModal(order)}
                    disabled={dcDisabled}
                    style={{
                      background: dcDisabled ? '#ccc' : '#800000',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 10px',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: dcDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Create DC
                  </button>
                    <button
                    onClick={() => handleCreateInvoice(order)}
                    disabled={invoiceDisabled}
                    style={{
                      background: invoiceDisabled ? '#ccc' : '#800000',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 10px',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: invoiceDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {creatingInvoiceId === order.id ? 'Creating...' : 'Create Invoice'}
                  </button>
                    <button
                    onClick={() => handleOpenCreditNoteModal(order)}
                    disabled={creditNoteDisabled}
                    style={{
                      background: creditNoteDisabled ? '#ccc' : '#800000',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 10px',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: creditNoteDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Credit Notes
                  </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: '#800000', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {orders.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, orders.length)} of {orders.length}
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
      <CustomerDetailsDCModal
        open={dcModalOpen}
        onClose={handleCloseDCModal}
        salesOrder={selectedOrder}
        onSuccess={handleDCSuccess}
      />
      <CustomerDetailsCreditNoteModal
        open={creditNoteModalOpen}
        onClose={handleCloseCreditNoteModal}
        salesOrder={selectedOrder}
        onSuccess={handleCreditNoteSuccess}
      />
    </div>
  );
};

export default CustomerDetails;
