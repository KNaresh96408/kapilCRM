import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import authorizedSignatoryImg from "../../../purchaseAssets/authorized/authorized-signatory.png";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 20,
    color: "#111",
  },
  outer: {
    borderWidth: 1,
    borderColor: "#222",
  },
  header: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#222",
    padding: 10,
    alignItems: "center",
    minHeight: 72,
  },
  logoWrap: {
    width: 70,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  logo: {
    width: 58,
    height: 58,
    objectFit: "contain",
  },
  companyWrap: {
    flex: 1,
  },
  companyName: {
    fontSize: 13,
    fontWeight: "bold",
    marginBottom: 2,
  },
  companyLine: {
    fontSize: 9,
    lineHeight: 1.3,
  },
  title: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "bold",
    borderBottomWidth: 1,
    borderColor: "#222",
    paddingVertical: 6,
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#222",
  },
  metaCell: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: "#222",
    padding: 6,
  },
  metaCellLast: {
    flex: 1,
    padding: 6,
  },
  label: {
    fontWeight: "bold",
  },
  customerSection: {
    borderBottomWidth: 1,
    borderColor: "#222",
    padding: 8,
  },
  customerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  customerItem: {
    width: "50%",
    marginBottom: 4,
    paddingRight: 8,
  },
  table: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#222",
  },
  head: {
    backgroundColor: "#f1f1f1",
    fontWeight: "bold",
  },
  cSno: { width: "7%", borderRightWidth: 1, borderColor: "#222", padding: 5, textAlign: "center" },
  cProd: { width: "21%", borderRightWidth: 1, borderColor: "#222", padding: 5 },
  cBrand: { width: "15%", borderRightWidth: 1, borderColor: "#222", padding: 5 },
  cVariant: { width: "19%", borderRightWidth: 1, borderColor: "#222", padding: 5 },
  cQty: { width: "10%", borderRightWidth: 1, borderColor: "#222", padding: 5, textAlign: "right" },
  cUnitPrice: { width: "14%", borderRightWidth: 1, borderColor: "#222", padding: 5, textAlign: "right" },
  cTotal: { width: "14%", padding: 5, textAlign: "right" },
  totalsWrap: {
    borderBottomWidth: 1,
    borderColor: "#222",
    paddingVertical: 6,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    marginVertical: 1,
  },
  totalsLabel: {
    width: 120,
    textAlign: "right",
    paddingRight: 8,
  },
  totalsValue: {
    width: 120,
    textAlign: "right",
    fontWeight: "bold",
  },
  amountWords: {
    borderBottomWidth: 1,
    borderColor: "#222",
    padding: 8,
  },
  signatureSection: {
    flexDirection: "row",
    padding: 10,
    minHeight: 92,
  },
  signBox: {
    flex: 1,
    paddingHorizontal: 6,
    justifyContent: "flex-end",
  },
  signTitle: {
    marginTop: 6,
    borderTopWidth: 1,
    borderColor: "#222",
    paddingTop: 4,
    textAlign: "center",
    fontWeight: "bold",
  },
  signImage: {
    width: 100,
    height: 36,
    objectFit: "contain",
    alignSelf: "center",
    marginBottom: 4,
  },
});

const defaultCompany = {
  name: "KAPIL POWER & INFRA (P) LIMITED",
  gst: "36AAFCA3811M1ZO",
  address: "2nd Floor, Kapil Kavuri Hub, Financial District, Nanakramguda, Gachibowli, Hyderabad - 500032",
};

const fmtDate = (value) => {
  if (!value) return "";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

const toMoney = (num) => Number(num || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function numberToWords(amount) {
  const a = Math.floor(Number(amount || 0));
  if (!a) return "Zero Only";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const twoDigit = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`);
  const threeDigit = (n) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (!h) return twoDigit(r);
    return `${ones[h]} Hundred${r ? ` ${twoDigit(r)}` : ""}`;
  };

  const crore = Math.floor(a / 10000000);
  const lakh = Math.floor((a % 10000000) / 100000);
  const thousand = Math.floor((a % 100000) / 1000);
  const rest = a % 1000;

  const out = [];
  if (crore) out.push(`${twoDigit(crore)} Crore`);
  if (lakh) out.push(`${twoDigit(lakh)} Lakh`);
  if (thousand) out.push(`${twoDigit(thousand)} Thousand`);
  if (rest) out.push(threeDigit(rest));
  return `${out.join(" ")} Only`;
}

export function InvoicePDF({ invData = {}, items = [], logoUrl, signatureUrl }) {
  const company = {
    ...defaultCompany,
    ...(invData.company || {}),
  };

  const normalizedItems = items.map((item) => {
    const qty = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || item.rate || 0);
    const total = Number(item.total || qty * unitPrice);
    return { ...item, qty, unitPrice, total };
  });

  const subTotal = Number(
    invData.subTotal ?? invData.taxableAmount ?? normalizedItems.reduce((sum, item) => sum + item.total, 0)
  );
  const gstPercent = Number(invData.gstPercent ?? invData.gst_percentage ?? 0);
  const gstAmount = Number(invData.gstAmount ?? invData.gst_amount ?? (subTotal * gstPercent) / 100);
  const grandTotal = Number(invData.grandTotal ?? invData.totalInvoiceAmount ?? invData.invoice_amount ?? subTotal + gstAmount);

  const kpiId = invData.kpi_id || invData.kpiId || "-";

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

          <Text style={styles.title}>TAX INVOICE</Text>

          <View style={styles.metaRow}>
            <View style={styles.metaCell}>
              <Text>
                <Text style={styles.label}>Invoice Number: </Text>
                {invData.invoiceNumber || invData.invoiceNo || "-"}
              </Text>
            </View>
            <View style={styles.metaCellLast}>
              <Text>
                <Text style={styles.label}>Date: </Text>
                {fmtDate(invData.createdAt || invData.created_at || invData.date)}
              </Text>
            </View>
          </View>

          <View style={styles.customerSection}>
            <Text style={styles.label}>Customer Details</Text>
            <View style={styles.customerGrid}>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>Customer Name: </Text>
                  {invData.customerName || invData.customer_name || "-"}
                </Text>
              </View>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>Contact: </Text>
                  {invData.contactNumber || invData.contact_number || invData.customerPhone || "-"}
                </Text>
              </View>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>KPI-ID: </Text>
                  {kpiId}
                </Text>
              </View>
              <View style={styles.customerItem}>
                <Text>
                  <Text style={styles.label}>Sales Zone: </Text>
                  {invData.sales_zone || invData.salesZone || "-"}
                </Text>
              </View>
              <View style={{ ...styles.customerItem, width: "100%" }}>
                <Text>
                  <Text style={styles.label}>Address: </Text>
                  {invData.address || invData.location || "-"}
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
              <Text style={styles.cQty}>Quantity</Text>
              <Text style={styles.cUnitPrice}>Unit Price</Text>
              <Text style={styles.cTotal}>Total</Text>
            </View>

            {normalizedItems.map((item, idx) => (
              <View style={styles.row} key={`${item.variantId || "var"}-${idx}`}>
                <Text style={styles.cSno}>{idx + 1}</Text>
                <Text style={styles.cProd}>{item.productName || item.product || "-"}</Text>
                <Text style={styles.cBrand}>{item.brandName || item.brand || "-"}</Text>
                <Text style={styles.cVariant}>{item.variantName || item.variantId || item.variant || "-"}</Text>
                <Text style={styles.cQty}>{Number(item.qty).toFixed(2)}</Text>
                <Text style={styles.cUnitPrice}>{toMoney(item.unitPrice)}</Text>
                <Text style={styles.cTotal}>{toMoney(item.total)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.totalsWrap}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Sub Total</Text>
              <Text style={styles.totalsValue}>INR {toMoney(subTotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>GST %</Text>
              <Text style={styles.totalsValue}>{gstPercent.toFixed(2)}%</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>GST Amount</Text>
              <Text style={styles.totalsValue}>INR {toMoney(gstAmount)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { fontWeight: "bold" }]}>Grand Total</Text>
              <Text style={styles.totalsValue}>INR {toMoney(grandTotal)}</Text>
            </View>
          </View>

          <View style={styles.amountWords}>
            <Text>
              <Text style={styles.label}>Amount in Words: </Text>
              {numberToWords(grandTotal)}
            </Text>
          </View>

          <View style={styles.signatureSection}>
            <View style={styles.signBox}>
              <Image src={signatureUrl || authorizedSignatoryImg} style={styles.signImage} />
              <Text style={styles.signTitle}>Authorized Signatory</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
