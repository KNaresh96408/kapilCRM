import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import authorizedSignatoryImg from '../../../purchaseAssets/authorized/authorized-signatory.png';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 20,
    color: '#111',
  },
  outer: {
    borderWidth: 1,
    borderColor: '#222',
  },
  header: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#222',
    padding: 10,
    alignItems: 'center',
    minHeight: 72,
  },
  logoWrap: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  logo: {
    width: 58,
    height: 58,
    objectFit: 'contain',
  },
  companyWrap: {
    flex: 1,
  },
  companyName: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  companyLine: {
    fontSize: 9,
    lineHeight: 1.3,
  },
  title: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderColor: '#222',
    paddingVertical: 6,
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#222',
  },
  metaCell: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: '#222',
    padding: 6,
  },
  metaCellLast: {
    flex: 1,
    padding: 6,
  },
  label: {
    fontWeight: 'bold',
  },
  customerSection: {
    borderBottomWidth: 1,
    borderColor: '#222',
    padding: 8,
  },
  customerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  customerItem: {
    width: '50%',
    marginBottom: 4,
    paddingRight: 8,
  },
  table: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#222',
    minHeight: 24,
  },
  head: {
    backgroundColor: '#f1f1f1',
    fontWeight: 'bold',
  },
  cSno: { width: '8%', borderRightWidth: 1, borderColor: '#222', padding: 5, textAlign: 'center' },
  cProd: { width: '22%', borderRightWidth: 1, borderColor: '#222', padding: 5 },
  cBrand: { width: '16%', borderRightWidth: 1, borderColor: '#222', padding: 5 },
  cVariant: { width: '24%', borderRightWidth: 1, borderColor: '#222', padding: 5 },
  cPoQty: { width: '10%', borderRightWidth: 1, borderColor: '#222', padding: 5, textAlign: 'right' },
  cRecv: { width: '10%', borderRightWidth: 1, borderColor: '#222', padding: 5, textAlign: 'right' },
  cUnit: { width: '10%', padding: 5, textAlign: 'center' },
  totalQtyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#222',
    backgroundColor: '#fafafa',
  },
  totalQtyLabel: {
    width: '90%',
    borderRightWidth: 1,
    borderColor: '#222',
    padding: 6,
    textAlign: 'right',
    fontWeight: 'bold',
  },
  totalQtyValue: {
    width: '10%',
    padding: 6,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  signatureSection: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
    minHeight: 96,
  },
  signatureDivider: {
    borderTopWidth: 1,
    borderColor: '#222',
    marginTop: 2,
  },
  signBox: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 10,
  },
  signImage: {
    width: 100,
    height: 36,
    objectFit: 'contain',
  },
  signTitle: {
    marginTop: 4,
    textAlign: 'center',
    fontWeight: 'bold',
  },
});

const defaultCompany = {
  name: 'KAPIL POWER & INFRA (P) LIMITED',
  gst: '36AAFCA3811M1ZO',
  address: '2nd Floor, Kapil Kavuri Hub, Financial District, Nanakramguda, Gachibowli, Hyderabad - 500032',
};

export const GrnPdfDocument = ({ grn = {}, logoUrl = '' }) => {
  const items = Array.isArray(grn.items) ? grn.items : [];
  const company = {
    ...defaultCompany,
    ...(grn.company || {}),
  };
  const totalReceived = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.outer}>
          <View style={styles.header}>
            <View style={styles.logoWrap}>{logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}</View>
            <View style={styles.companyWrap}>
              <Text style={styles.companyName}>{company.name}</Text>
              <Text style={styles.companyLine}>GST: {company.gst}</Text>
              <Text style={styles.companyLine}>{company.address}</Text>
            </View>
          </View>

          <Text style={styles.title}>GOODS RECEIPT NOTE</Text>

          <View style={styles.metaRow}>
            <View style={styles.metaCell}>
              <Text>
                <Text style={styles.label}>GRN Number: </Text>
                {grn.grnNumber || '-'}
              </Text>
            </View>
            <View style={styles.metaCellLast}>
              <Text>
                <Text style={styles.label}>Date: </Text>
                {grn.createdDate || '-'}
              </Text>
            </View>
          </View>

          <View style={styles.customerSection}>
            <Text style={styles.label}>Vendor Details</Text>
            <View style={styles.customerGrid}>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>Vendor Name: </Text>
                  {grn.vendorName || '-'}
                </Text>
              </View>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>Vendor ID: </Text>
                  {grn.vendorId || '-'}
                </Text>
              </View>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>PO ID: </Text>
                  {grn.poId || '-'}
                </Text>
              </View>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>Reference PO: </Text>
                  {grn.referencePO || '-'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.table}>
            <View style={[styles.row, styles.head]}>
              <Text style={styles.cSno}>S.No</Text>
              <Text style={styles.cProd}>Product</Text>
              <Text style={styles.cBrand}>Brand</Text>
              <Text style={styles.cVariant}>Variant</Text>
              <Text style={styles.cPoQty}>PO Qty</Text>
              <Text style={styles.cRecv}>Received</Text>
              <Text style={styles.cUnit}>Unit</Text>
            </View>

            {items.map((item, idx) => (
              <View style={styles.row} key={`${item.variantId || idx}-${idx}`}>
                <Text style={styles.cSno}>{idx + 1}</Text>
                <Text style={styles.cProd}>{item.productName || item.productId || '-'}</Text>
                <Text style={styles.cBrand}>{item.brandName || '-'}</Text>
                <Text style={styles.cVariant}>
                  {item.variantName || item.variantId || '-'}
                  {item.specification ? ` (${item.specification})` : ''}
                </Text>
                <Text style={styles.cPoQty}>{Number(item.poQuantity || 0).toFixed(2)}</Text>
                <Text style={styles.cRecv}>{Number(item.quantity || 0).toFixed(2)}</Text>
                <Text style={styles.cUnit}>{item.unit || 'Nos'}</Text>
              </View>
            ))}

            {items.length === 0 && (
              <View style={styles.row}>
                <Text style={{ ...styles.cSno, width: '100%', borderRightWidth: 0, textAlign: 'center' }}>No items</Text>
              </View>
            )}

            <View style={styles.totalQtyRow}>
              <Text style={styles.totalQtyLabel}>Total Received Quantity</Text>
              <Text style={styles.totalQtyValue}>{Number(totalReceived).toFixed(2)}</Text>
            </View>
          </View>

          <View style={styles.signatureSection} wrap={false}>
            <View style={styles.signatureDivider} />
            <View style={styles.signBox}>
              <Image src={authorizedSignatoryImg} style={styles.signImage} />
              <Text style={styles.signTitle}>Authorized Signatory</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default GrnPdfDocument;
