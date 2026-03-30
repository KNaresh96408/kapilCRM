import { auth } from "../firebaseConfig";

const API = import.meta.env.VITE_API_BASE;

const getSessionUser = () => {
  try {
    return JSON.parse(localStorage.getItem("kp-user") || "{}");
  } catch {
    return {};
  }
};

const persistSessionToken = (idToken) => {
  if (!idToken) return;
  try {
    const current = JSON.parse(localStorage.getItem("kp-user") || "{}");
    localStorage.setItem("kp-user", JSON.stringify({ ...current, idToken }));
  } catch {
    // ignore storage parse/write failure
  }
};

const getFreshIdToken = async () => {
  const currentUser = auth?.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken(true);
      persistSessionToken(token);
      return token;
    } catch {
      const token = await currentUser.getIdToken();
      persistSessionToken(token);
      return token;
    }
  }

  const stored = getSessionUser();
  if (!stored?.idToken) {
    throw new Error("Session expired. Please login again.");
  }

  return stored.idToken;
};

const authHeader = async () => {
  const token = await getFreshIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

const postJson = async (path, payload = {}, retried = false) => {
  if (!API) {
    throw new Error("VITE_API_BASE is missing");
  }

  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  const apiErrorText = String(data?.error || "");
  const isExpiredToken =
    apiErrorText.includes("auth/id-token-expired") ||
    apiErrorText.toLowerCase().includes("id token has expired") ||
    res.status === 401;

  if (!res.ok && isExpiredToken && !retried && auth?.currentUser) {
    await getFreshIdToken();
    return postJson(path, payload, true);
  }

  if (!res.ok) {
    throw new Error(data?.error || `${path} failed (${res.status})`);
  }
  return data;
};

export const sendMailApi = (payload) => postJson("mailSend", payload);
export const saveDraftApi = (payload) => postJson("mailSaveDraft", payload);
