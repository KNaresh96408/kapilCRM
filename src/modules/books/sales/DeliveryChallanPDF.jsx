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
    minHeight: 24,
  },
  head: {
    backgroundColor: "#f1f1f1",
    fontWeight: "bold",
  },
  cSno: { width: "8%", borderRightWidth: 1, borderColor: "#222", padding: 5, textAlign: "center" },
  cProd: { width: "28%", borderRightWidth: 1, borderColor: "#222", padding: 5 },
  cBrand: { width: "20%", borderRightWidth: 1, borderColor: "#222", padding: 5 },
  cVariant: { width: "22%", borderRightWidth: 1, borderColor: "#222", padding: 5 },
  cQty: { width: "12%", borderRightWidth: 1, borderColor: "#222", padding: 5, textAlign: "right" },
  cUnit: { width: "10%", padding: 5, textAlign: "center" },
  totalQtyRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#222",
    backgroundColor: "#fafafa",
  },
  totalQtyLabel: {
    width: "90%",
    borderRightWidth: 1,
    borderColor: "#222",
    padding: 6,
    textAlign: "right",
    fontWeight: "bold",
  },
  totalQtyValue: {
    width: "10%",
    padding: 6,
    textAlign: "center",
    fontWeight: "bold",
  },
  signatureSection: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
    minHeight: 96,
  },
  signatureDivider: {
    borderTopWidth: 1,
    borderColor: "#222",
    marginTop: 2,
  },
  signBox: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: 10,
  },
  signTitle: {
    marginTop: 4,
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

const formatSpecification = (spec) => {
  if (!spec) return "";
  if (typeof spec === "string" || typeof spec === "number") return String(spec);
  if (typeof spec === "object") {
    if (spec.wattPeak != null) return `${spec.wattPeak}Wp`;
    if (spec.wattage != null) return `${spec.wattage}W`;
    const entries = Object.entries(spec)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => `${k}: ${v}`);
    return entries.join(", ");
  }
  return "";
};

const variantWithSpec = (item) => {
  const variant = item?.variantName || item?.variantId || item?.variant || "-";
  const spec = formatSpecification(item?.specification || item?.specifications || item?.wattage || item?.capacity || "");
  if (!spec) return variant;
  const v = String(variant).toLowerCase();
  const s = String(spec).toLowerCase();
  if (v.includes(s)) return variant;
  return `${variant} (${spec})`;
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

export function DeliveryChallanPDF({
  dcData = {},
  items = [],
  logoUrl,
  signatureUrl,
  title = "DELIVERY CHALLAN",
  numberLabel = "DC Number",
  numberValue,
  quantityLabel = "Total Quantity",
}) {
  const company = {
    ...defaultCompany,
    ...(dcData.company || {}),
  };

  const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const kpiId = dcData.kpi_id || dcData.kpiId || "-";
  const printableItems = Array.isArray(items)
    ? items.filter((item) => Number(item?.quantity || 0) > 0)
    : [];
  const itemChunks = chunkItems(printableItems, 14);

  return (
    <Document>
      {itemChunks.map((chunk, pageIndex) => {
        const isLastPage = pageIndex === itemChunks.length - 1;
        const start = pageIndex * 14;
        return (
          <Page key={`dc-page-${pageIndex}`} size="A4" style={styles.page}>
            <View style={styles.outer}>
              <View style={styles.header}>
                <View style={styles.logoWrap}>{logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}</View>
                <View style={styles.companyWrap}>
                  <Text style={styles.companyName}>{company.name}</Text>
                  <Text style={styles.companyLine}>GST: {company.gst}</Text>
                  <Text style={styles.companyLine}>{company.address}</Text>
                </View>
              </View>

              <Text style={styles.title}>{title}{itemChunks.length > 1 ? ` (${pageIndex + 1}/${itemChunks.length})` : ""}</Text>

              <View style={styles.metaRow}>
                <View style={styles.metaCell}>
                  <Text>
                    <Text style={styles.label}>{numberLabel}: </Text>
                    {numberValue || dcData.dcNumber || "-"}
                  </Text>
                </View>
                <View style={styles.metaCellLast}>
                  <Text>
                    <Text style={styles.label}>Date: </Text>
                    {fmtDate(dcData.createdAt || dcData.created_at || dcData.createdAtStr || dcData.date)}
                  </Text>
                </View>
              </View>

              {pageIndex === 0 && (
                <View style={styles.customerSection}>
                  <Text style={styles.label}>Customer Details</Text>
                  <View style={styles.customerGrid}>
                    <View style={styles.customerItem}>
                      <Text>
                        <Text style={styles.label}>Customer Name: </Text>
                        {dcData.customerName || dcData.customer_name || "-"}
                      </Text>
                    </View>
                    <View style={styles.customerItem}>
                      <Text>
                        <Text style={styles.label}>Contact: </Text>
                        {dcData.contactNumber || dcData.contact_number || dcData.customerPhone || "-"}
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
                        {dcData.sales_zone || dcData.salesZone || "-"}
                      </Text>
                    </View>
                    <View style={{ ...styles.customerItem, width: "100%" }}>
                      <Text>
                        <Text style={styles.label}>Address: </Text>
                        {dcData.address || dcData.location || "-"}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.table}>
                <View style={[styles.row, styles.head]}>
                  <Text style={styles.cSno}>S.No</Text>
                  <Text style={styles.cProd}>Product</Text>
                  <Text style={styles.cBrand}>Brand</Text>
                  <Text style={styles.cVariant}>Variant</Text>
                  <Text style={styles.cQty}>Quantity</Text>
                  <Text style={styles.cUnit}>Unit</Text>
                </View>

                {chunk.map((item, idx) => (
                  <View style={styles.row} key={`${item.variantId || "var"}-${start + idx}`}>
                    <Text style={styles.cSno}>{start + idx + 1}</Text>
                    <Text style={styles.cProd}>{item.productName || item.product || "-"}</Text>
                    <Text style={styles.cBrand}>{item.brandName || item.brand || "-"}</Text>
                    <Text style={styles.cVariant}>{variantWithSpec(item)}</Text>
                    <Text style={styles.cQty}>{Number(item.quantity || 0).toFixed(2)}</Text>
                    <Text style={styles.cUnit}>{item.unit || "Nos"}</Text>
                  </View>
                ))}

                {printableItems.length === 0 && (
                  <View style={styles.row}>
                    <Text style={{ ...styles.cSno, width: "100%", borderRightWidth: 0, textAlign: "center" }}>No items</Text>
                  </View>
                )}

                {isLastPage && (
                  <View style={styles.totalQtyRow}>
                    <Text style={styles.totalQtyLabel}>{quantityLabel}</Text>
                    <Text style={styles.totalQtyValue}>{Number(totalQty).toFixed(2)}</Text>
                  </View>
                )}
              </View>

              {isLastPage && (
                <View style={styles.signatureSection} wrap={false}>
                  <View style={styles.signatureDivider} />
                  <View style={styles.signBox}>
                    <Image src={signatureUrl || authorizedSignatoryImg} style={styles.signImage} />
                    <Text style={styles.signTitle}>Authorized Signatory</Text>
                  </View>
                </View>
              )}
            </View>
          </Page>
        );
      })}
    </Document>
  );
}
