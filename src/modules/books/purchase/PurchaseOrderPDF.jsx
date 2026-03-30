import React from 'react';
import { Document, Page, StyleSheet, Text, View, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: 700, textAlign: 'center', marginBottom: 8 },
  box: { border: '1 solid #999', padding: 8, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  label: { fontWeight: 700 },
  table: { border: '1 solid #999', marginTop: 8 },
  trHead: { flexDirection: 'row', backgroundColor: '#f3f3f3', borderBottom: '1 solid #999' },
  tr: { flexDirection: 'row', borderBottom: '1 solid #ddd' },
  th: { padding: 6, fontWeight: 700, borderRight: '1 solid #ddd' },
  td: { padding: 6, borderRight: '1 solid #eee' },
  termsTitle: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 6 },
  authorizedWrap: {
    marginTop: 12,
    alignItems: 'flex-end',
  },
  authorizedImage: { width: 150, height: 72, objectFit: 'contain' },
  authorizedLine: { width: 220, borderTop: '1 solid #888', marginTop: 4, paddingTop: 4, textAlign: 'center' },
});

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
    const n = Number(cleaned || 0);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const money = (v) => toNumber(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tableWidths = {
  sNo: 30,
  desc: '40%',
  unit: 45,
  qty: 45,
  rate: 75,
  total: 85,
};

const chunkItems = (rows, size = 14) => {
  const safe = Array.isArray(rows) ? rows : [];
  if (!safe.length) return [[]];
  const out = [];
  for (let i = 0; i < safe.length; i += size) {
    out.push(safe.slice(i, i + size));
  }
  return out;
};

export const PurchaseOrderPDF = ({
  po = {},
  vendor = {},
  terms = {},
  approved = false,
  signatureUrl = '',
  stampUrl = '',
  approvedByName = '',
  logoUrl = '',
  type = 'material',
}) => {
  const items = Array.isArray(po.items) ? po.items : [];
  const materialLineTotal = (item) => {
    const qty = toNumber(item?.quantity);
    const rate = toNumber(item?.rate ?? item?.unitPrice);
    return qty * rate;
  };
  const materialGrandTotal = items.reduce((sum, item) => {
    return sum + materialLineTotal(item);
  }, 0);
  const serviceGrandTotal = toNumber(po.totalAmount) || (toNumber(po.assignedProjectsCount) * toNumber(po.ratePerProject));
  const grandTotal = type === 'material' ? materialGrandTotal : serviceGrandTotal;
  const displayStatus = approved ? 'APPROVED' : String(po.status || 'draft').replaceAll('_', ' ').toUpperCase();
  const authorizedImageUrl = signatureUrl || stampUrl || '';
  const approvedBy = String(approvedByName || '').trim();
  const showApprovedBy = approvedBy && approvedBy.toLowerCase() !== 'authorized signatory';
  const signatoryLabel = showApprovedBy ? `Authorized Signatory (${approvedBy})` : 'Authorized Signatory';
  const itemChunks = type === 'material' ? chunkItems(items, 14) : [[]];

  return (
    <Document>
      {type === 'material' ? (
        itemChunks.map((chunk, pageIndex) => {
          const isLastPage = pageIndex === itemChunks.length - 1;
          const start = pageIndex * 14;
          return (
            <Page key={`po-page-${pageIndex}`} size="A4" style={styles.page}>
              <Text style={styles.title}>PURCHASE ORDER{itemChunks.length > 1 ? ` (${pageIndex + 1}/${itemChunks.length})` : ''}</Text>

              <View style={styles.header}>
                <View style={{ width: '62%' }}>
                  <Text style={{ fontWeight: 700 }}>Kapil Power & Infra (P) Limited</Text>
                  <Text>Financial District, Hyderabad</Text>
                  <Text>GSTIN: 36AAFCA3811M1ZO</Text>
                </View>
                <View style={{ width: '38%', alignItems: 'flex-end' }}>
                  {logoUrl ? <Image src={logoUrl} style={{ width: 92, height: 44, objectFit: 'contain' }} /> : null}
                  <Text style={{ marginTop: 4 }}><Text style={styles.label}>PO:</Text> {po.poNumber || '-'}</Text>
                  <Text><Text style={styles.label}>Date:</Text> {po.createdDate || '-'}</Text>
                  <Text><Text style={styles.label}>Status:</Text> {displayStatus}</Text>
                </View>
              </View>

              <View style={styles.box}>
                <View style={styles.row}>
                  <Text><Text style={styles.label}>Vendor:</Text> {vendor.vendorName || po.vendorName || '-'}</Text>
                  <Text><Text style={styles.label}>PI:</Text> {po.piNumber || '-'}</Text>
                </View>
                <View style={styles.row}>
                  <Text><Text style={styles.label}>GST:</Text> {vendor.gst || '-'}</Text>
                  <Text><Text style={styles.label}>Contact:</Text> {vendor.contact || '-'}</Text>
                </View>
              </View>

              <View style={styles.table}>
                <View style={styles.trHead}>
                  <Text style={{ ...styles.th, width: tableWidths.sNo }}>#</Text>
                  <Text style={{ ...styles.th, width: tableWidths.desc }}>Description</Text>
                  <Text style={{ ...styles.th, width: tableWidths.unit }}>Unit</Text>
                  <Text style={{ ...styles.th, width: tableWidths.qty }}>Qty</Text>
                  <Text style={{ ...styles.th, width: tableWidths.rate }}>Rate</Text>
                  <Text style={{ ...styles.th, width: tableWidths.total, borderRight: 0 }}>Total</Text>
                </View>

                {chunk.map((item, idx) => (
                  <View style={styles.tr} key={`${item.variantId || start + idx}-${start + idx}`}>
                    <Text style={{ ...styles.td, width: tableWidths.sNo }}>{start + idx + 1}</Text>
                    <Text style={{ ...styles.td, width: tableWidths.desc }}>
                      {item.productName} | {item.brandName || '-'} | {item.variantName || '-'}{item.specification ? ` (${item.specification})` : ''}
                    </Text>
                    <Text style={{ ...styles.td, width: tableWidths.unit }}>{item.unit || 'Nos'}</Text>
                    <Text style={{ ...styles.td, width: tableWidths.qty }}>{toNumber(item.quantity)}</Text>
                    <Text style={{ ...styles.td, width: tableWidths.rate }}>{money(item.rate ?? item.unitPrice)}</Text>
                    <Text style={{ ...styles.td, width: tableWidths.total, borderRight: 0 }}>{money(materialLineTotal(item))}</Text>
                  </View>
                ))}
              </View>

              {isLastPage && (
                <>
                  <View style={{ marginTop: 6, alignItems: 'flex-end' }}>
                    <Text><Text style={styles.label}>Grand Total:</Text> INR {money(grandTotal)}</Text>
                  </View>

                  <Text style={styles.termsTitle}>TERMS & CONDITIONS</Text>
                  {Object.entries(terms || {}).map(([k, v]) => (
                    <Text key={k} style={{ marginBottom: 3 }}>
                      <Text style={styles.label}>{k}:</Text> {v || '-'}
                    </Text>
                  ))}

                  {approved ? (
                    <View style={styles.authorizedWrap}>
                      {authorizedImageUrl ? <Image src={authorizedImageUrl} style={styles.authorizedImage} /> : null}
                      <View style={styles.authorizedLine}>
                        <Text>{signatoryLabel}</Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={{ marginTop: 12, fontWeight: 700 }}>Draft Copy (Signature/Stamp not included)</Text>
                  )}
                </>
              )}
            </Page>
          );
        })
      ) : (
        <Page size="A4" style={styles.page}>
          <Text style={styles.title}>PURCHASE ORDER</Text>

          <View style={styles.header}>
            <View style={{ width: '62%' }}>
              <Text style={{ fontWeight: 700 }}>Kapil Power & Infra (P) Limited</Text>
              <Text>Financial District, Hyderabad</Text>
              <Text>GSTIN: 36AAFCA3811M1ZO</Text>
            </View>
            <View style={{ width: '38%', alignItems: 'flex-end' }}>
              {logoUrl ? <Image src={logoUrl} style={{ width: 92, height: 44, objectFit: 'contain' }} /> : null}
              <Text style={{ marginTop: 4 }}><Text style={styles.label}>PO:</Text> {po.poNumber || '-'}</Text>
              <Text><Text style={styles.label}>Date:</Text> {po.createdDate || '-'}</Text>
              <Text><Text style={styles.label}>Status:</Text> {displayStatus}</Text>
            </View>
          </View>

          <View style={styles.box}>
            <View style={styles.row}>
              <Text><Text style={styles.label}>Vendor:</Text> {vendor.vendorName || po.vendorName || '-'}</Text>
            </View>
            <View style={styles.row}>
              <Text><Text style={styles.label}>GST:</Text> {vendor.gst || '-'}</Text>
              <Text><Text style={styles.label}>Contact:</Text> {vendor.contact || '-'}</Text>
            </View>
          </View>

          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={{ ...styles.th, width: tableWidths.sNo }}>#</Text>
              <Text style={{ ...styles.th, width: tableWidths.desc }}>Description</Text>
              <Text style={{ ...styles.th, width: tableWidths.unit }}>Unit</Text>
              <Text style={{ ...styles.th, width: tableWidths.qty }}>Qty</Text>
              <Text style={{ ...styles.th, width: tableWidths.rate }}>Rate</Text>
              <Text style={{ ...styles.th, width: tableWidths.total, borderRight: 0 }}>Total</Text>
            </View>

            <View style={styles.tr}>
              <Text style={{ ...styles.td, width: tableWidths.sNo }}>1</Text>
              <Text style={{ ...styles.td, width: tableWidths.desc }}>Service Scope as per project allocation</Text>
              <Text style={{ ...styles.td, width: tableWidths.unit }}>Project</Text>
              <Text style={{ ...styles.td, width: tableWidths.qty }}>{toNumber(po.assignedProjectsCount)}</Text>
              <Text style={{ ...styles.td, width: tableWidths.rate }}>{money(po.ratePerProject)}</Text>
              <Text style={{ ...styles.td, width: tableWidths.total, borderRight: 0 }}>{money(serviceGrandTotal)}</Text>
            </View>
          </View>

          <View style={{ marginTop: 6, alignItems: 'flex-end' }}>
            <Text><Text style={styles.label}>Grand Total:</Text> INR {money(grandTotal)}</Text>
          </View>

          <Text style={styles.termsTitle}>TERMS & CONDITIONS</Text>
          {Object.entries(terms || {}).map(([k, v]) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={styles.label}>{k}:</Text> {v || '-'}
            </Text>
          ))}

          {approved ? (
            <View style={styles.authorizedWrap}>
              {authorizedImageUrl ? <Image src={authorizedImageUrl} style={styles.authorizedImage} /> : null}
              <View style={styles.authorizedLine}>
                <Text>{signatoryLabel}</Text>
              </View>
            </View>
          ) : (
            <Text style={{ marginTop: 12, fontWeight: 700 }}>Draft Copy (Signature/Stamp not included)</Text>
          )}
        </Page>
      )}
    </Document>
  );
};

export default PurchaseOrderPDF;
