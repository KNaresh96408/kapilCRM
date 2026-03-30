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

export const uploadAttachment = (file, folderId) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folderId", folderId);

  const res = http.post(`${API_BASE}/attachments/upload`, formData, {
    headers: {
      Authorization: `Bearer ${ID_TOKEN}`,
    },
  });

  check(res, {
    "upload successful": (r) => r.status === 200,
  });

  return res.json();
};

export const fetchFolders = () => {
  const res = http.get(`${API_BASE}/attachments/folders`, { headers });

  check(res, {
    "fetch folders successful": (r) => r.status === 200,
  });

  return res.json();
};

export const fetchDocumentsByKPI = (kpiId) => {
  const res = http.get(`${API_BASE}/attachments/documents?kpiId=${kpiId}`, { headers });

  check(res, {
    "fetch documents successful": (r) => r.status === 200,
  });

  return res.json();
};