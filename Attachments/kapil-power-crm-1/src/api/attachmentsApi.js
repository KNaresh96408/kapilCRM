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

export const fetchKpiFolders = () => {
  const res = http.get(`${API_BASE}/attachments/kpiFolders`, { headers });
  check(res, {
    "fetch kpi folders ok": (r) => r.status === 200,
  });
  return res.json();
};

export const uploadDocument = (folderId, document) => {
  const res = http.post(
    `${API_BASE}/attachments/upload`,
    JSON.stringify({ folderId, document }),
    { headers }
  );
  check(res, {
    "upload document ok": (r) => r.status === 200,
  });
  return res.json();
};

export const fetchAttachments = (folderId) => {
  const res = http.get(`${API_BASE}/attachments/${folderId}`, { headers });
  check(res, {
    "fetch attachments ok": (r) => r.status === 200,
  });
  return res.json();
};

export const deleteAttachment = (attachmentId) => {
  const res = http.del(`${API_BASE}/attachments/${attachmentId}`, { headers });
  check(res, {
    "delete attachment ok": (r) => r.status === 204,
  });
};