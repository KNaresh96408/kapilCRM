import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import './StockDashboard.css';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';

const readSpecLabel = (variant) => {
  const specs = variant?.specifications || {};
  const wp = specs?.wattPeak;
  const kw = specs?.kiloWatt ?? specs?.kw;
  const meters = specs?.lengthMeters ?? specs?.meters;
  if (wp !== undefined && wp !== null && String(wp) !== '') return `${wp}Wp`;
  if (kw !== undefined && kw !== null && String(kw) !== '') return `${kw}kW`;
  if (meters !== undefined && meters !== null && String(meters) !== '') return `${meters}m`;
  if (variant?.specification) return String(variant.specification);
  if (variant?.variantName) return String(variant.variantName);
  return '-';
};

const formatDateTime = (value) => {
  if (!value) return '-';
  try {
    if (value?.seconds) {
      return new Date(value.seconds * 1000).toLocaleString();
    }
    if (typeof value === 'number') {
      return new Date(value).toLocaleString();
    }
    const dt = new Date(value);
    if (!Number.isNaN(dt.getTime())) return dt.toLocaleString();
    return '-';
  } catch {
    return '-';
  }
};

const StockDashboard = () => {
  const [items, setItems] = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [brandFilterByProduct, setBrandFilterByProduct] = useState({});
  const [specFilterByProduct, setSpecFilterByProduct] = useState({});
  const [selectedProductId, setSelectedProductId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    setLoading(true);
    setError('');
    setWarning('');

    let mounted = true;

    const loadData = async () => {
      try {
        const [itemsList, variantsList] = await Promise.all([
          fetchCollectionDocs('inventoryItems'),
          fetchCollectionDocs('inventoryVariants'),
        ]);
        if (!mounted) return;
        setItems(itemsList || []);
        if (!itemsList?.length) {
          setWarning('inventoryItems unavailable. Using inventoryVariants data only.');
        }
        setVariants(variantsList || []);
        setError('');
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || 'Failed to load inventory variants');
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

  const products = useMemo(() => {
    const itemByProductId = new Map();
    for (const item of items) {
      const pid = String(item.productId || item.id || '').trim();
      if (!pid) continue;
      itemByProductId.set(pid, {
        productId: pid,
        productName: item.productName || item.name || 'Product',
        category: item.category || '-',
      });
    }

    const grouped = new Map();
    for (const variant of variants) {
      const pid = String(variant.productId || '').trim();
      if (!pid) continue;
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid).push(variant);

      if (!itemByProductId.has(pid)) {
        itemByProductId.set(pid, {
          productId: pid,
          productName: variant.productName || variant.product_name || 'Product',
          category: '-',
        });
      }
    }

    const rows = [];
    for (const [productId, item] of itemByProductId.entries()) {
      const productVariants = grouped.get(productId) || [];
      const brandOptions = Array.from(
        new Set(productVariants.map((v) => String(v.brandName || v.brand_name || '-')))
      ).filter(Boolean);

      const specOptions = Array.from(
        new Set(productVariants.map((v) => readSpecLabel(v)))
      ).filter(Boolean);

      rows.push({
        ...item,
        variants: productVariants,
        brandOptions: brandOptions.sort((a, b) => a.localeCompare(b)),
        specOptions: specOptions.sort((a, b) => a.localeCompare(b)),
      });
    }

    rows.sort((a, b) => String(a.productName || '').localeCompare(String(b.productName || '')));
    return rows;
  }, [items, variants]);

  const productCards = useMemo(() => {
    return products.map((product) => {
      const selectedBrand = brandFilterByProduct[product.productId] || '';
      const selectedSpec = specFilterByProduct[product.productId] || '';

      const scoped = product.variants.filter((v) => {
        const brand = String(v.brandName || v.brand_name || '-');
        const spec = readSpecLabel(v);
        if (selectedBrand && brand !== selectedBrand) return false;
        if (selectedSpec && spec !== selectedSpec) return false;
        return true;
      });

      const totalQuantity = scoped.reduce((sum, v) => sum + Number(v.availableQuantity || 0), 0);
      const firstUnit = scoped[0]?.unit || product.variants[0]?.unit || 'Nos';

      return {
        ...product,
        selectedBrand,
        selectedSpec,
        scoped,
        totalQuantity,
        unit: firstUnit,
      };
    });
  }, [products, brandFilterByProduct, specFilterByProduct]);

  const tableRows = useMemo(() => {
    const rows = [];
    const scopedCards = selectedProductId
      ? productCards.filter((card) => String(card.productId) === String(selectedProductId))
      : productCards;

    for (const card of scopedCards) {
      for (const v of card.scoped) {
        rows.push({
          id: v.id,
          productId: card.productId,
          productName: card.productName || v.productName || '-',
          brandName: v.brandName || v.brand_name || '-',
          specification: readSpecLabel(v),
          availableQuantity: Number(v.availableQuantity || 0),
          unit: v.unit || 'Nos',
          lastUpdatedAt: v.lastUpdatedAt || v.updatedAt || v.createdAt || v.createdAtMs || null,
        });
      }
    }
    return rows.sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
  }, [productCards, selectedProductId]);

  useEffect(() => {
    setPage(1);
  }, [selectedProductId, tableRows.length]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = tableRows.slice(startIdx, startIdx + perPage);

  if (loading) {
    return (
      <div className="stock-wrap">
        <div className="stock-spinner" />
        <div className="stock-muted">Loading stock dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stock-wrap">
        <div className="stock-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="stock-wrap">
      <h3 className="stock-title">Stock Dashboard</h3>

      {warning ? <div className="stock-warning">{warning}</div> : null}

      <div className="kpi-grid">
        {productCards.map((card) => (
          <div
            key={card.productId}
            className={`kpi-card ${selectedProductId === card.productId ? 'kpi-card-active' : ''}`}
            onClick={() => setSelectedProductId(card.productId)}
          >
            <div className="kpi-product">{card.productName}</div>
            <div className="kpi-stock">Total Stock: {card.totalQuantity.toLocaleString('en-IN')} {card.unit}</div>

            <label className="stock-label">Brand Filter</label>
            <select
              className="stock-select"
              value={card.selectedBrand}
              onChange={(e) => setBrandFilterByProduct((prev) => ({ ...prev, [card.productId]: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">All Brands</option>
              {card.brandOptions.map((brand) => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>

            <label className="stock-label">Specification Filter</label>
            <select
              className="stock-select"
              value={card.selectedSpec}
              onChange={(e) => setSpecFilterByProduct((prev) => ({ ...prev, [card.productId]: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">All Specifications</option>
              {card.specOptions.map((spec) => (
                <option key={spec} value={spec}>{spec}</option>
              ))}
            </select>
          </div>
        ))}

        {!productCards.length && <div className="stock-muted">No products found.</div>}
      </div>

      <div className="table-wrap">
        <div className="table-title-row">
          <h4 className="table-title">Stock Table View</h4>
          {selectedProductId ? (
            <button className="stock-clear-btn" onClick={() => setSelectedProductId('')}>Show All Products</button>
          ) : null}
        </div>
        <div className="table-scroll">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Brand</th>
                <th>Specification</th>
                <th>Available Quantity</th>
                <th>Unit</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.productName}</td>
                  <td>{row.brandName}</td>
                  <td>{row.specification}</td>
                  <td>{row.availableQuantity.toLocaleString('en-IN')}</td>
                  <td>{row.unit}</td>
                  <td>{formatDateTime(row.lastUpdatedAt)}</td>
                </tr>
              ))}
              {!tableRows.length && (
                <tr>
                  <td colSpan={6} className="stock-empty">No stock rows for selected filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: MAROON, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>
              {tableRows.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, tableRows.length)} of {tableRows.length}
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
    </div>
  );
};

export default StockDashboard;
