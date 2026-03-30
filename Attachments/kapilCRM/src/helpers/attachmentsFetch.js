import http from "k6/http";
import { check } from "k6";

const API_BASE = __ENV.API_BASE || "";
const ID_TOKEN = __ENV.ID_TOKEN || "";

if (!API_BASE) throw new Error("Missing API_BASE env var");
if (!ID_TOKEN) throw new Error("Missing ID_TOKEN env var");

const headers = {
  Authorization: `Bearer ${ID_TOKEN}`,
  "Content-Type": "application/json",
};

export const fetchAttachments = (kpiId) => {
  const res = http.get(`${API_BASE}/attachments/${kpiId}`, { headers });
  check(res, {
    "fetch attachments ok": (r) => r.status === 200,
  });
  return res.json();
};

export const uploadAttachment = (kpiId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  
  const res = http.post(`${API_BASE}/attachments/${kpiId}/upload`, formData, {
    headers: {
      ...headers,
      "Content-Type": "multipart/form-data",
    },
  });
  check(res, {
    "upload attachment ok": (r) => r.status === 201,
  });
  return res.json();
};

export const fetchFolders = () => {
  const res = http.get(`${API_BASE}/attachments/folders`, { headers });
  check(res, {
    "fetch folders ok": (r) => r.status === 200,
  });
  return res.json();
};

export const fetchDocument = (documentId) => {
  const res = http.get(`${API_BASE}/attachments/document/${documentId}`, { headers });
  check(res, {
    "fetch document ok": (r) => r.status === 200,
  });
  return res.json();
};