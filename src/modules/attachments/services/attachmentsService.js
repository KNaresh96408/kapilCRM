import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../../firebaseConfig";
import { DEFAULT_SUBFOLDERS } from "../constants/defaultSubfolders";

const ROOT = "attachments_kpi";
const HOME_DOC = "home";

const normalize = (v) => String(v || "").trim();
const makeSlug = (v) =>
  normalize(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export async function ensureKpiFolder({ kpiId, customerName, user, source = "crm" }) {
  const id = normalize(kpiId);
  if (!id) throw new Error("kpiId is required");

  const rootRef = doc(db, ROOT, id);
  const snap = await getDoc(rootRef);

  if (!snap.exists()) {
    await setDoc(rootRef, {
      kpiId: id,
      customerName: normalize(customerName),
      source,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: user?.uid || null,
      createdByName: user?.displayName || user?.email || "Unknown",
    });

    await Promise.all(
      DEFAULT_SUBFOLDERS.map((sf) =>
        setDoc(doc(db, ROOT, id, "subfolders", sf.key), {
          key: sf.key,
          name: sf.label,
          system: true,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || null,
          createdByName: user?.displayName || user?.email || "Unknown",
        })
      )
    );
  } else {
    await setDoc(
      rootRef,
      {
        customerName: normalize(customerName) || snap.data()?.customerName || "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  return id;
}

export async function listKpiFolders(search = "") {
  const res = await getDocs(query(collection(db, ROOT), orderBy("kpiId")));
  const rows = res.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => normalize(r.kpiId));

  const s = normalize(search).toLowerCase();
  if (!s) return rows;

  return rows.filter(
    (r) =>
      String(r.kpiId || "").toLowerCase().includes(s) ||
      String(r.customerName || "").toLowerCase().includes(s)
  );
}

export async function listHomeFolders({ currentUid, isAdmin }) {
  const res = await getDocs(query(collection(db, ROOT, HOME_DOC, "folders")));
  const rows = res.docs.map((d) => ({ id: d.id, ...d.data() }));

  const visibleRows = rows.filter((x) => {
    if (x.visibility === "everyone") return true;
    if (isAdmin) return true;
    return x.createdByUid === currentUid;
  });

  const toMillis = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const ts = new Date(v).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  return visibleRows.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

export async function createHomeFolder({ name, visibility, user }) {
  const cleanName = normalize(name);
  const folderKey = `home_${makeSlug(cleanName) || Date.now().toString(36)}_${Date.now().toString(36).slice(-4)}`;

  const ref = await addDoc(collection(db, ROOT, HOME_DOC, "folders"), {
    key: folderKey,
    name: cleanName,
    visibility,
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  });

  return { id: ref.id, key: folderKey, name: cleanName };
}

export async function listHomeSubfolders({ folderKey, currentUid, isAdmin }) {
  if (!folderKey) return [];
  const res = await getDocs(
    query(collection(db, ROOT, HOME_DOC, "subfolders"), where("folderKey", "==", folderKey))
  );
  const rows = res.docs.map((d) => ({ id: d.id, ...d.data() }));

  const visibleRows = rows.filter((x) => {
    if (x.visibility === "everyone") return true;
    if (isAdmin) return true;
    return x.createdByUid === currentUid;
  });

  const toMillis = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const ts = new Date(v).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  return visibleRows.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

export async function createHomeSubfolder({ folderKey, name, visibility, user }) {
  const cleanName = normalize(name);
  const subfolderKey = `sub_${makeSlug(cleanName) || Date.now().toString(36)}_${Date.now().toString(36).slice(-4)}`;

  const ref = await addDoc(collection(db, ROOT, HOME_DOC, "subfolders"), {
    folderKey,
    key: subfolderKey,
    name: cleanName,
    visibility,
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  });

  return { id: ref.id, key: subfolderKey, name: cleanName };
}

export async function uploadHomeFile({ folderKey, subfolderKey = "", file, visibility, user }) {
  const safeName = `${Date.now()}_${file.name}`;
  const path = `attachments/home/${folderKey}/${subfolderKey || "root"}/${safeName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const docRef = await addDoc(collection(db, ROOT, HOME_DOC, "files"), {
    type: "file",
    folderKey,
    subfolderKey: normalize(subfolderKey),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size || 0,
    path,
    url,
    visibility,
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  });

  return { id: docRef.id, url };
}

export async function createHomeExcelShortcut({ folderKey, subfolderKey = "", name, visibility, user }) {
  const cleanName = normalize(name) || "Untitled Sheet";
  const url = `https://docs.google.com/spreadsheets/create?title=${encodeURIComponent(cleanName)}`;

  const ref = await addDoc(collection(db, ROOT, HOME_DOC, "files"), {
    type: "excel",
    folderKey,
    subfolderKey: normalize(subfolderKey),
    name: cleanName,
    mimeType: "application/vnd.google-apps.spreadsheet",
    size: 0,
    path: "",
    url,
    visibility,
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  });

  return { id: ref.id, url };
}

export async function listHomeFiles({ folderKey, subfolderKey = "", currentUid, isAdmin }) {
  if (!folderKey) return [];

  const res = await getDocs(
    query(collection(db, ROOT, HOME_DOC, "files"), where("folderKey", "==", folderKey))
  );

  const rows = res.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((x) => normalize(x.subfolderKey) === normalize(subfolderKey));

  const visibleRows = rows.filter((x) => {
    if (x.visibility === "everyone") return true;
    if (isAdmin) return true;
    return x.createdByUid === currentUid;
  });

  const toMillis = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const ts = new Date(v).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  return visibleRows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function listAllHomeFiles({ currentUid, isAdmin }) {
  const res = await getDocs(query(collection(db, ROOT, HOME_DOC, "files")));
  const rows = res.docs.map((d) => ({ id: d.id, ...d.data() }));

  const visibleRows = rows.filter((x) => {
    if (x.visibility === "everyone") return true;
    if (isAdmin) return true;
    return x.createdByUid === currentUid;
  });

  const toMillis = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const ts = new Date(v).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  return visibleRows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function updateHomeFileUrl({ fileId, url }) {
  if (!fileId) throw new Error("fileId is required");
  if (!url) throw new Error("url is required");

  await updateDoc(doc(db, ROOT, HOME_DOC, "files", fileId), {
    url,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteHomeFile({ fileId }) {
  if (!fileId) throw new Error("fileId is required");

  const refDoc = doc(db, ROOT, HOME_DOC, "files", fileId);
  const snap = await getDoc(refDoc);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const path = String(data.path || "");
  if (path) {
    try {
      await deleteObject(ref(storage, path));
    } catch (err) {
      console.warn("deleteHomeFile storage delete failed", err);
    }
  }

  await deleteDoc(refDoc);
}

export async function deleteHomeFolder({ folderKey }) {
  const key = String(folderKey || "").trim();
  if (!key) throw new Error("folderKey is required");

  const filesSnap = await getDocs(
    query(collection(db, ROOT, HOME_DOC, "files"), where("folderKey", "==", key))
  );

  for (const docSnap of filesSnap.docs) {
    const data = docSnap.data() || {};
    const path = String(data.path || "");
    if (path) {
      try {
        await deleteObject(ref(storage, path));
      } catch (err) {
        console.warn("deleteHomeFolder storage delete failed", err);
      }
    }

    try {
      await deleteDoc(doc(db, ROOT, HOME_DOC, "files", docSnap.id));
    } catch (err) {
      console.warn("deleteHomeFolder file doc delete failed", err);
    }
  }

  const subfoldersSnap = await getDocs(
    query(collection(db, ROOT, HOME_DOC, "subfolders"), where("folderKey", "==", key))
  );
  for (const docSnap of subfoldersSnap.docs) {
    try {
      await deleteDoc(doc(db, ROOT, HOME_DOC, "subfolders", docSnap.id));
    } catch (err) {
      console.warn("deleteHomeFolder subfolder delete failed", err);
    }
  }

  const foldersSnap = await getDocs(
    query(collection(db, ROOT, HOME_DOC, "folders"), where("key", "==", key))
  );
  for (const docSnap of foldersSnap.docs) {
    try {
      await deleteDoc(doc(db, ROOT, HOME_DOC, "folders", docSnap.id));
    } catch (err) {
      console.warn("deleteHomeFolder folder doc delete failed", err);
    }
  }
}

export async function listSubfolders(kpiId) {
  const res = await getDocs(
    query(collection(db, ROOT, kpiId, "subfolders"), orderBy("name"))
  );
  return res.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listVisibleSubfolders({ kpiId, currentUid, isAdmin }) {
  const rows = await listSubfolders(kpiId);

  return rows.filter((sf) => {
    if (sf.system) return true;
    if (sf.visibility === "everyone") return true;
    if (isAdmin) return true;
    return sf.createdByUid === currentUid;
  });
}

export async function listFiles({ kpiId, subfolderKey, currentUid, isAdmin }) {
  const base = collection(db, ROOT, kpiId, "files");
  const q = subfolderKey
    ? query(base, where("subfolderKey", "==", subfolderKey))
    : query(base, orderBy("createdAt", "desc"));
  const res = await getDocs(q);
  const rows = res.docs.map((d) => ({ id: d.id, ...d.data() }));

  const visibleRows = rows.filter((f) => {
    if (f.visibility === "everyone") return true;
    if (isAdmin) return true;
    return f.createdByUid === currentUid;
  });

  const toMillis = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const ts = new Date(v).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  return visibleRows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function uploadAttachment({ kpiId, subfolderKey, file, visibility, user }) {
  const safeName = `${Date.now()}_${file.name}`;
  const path = `attachments/${kpiId}/${subfolderKey}/${safeName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  await addDoc(collection(db, ROOT, kpiId, "files"), {
    kpiId,
    subfolderKey,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size || 0,
    path,
    url,
    visibility, // "forMe" | "everyone"
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  });
}

export async function deleteKpiSubfolderContents({ kpiId, subfolderKey }) {
  if (!kpiId) throw new Error("kpiId is required");
  if (!subfolderKey) throw new Error("subfolderKey is required");

  const res = await getDocs(
    query(collection(db, ROOT, kpiId, "files"), where("subfolderKey", "==", subfolderKey))
  );

  for (const docSnap of res.docs) {
    const data = docSnap.data() || {};
    const path = String(data.path || "");
    if (path) {
      try {
        await deleteObject(ref(storage, path));
      } catch (err) {
        console.warn("deleteKpiSubfolderContents storage delete failed", err);
      }
    }

    try {
      await deleteDoc(doc(db, ROOT, kpiId, "files", docSnap.id));
    } catch (err) {
      console.warn("deleteKpiSubfolderContents doc delete failed", err);
    }
  }
}

export async function createCustomItem({ kpiId, type, name, visibility, user }) {
  const cleanName = normalize(name);
  const payload = {
    type, // "folder" | "excel"
    name: cleanName,
    visibility, // "forMe" | "everyone"
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  };

  if (type === "folder") {
    const folderKey = `custom_${makeSlug(cleanName) || Date.now().toString(36)}_${Date.now().toString(36).slice(-4)}`;
    await setDoc(doc(db, ROOT, kpiId, "subfolders", folderKey), {
      key: folderKey,
      name: cleanName,
      system: false,
      visibility,
      createdAt: serverTimestamp(),
      createdByUid: user?.uid || null,
      createdByName: user?.displayName || user?.email || "Unknown",
    });

    const ref = await addDoc(collection(db, ROOT, kpiId, "customItems"), {
      ...payload,
      folderKey,
    });

    return { id: ref.id, folderKey };
  }

  const ref = await addDoc(collection(db, ROOT, kpiId, "customItems"), payload);
  return { id: ref.id };
}

export async function createExcelItem({ kpiId, file, visibility, user }) {
  const safeName = `${Date.now()}_${file.name}`;
  const path = `attachments/${kpiId}/excel/${safeName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const docRef = await addDoc(collection(db, ROOT, kpiId, "customItems"), {
    type: "excel",
    name: file.name,
    visibility,
    url,
    path,
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: file.size || 0,
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByName: user?.displayName || user?.email || "Unknown",
  });

  return { id: docRef.id, url };
}

export async function listCustomItems({ kpiId, currentUid, isAdmin }) {
  const res = await getDocs(
    query(collection(db, ROOT, kpiId, "customItems"), orderBy("createdAt", "desc"))
  );
  const rows = res.docs.map((d) => ({ id: d.id, ...d.data() }));

  return rows.filter((x) => {
    if (x.visibility === "everyone") return true;
    if (isAdmin) return true;
    return x.createdByUid === currentUid;
  });
}

export async function deleteKpiFolder({ kpiId, docId }) {
  const id = String(docId || kpiId || "").trim();
  if (!id) throw new Error("kpiId or docId is required");

  const filesSnap = await getDocs(collection(db, ROOT, id, "files"));
  for (const docSnap of filesSnap.docs) {
    const data = docSnap.data() || {};
    const path = String(data.path || "");
    if (path) {
      try {
        await deleteObject(ref(storage, path));
      } catch (err) {
        console.warn("deleteKpiFolder storage delete failed", err);
      }
    }
    try {
      await deleteDoc(doc(db, ROOT, id, "files", docSnap.id));
    } catch (err) {
      console.warn("deleteKpiFolder file doc delete failed", err);
    }
  }

  const subfoldersSnap = await getDocs(collection(db, ROOT, id, "subfolders"));
  for (const docSnap of subfoldersSnap.docs) {
    try {
      await deleteDoc(doc(db, ROOT, id, "subfolders", docSnap.id));
    } catch (err) {
      console.warn("deleteKpiFolder subfolder delete failed", err);
    }
  }

  const customSnap = await getDocs(collection(db, ROOT, id, "customItems"));
  for (const docSnap of customSnap.docs) {
    try {
      await deleteDoc(doc(db, ROOT, id, "customItems", docSnap.id));
    } catch (err) {
      console.warn("deleteKpiFolder customItems delete failed", err);
    }
  }

  try {
    await deleteDoc(doc(db, ROOT, id));
  } catch (err) {
    console.warn("deleteKpiFolder root delete failed", err);
  }
}