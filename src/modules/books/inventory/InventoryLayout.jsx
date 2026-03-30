import React, { useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';
import { extractRoleFromSession, normalizeRole } from '../purchase/purchaseHelpers';
import StockDashboard from './StockDashboard';
import StockInOut from './StockInOut';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const MAROON = '#8B0000';

const inferSpecType = (productName = '', unit = '', specs = {}) => {
  if (specs?.wattPeak != null) return 'wp';
  if (specs?.kiloWatt != null || specs?.kw != null) return 'kw';
  if (specs?.lengthMeters != null || specs?.meters != null) return 'm';
  const name = String(productName || '').toLowerCase();
  const u = String(unit || '').toLowerCase();
  if (name.includes('inverter')) return 'kw';
  if (name.includes('module') || name.includes('solar')) return 'wp';
  if (name.includes('cable') || name.includes('wire') || u === 'm' || u === 'meter' || u === 'meters') return 'm';
  return 'none';
};

const formatSpec = (variant) => {
  const specs = variant?.specifications || {};
  const type = inferSpecType(variant?.productName, variant?.unit, specs);
  const val = Number(
    specs?.wattPeak ?? specs?.kiloWatt ?? specs?.kw ?? specs?.lengthMeters ?? specs?.meters ?? 0
  );
  if (!val || type === 'none') return '-';
  if (type === 'kw') return `${val}kW`;
  if (type === 'm') return `${val}m`;
  return `${val}Wp`;
};

const suggestSpecTypeFromName = (name = '') => {
  const n = String(name || '').toLowerCase();
  if (n.includes('inverter')) return 'kw';
  if (n.includes('module') || n.includes('solar panel') || n.includes('panel')) return 'wp';
  if (n.includes('cable') || n.includes('wire')) return 'm';
  return 'none';
};

const InventoryLayout = () => {
  const [activeMenu, setActiveMenu] = useState('products');
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [openAdd, setOpenAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingVariant, setSavingVariant] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [addBrandMode, setAddBrandMode] = useState('new_brand');
  const [form, setForm] = useState({
    productName: '',
    brandName: '',
    specType: 'wp',
    specValue: '',
    unit: 'Nos',
    defaultPrice: '',
  });
  const [variantForm, setVariantForm] = useState({
    brandName: '',
    existingBrand: '',
    specType: 'wp',
    specValue: '',
    unit: 'Nos',
    defaultPrice: '',
  });

  const isAdmin = normalizeRole(currentUserRole) === 'admin';

  React.useEffect(() => {
    const hydrateUser = async () => {
      let role = '';
      try {
        const session = JSON.parse(localStorage.getItem('kp-user') || '{}');
        role = extractRoleFromSession(session);
      } catch {}
      if (!role && auth.currentUser?.getIdTokenResult) {
        try {
          const token = await auth.currentUser.getIdTokenResult();
          role = normalizeRole(token?.claims?.role || token?.claims?.Role || '');
        } catch {}
      }
      if (!role && auth.currentUser?.uid) {
        try {
          const snap = await getDoc(doc(db, 'Users', auth.currentUser.uid));
          if (snap.exists()) role = normalizeRole(snap.data()?.role || snap.data()?.Role || '');
        } catch {}
      }
      setCurrentUserRole(role);
    };
    hydrateUser();
  }, []);

  React.useEffect(() => {
    const suggested = suggestSpecTypeFromName(form.productName);
    setForm((prev) => (prev.specType === suggested ? prev : { ...prev, specType: suggested, specValue: '' }));
  }, [form.productName]);

  React.useEffect(() => {
    if (!selectedProductId) return;
    const selected = rows.find((r) => String(r.productId || '') === String(selectedProductId));
    if (!selected?.productName) return;
    const suggested = suggestSpecTypeFromName(selected.productName);
    setVariantForm((prev) => (prev.specType === suggested ? prev : { ...prev, specType: suggested, specValue: '' }));
  }, [selectedProductId, rows]);

  React.useEffect(() => {
    let mounted = true;

    const loadVariants = async () => {
      try {
        const docs = await fetchCollectionDocs('inventoryVariants');
        if (!mounted) return;
        const list = docs.map((v) => ({
          id: v.id,
          ...v,
          productId: v.productId || v.product_id || v.id,
          productName: v.productName || v.product_name || v.name || 'Product',
          createdDate: v.createdDate || '',
          createdAt: v.createdAt || null,
          createdAtMs: v.createdAtMs || 0,
        }));
        list.sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0));
        setRows(list);
      } catch {
        if (mounted) setRows([]);
      }
    };

    loadVariants();
    const timer = setInterval(loadVariants, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const productRows = useMemo(() => {
    const grouped = new Map();
    for (const r of rows) {
      const pid = String(r.productId || r.id || '').trim();
      if (!pid) continue;
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid).push(r);
    }

    return Array.from(grouped.entries()).map(([productId, list]) => {
      const first = list[0] || {};
      const latest = [...list].sort((a, b) => Number(b.createdAt?.seconds || b.createdAtMs || 0) - Number(a.createdAt?.seconds || a.createdAtMs || 0))[0] || first;
      const brands = Array.from(new Set(list.map((x) => String(x.brandName || x.brand_name || '-')).filter(Boolean)));
      const specs = Array.from(new Set(list.map((x) => formatSpec(x)).filter(Boolean)));
      return {
        id: productId,
        productId,
        productName: first.productName || first.name || 'Product',
        createdDate: latest.createdDate || (latest.createdAt?.seconds ? new Date(latest.createdAt.seconds * 1000).toISOString().slice(0, 10) : '-'),
        brandSummary: brands.length <= 1 ? (brands[0] || '-') : `${brands.length} brands`,
        specSummary: specs.length <= 1 ? (specs[0] || '-') : `${specs.length} specs`,
      };
    }).sort((a, b) => String(a.productName || '').localeCompare(String(b.productName || '')));
  }, [rows]);

  const filtered = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    if (!term) return productRows;
    return productRows.filter((r) => {
      const product = String(r.productName || '').toLowerCase();
      const pid = String(r.productId || '').toLowerCase();
      return product.includes(term) || pid.includes(term);
    });
  }, [productRows, search]);

  React.useEffect(() => {
    setPage(1);
  }, [search, activeMenu, filtered.length]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const startIdx = (page - 1) * perPage;
  const pagedRows = filtered.slice(startIdx, startIdx + perPage);

  const selectedProductVariants = useMemo(() => {
    if (!selectedProductId) return [];
    return rows
      .filter((r) => String(r.productId || '') === String(selectedProductId))
      .sort((a, b) => {
        const byBrand = String(a.brandName || a.brand_name || '').localeCompare(String(b.brandName || b.brand_name || ''));
        if (byBrand !== 0) return byBrand;
        return formatSpec(a).localeCompare(formatSpec(b));
      });
  }, [rows, selectedProductId]);

  const selectedProduct = selectedProductVariants[0] || null;

  const existingBrandOptions = useMemo(() => {
    return Array.from(
      new Set(selectedProductVariants.map((v) => String(v.brandName || v.brand_name || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [selectedProductVariants]);

  const displayVariants = useMemo(() => {
    let prevBrand = '';
    return selectedProductVariants.map((v) => {
      const brand = String(v.brandName || v.brand_name || '-');
      const brandDisplay = brand === prevBrand ? '' : brand;
      prevBrand = brand;
      return { ...v, brandDisplay };
    });
  }, [selectedProductVariants]);

  const createNextProductId = () => {
    const max = rows.reduce((m, r) => {
      const n = Number(String(r.productId || '').replace('PROD-', ''));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return `PROD-${String(max + 1).padStart(3, '0')}`;
  };

  const handleAddProduct = async () => {
    const productName = String(form.productName || '').trim();
    const brandName = String(form.brandName || '').trim();
    const specValue = Number(form.specValue || 0);

    const specs = {};
    if (form.specType === 'wp' && specValue > 0) specs.wattPeak = specValue;
    if (form.specType === 'kw' && specValue > 0) specs.kiloWatt = specValue;
    if (form.specType === 'm' && specValue > 0) specs.lengthMeters = specValue;

    if (!productName || !brandName) {
      alert('Product name and brand are required.');
      return;
    }

    setSaving(true);
    try {
      const productId = createNextProductId();
      const variantId = `VAR-${Date.now()}`;

      await setDoc(doc(db, 'inventoryVariants', variantId), {
        productId,
        productName,
        brandName,
        variantName: '',
        variantId,
        unit: String(form.unit || 'Nos').trim() || 'Nos',
        defaultPrice: Number(form.defaultPrice || 0),
        specifications: specs,
        availableQuantity: 0,
        createdDate: new Date().toISOString().slice(0, 10),
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });

      setForm({ productName: '', brandName: '', specType: 'wp', specValue: '', unit: 'Nos', defaultPrice: '' });
      setOpenAdd(false);
    } catch (e) {
      alert(e?.message || 'Failed to add product');
    } finally {
      setSaving(false);
    }
  };

  const handleAddVariant = async () => {
    if (!selectedProduct) return;
    const brandName = addBrandMode === 'existing_brand'
      ? String(variantForm.existingBrand || '').trim()
      : String(variantForm.brandName || '').trim();
    const specValue = Number(variantForm.specValue || 0);

    const specs = {};
    if (variantForm.specType === 'wp' && specValue > 0) specs.wattPeak = specValue;
    if (variantForm.specType === 'kw' && specValue > 0) specs.kiloWatt = specValue;
    if (variantForm.specType === 'm' && specValue > 0) specs.lengthMeters = specValue;

    if (!brandName) {
      alert(addBrandMode === 'existing_brand' ? 'Please select an existing brand.' : 'Brand is required.');
      return;
    }

    setSavingVariant(true);
    try {
      const variantId = `VAR-${Date.now()}`;
      await setDoc(doc(db, 'inventoryVariants', variantId), {
        productId: selectedProduct.productId,
        productName: selectedProduct.productName,
        brandName,
        variantName: '',
        variantId,
        unit: String(variantForm.unit || 'Nos').trim() || 'Nos',
        defaultPrice: Number(variantForm.defaultPrice || 0),
        specifications: specs,
        availableQuantity: 0,
        createdDate: new Date().toISOString().slice(0, 10),
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });

      setVariantForm({ brandName: '', existingBrand: '', specType: 'wp', specValue: '', unit: 'Nos', defaultPrice: '' });
    } catch (e) {
      alert(e?.message || 'Failed to add variant');
    } finally {
      setSavingVariant(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 12, minHeight: 'calc(100vh - 60px)', paddingRight: 12 }}>
      <aside
        style={{
          width: 260,
          background: MAROON,
          color: '#fff',
          padding: '14px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ padding: '0 22px 8px', fontSize: 28, fontWeight: 700, lineHeight: 1.05 }}>Inventory</div>

        <button style={activeMenu === 'products' ? sideBtnActive : sideBtn} onClick={() => setActiveMenu('products')}>
          Items(Products)
        </button>
        <button style={activeMenu === 'stock' ? sideBtnActive : sideBtn} onClick={() => setActiveMenu('stock')}>
          Stock
        </button>
        <button style={activeMenu === 'stockio' ? sideBtnActive : sideBtn} onClick={() => setActiveMenu('stockio')}>
          Stock In/Out
        </button>
      </aside>

      <div style={{ flex: 1, background: '#f3f3f3', padding: 18, minWidth: 0 }}>
        {activeMenu === 'products' ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h2 style={{ margin: 0 }}>Products</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by Product Name"
                  style={{ ...inputStyle, minWidth: 220, background: '#cfeaf7' }}
                />
              </div>
              <button style={primaryBtn} onClick={() => setOpenAdd(true)}>Add Product</button>
            </div>

            <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e8e8e8', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: MAROON, color: '#fff' }}>
                    <th style={th}>Created Date</th>
                    <th style={th}>Product ID</th>
                    <th style={th}>Product Name</th>
                    <th style={th}>Brand</th>
                    <th style={th}>Specification</th>
                    {isAdmin && <th style={th}>Delete</th>}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => {
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedProductId(String(row.productId || row.id))}
                        style={{ cursor: 'pointer', background: String(row.productId || row.id) === String(selectedProductId) ? '#f5f9ff' : 'transparent' }}
                      >
                        <td style={td}>{row.createdDate || '-'}</td>
                        <td style={td}>{row.productId || row.id}</td>
                        <td style={td}>{row.productName || row.name || '-'}</td>
                        <td style={td}>{row.brandSummary || '-'}</td>
                        <td style={td}>{row.specSummary || '-'}</td>
                        {isAdmin && (
                          <td style={td}>
                            <button
                              style={dangerBtn}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const related = rows.filter((x) => String(x.productId || '') === String(row.productId || ''));
                                await Promise.all(related.map((x) => deleteDoc(doc(db, 'inventoryVariants', x.id))));
                                if (selectedProductId === row.productId) setSelectedProductId('');
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!filtered.length && (
                    <tr>
                      <td style={{ ...td, textAlign: 'center' }} colSpan={isAdmin ? 6 : 5}>No products found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: MAROON, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  {filtered.length === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + perPage, filtered.length)} of {filtered.length}
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

            {selectedProduct ? (
              <div style={rightPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2d3d' }}>{selectedProduct.productName}</div>
                    <div style={{ color: '#666', marginTop: 2 }}>{selectedProduct.productId}</div>
                  </div>
                  <button style={secondaryBtn} onClick={() => setSelectedProductId('')}>Close</button>
                </div>

                <div style={{ marginTop: 12, fontWeight: 700, color: '#333' }}>Existing Variants</div>
                <div style={{ border: '1px solid #ececec', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#fafafa' }}>
                        <th style={thSmall}>Brand</th>
                        <th style={thSmall}>Variant</th>
                        <th style={thSmall}>Spec</th>
                        <th style={thSmall}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayVariants.map((v) => (
                        <tr key={v.id}>
                          <td style={tdSmall}>{v.brandDisplay || ''}</td>
                          <td style={tdSmall}>{v.variantName || v.variant_name || '-'}</td>
                          <td style={tdSmall}>{formatSpec(v)}</td>
                          <td style={tdSmall}>{Number(v.availableQuantity || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 12, fontWeight: 700, color: '#333' }}>Add Brand / Specification</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    style={addBrandMode === 'new_brand' ? primaryBtn : secondaryBtn}
                    onClick={() => setAddBrandMode('new_brand')}
                  >
                    Add New Brand
                  </button>
                  <button
                    style={addBrandMode === 'existing_brand' ? primaryBtn : secondaryBtn}
                    onClick={() => setAddBrandMode('existing_brand')}
                  >
                    Add Spec to Existing Brand
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 8 }}>
                  {addBrandMode === 'new_brand' ? (
                    <input
                      placeholder="Brand Name * (e.g. Renew)"
                      value={variantForm.brandName}
                      onChange={(e) => setVariantForm((p) => ({ ...p, brandName: e.target.value }))}
                      style={inputStyle}
                    />
                  ) : (
                    <select
                      value={variantForm.existingBrand}
                      onChange={(e) => setVariantForm((p) => ({ ...p, existingBrand: e.target.value }))}
                      style={inputStyle}
                    >
                      <option value="">Select existing brand</option>
                      {existingBrandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  )}
                  <select
                    style={inputStyle}
                    value={variantForm.specType}
                    onChange={(e) => setVariantForm((p) => ({ ...p, specType: e.target.value }))}
                  >
                    <option value="wp">Spec Type: Wp</option>
                    <option value="kw">Spec Type: kW</option>
                    <option value="m">Spec Type: Meters</option>
                    <option value="none">No Specification</option>
                  </select>
                  {variantForm.specType !== 'none' ? (
                    <input
                      type="number"
                      min={0}
                      placeholder={variantForm.specType === 'kw' ? 'Specification (kW)' : variantForm.specType === 'm' ? 'Specification (Meters)' : 'Specification (Wp)'}
                      value={variantForm.specValue}
                      onChange={(e) => setVariantForm((p) => ({ ...p, specValue: e.target.value }))}
                      style={inputStyle}
                    />
                  ) : null}
                  <input
                    placeholder="Unit"
                    value={variantForm.unit}
                    onChange={(e) => setVariantForm((p) => ({ ...p, unit: e.target.value }))}
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Default Price"
                    value={variantForm.defaultPrice}
                    onChange={(e) => setVariantForm((p) => ({ ...p, defaultPrice: e.target.value }))}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button style={primaryBtn} onClick={handleAddVariant} disabled={savingVariant}>
                    {savingVariant ? 'Saving...' : 'Add Variant'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : activeMenu === 'stock' ? (
          <StockDashboard />
        ) : (
          <StockInOut />
        )}
      </div>

      {openAdd ? (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>Add Product Variant</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input
                placeholder="Main Product Name *"
                value={form.productName}
                onChange={(e) => setForm((p) => ({ ...p, productName: e.target.value }))}
                style={inputStyle}
              />
              <input
                placeholder="Brand Name *"
                value={form.brandName}
                onChange={(e) => setForm((p) => ({ ...p, brandName: e.target.value }))}
                style={inputStyle}
              />
              <select
                style={inputStyle}
                value={form.specType}
                onChange={(e) => setForm((p) => ({ ...p, specType: e.target.value }))}
              >
                <option value="wp">Spec Type: Wp</option>
                <option value="kw">Spec Type: kW</option>
                <option value="m">Spec Type: Meters</option>
                <option value="none">No Specification</option>
              </select>
              {form.specType !== 'none' ? (
                <input
                  type="number"
                  min={0}
                  placeholder={form.specType === 'kw' ? 'Specification (kW)' : form.specType === 'm' ? 'Specification (Meters)' : 'Specification (Wp)'}
                  value={form.specValue}
                  onChange={(e) => setForm((p) => ({ ...p, specValue: e.target.value }))}
                  style={inputStyle}
                />
              ) : <div />}
              <input
                placeholder="Unit (Nos/Mtr/Kg)"
                value={form.unit}
                onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                placeholder="Default Price"
                value={form.defaultPrice}
                onChange={(e) => setForm((p) => ({ ...p, defaultPrice: e.target.value }))}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={secondaryBtn} onClick={() => setOpenAdd(false)} disabled={saving}>Cancel</button>
              <button style={primaryBtn} onClick={handleAddProduct} disabled={saving}>{saving ? 'Saving...' : 'Save Product'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const inputStyle = {
  height: 34,
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  padding: '0 10px',
};

const primaryBtn = {
  height: 40,
  border: 'none',
  borderRadius: 8,
  padding: '0 20px',
  background: MAROON,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn = {
  height: 40,
  border: '1px solid #d0d0d0',
  borderRadius: 8,
  padding: '0 20px',
  background: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const dangerBtn = {
  height: 32,
  border: '1px solid #f5c2c7',
  borderRadius: 6,
  padding: '0 10px',
  background: '#fff5f5',
  color: '#b42318',
  fontWeight: 600,
  cursor: 'pointer',
};

const sideBtn = {
  height: 46,
  border: 'none',
  borderRadius: '0 12px 12px 0',
  padding: '0 22px',
  background: 'transparent',
  color: '#fff',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 20,
  marginRight: 10,
  fontWeight: 500,
};

const sideBtnActive = {
  ...sideBtn,
  background: 'rgba(255,255,255,0.25)',
  color: '#fff',
  fontWeight: 700,
};

const th = { textAlign: 'left', padding: '10px 12px', whiteSpace: 'nowrap' };
const td = { textAlign: 'left', padding: '12px', borderBottom: '1px solid #f0f0f0' };
const thSmall = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #ececec', fontSize: 13, whiteSpace: 'nowrap' };
const tdSmall = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #f5f5f5', fontSize: 13, whiteSpace: 'nowrap' };

const rightPanel = {
  width: 430,
  maxWidth: '42vw',
  background: '#fff',
  border: '1px solid #e8e8e8',
  borderRadius: 10,
  padding: 12,
  position: 'sticky',
  top: 8,
};

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.25)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1200,
};

const modal = {
  width: 'min(760px, 92vw)',
  background: '#fff',
  borderRadius: 10,
  padding: 16,
};

export default InventoryLayout;
