export const buildQuoteNo = (kpiId) => {
  const normalized = String(kpiId || "").trim();
  return normalized ? `Q/No/${normalized}` : "";
};

export const getKpiIdFromRecord = (record = {}) => {
  const direct =
    record?.kpiId ||
    record?.autoId ||
    record?.caseId ||
    record?.dealId ||
    record?.createdFromDeal ||
    "";
  return String(direct || "").trim();
};

export const resolveQuoteNo = (record = {}) => {
  const explicit = String(record?.quoteNo || "").trim();
  if (explicit) return explicit;

  const existingQuotationId = String(record?.quotationId || "").trim();
  if (existingQuotationId.startsWith("Q/No/")) return existingQuotationId;

  const kpiId = getKpiIdFromRecord(record);
  if (kpiId) return buildQuoteNo(kpiId);

  return existingQuotationId;
};
