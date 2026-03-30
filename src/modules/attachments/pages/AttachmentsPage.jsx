import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isAdminSessionUser } from "../../../helpers/bulkImport";
import {
  createHomeExcelShortcut,
  createHomeFolder,
  createHomeSubfolder,
  deleteHomeFolder,
  deleteHomeFile,
  ensureKpiFolder,
  listFiles,
  listHomeFiles,
  listHomeFolders,
  listHomeSubfolders,
  listAllHomeFiles,
  updateHomeFileUrl,
  listKpiFolders,
  listVisibleSubfolders,
  uploadAttachment,
  uploadHomeFile,
  deleteKpiFolder,
} from "../services/attachmentsService";

function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("kp-user") || "null");
  } catch {
    return null;
  }
}

const ATTACHMENTS_ROOT_KEY = "attachments";
const SHEETS_ROOT_KEY = "sheets";
const BRAND_MAROON = "#7d0d2d";
const BRAND_PURPLE = "#4a0d62";
const BRAND_GRADIENT = "linear-gradient(135deg, #9a1022 0%, #7b1244 48%, #4a0d62 100%)";
const CARD_SURFACE = "linear-gradient(180deg, #ffffff 0%, #fff9fc 100%)";

export default function AttachmentsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useMemo(() => getSessionUser(), []);

  const from = params.get("from") || "";
  const initialKpiId = params.get("kpiId") || "";
  const initialCustomer = params.get("customerName") || "";
  const initialSubfolder = params.get("subfolder") || "";

  const [loadError, setLoadError] = useState("");

  const [leftKey, setLeftKey] = useState("");
  const [homeFolders, setHomeFolders] = useState([]);
  const [homeSubfolders, setHomeSubfolders] = useState([]);
  const [selectedHomeSubfolder, setSelectedHomeSubfolder] = useState("");
  const [homeFiles, setHomeFiles] = useState([]);
  const [homeAllFiles, setHomeAllFiles] = useState([]);
  const [selectedHomeFileId, setSelectedHomeFileId] = useState("");
  const [showSheetPreview, setShowSheetPreview] = useState(false);

  const [search, setSearch] = useState("");
  const [kpiRows, setKpiRows] = useState([]);
  const [kpiId, setKpiId] = useState(initialKpiId);
  const [customerName, setCustomerName] = useState(initialCustomer);
  const [kpiSubfolders, setKpiSubfolders] = useState([]);
  const [selectedKpiSubfolder, setSelectedKpiSubfolder] = useState(initialSubfolder);
  const [kpiFiles, setKpiFiles] = useState([]);
  const [selectedKpiFileId, setSelectedKpiFileId] = useState("");

  const [uploadVisibility, setUploadVisibility] = useState("everyone");

  const [showContextCreateModal, setShowContextCreateModal] = useState(false);
  const [contextCreateType, setContextCreateType] = useState("folder");
  const [contextCreateName, setContextCreateName] = useState("");
  const [contextCreateVisibility, setContextCreateVisibility] = useState("everyone");
  const [contextCreateInsideFolder, setContextCreateInsideFolder] = useState(true);

  const isAdmin = useMemo(() => {
    const uid = String(user?.uid || user?.profile?.uid || "").trim();
    const role = String(
      user?.role ||
        user?.Role ||
        user?.customRole ||
        user?.CustomRole ||
        user?.profile?.role ||
        user?.profile?.Role ||
        user?.profile?.customRole ||
        user?.profile?.CustomRole ||
        ""
    ).toLowerCase();
    return role.includes("admin") || isAdminSessionUser() || uid === "26VHcREEDMMg8C24kXYVGzRXHe43";
  }, [
    user?.role,
    user?.Role,
    user?.customRole,
    user?.CustomRole,
    user?.profile?.role,
    user?.profile?.Role,
    user?.profile?.customRole,
    user?.profile?.CustomRole,
    user?.uid,
    user?.profile?.uid,
  ]);

  const getErrorMessage = (err) => {
    const code = String(err?.code || "").toLowerCase();
    if (code.includes("permission-denied")) {
      return "You don't have permission to access this data.";
    }
    return err?.message || "Failed to load attachments.";
  };

  const visibleHomeFolders = useMemo(
    () => homeFolders.filter((f) => String(f?.name || "").toLowerCase() !== "sheets"),
    [homeFolders]
  );

  const selectedHomeFolder = useMemo(
    () => visibleHomeFolders.find((x) => x.key === leftKey) || null,
    [visibleHomeFolders, leftKey]
  );

  const selectedHomeFile = useMemo(
    () => homeAllFiles.find((f) => f.id === selectedHomeFileId) || homeFiles.find((f) => f.id === selectedHomeFileId) || null,
    [homeAllFiles, homeFiles, selectedHomeFileId]
  );

  const isAttachmentsSelected = leftKey === ATTACHMENTS_ROOT_KEY;
  const isSheetsSelected = leftKey === SHEETS_ROOT_KEY;
  const isHomeFolderSelected = !!leftKey && leftKey !== ATTACHMENTS_ROOT_KEY && leftKey !== SHEETS_ROOT_KEY;
  const isUnselected = !leftKey;

  const showKpiUpload = !!kpiId && !!selectedKpiSubfolder && isAttachmentsSelected;
  const showHomeActions = isHomeFolderSelected;

  const homeExcelFiles = useMemo(
    () => homeAllFiles.filter((f) => f.type === "excel"),
    [homeAllFiles]
  );

  const onBack = () => {
    if (from === "deals") return navigate("/crm/deals");
    if (from === "salesOrders") return navigate("/crm/salesOrders");
    navigate(-1);
  };

  const refreshHomeFolders = useCallback(async () => {
    try {
      const rows = await listHomeFolders({ currentUid: user?.uid, isAdmin });
      setHomeFolders(rows);
    } catch (err) {
      setLoadError(getErrorMessage(err));
      setHomeFolders([]);
    }
  }, [user?.uid, isAdmin]);

  const refreshHomeFilesAll = useCallback(async () => {
    try {
      const rows = await listAllHomeFiles({ currentUid: user?.uid, isAdmin });
      setHomeAllFiles(rows);
    } catch (err) {
      setLoadError(getErrorMessage(err));
      setHomeAllFiles([]);
    }
  }, [user?.uid, isAdmin]);

  const refreshKpiRows = useCallback(async () => {
    try {
      const rows = await listKpiFolders(search);
      setKpiRows(rows);
      if (!kpiId && rows.length) {
        setKpiId(rows[0].kpiId || "");
        setCustomerName(rows[0].customerName || "");
      }
    } catch (err) {
      setLoadError(getErrorMessage(err));
      setKpiRows([]);
    }
  }, [search, kpiId]);

  const handleDeleteKpiFolder = async (e, row) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAdmin) return alert("Only admin can delete KPI folders.");
    const label = String(row?.kpiId || "").trim() || "this KPI";
    const ok = window.confirm(`Delete KPI folder "${label}" and all its files? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteKpiFolder({ kpiId: row?.kpiId, docId: row?.id });
      if (kpiId === row?.kpiId) {
        setKpiId("");
        setCustomerName("");
        setSelectedKpiSubfolder("");
        setSelectedKpiFileId("");
      }
      await refreshKpiRows();
    } catch (err) {
      console.error("deleteKpiFolder failed", err);
      alert("Failed to delete KPI folder.");
    }
  };

  const handleDeleteHomeFolder = async () => {
    if (!selectedHomeFolder?.key) return;

    const myUid = String(user?.uid || "").trim();
    const ownerUid = String(selectedHomeFolder?.createdByUid || "").trim();
    const canDelete = isAdmin || (!!myUid && myUid === ownerUid);
    if (!canDelete) {
      alert("Only admin or folder owner can delete this folder.");
      return;
    }

    const label = String(selectedHomeFolder?.name || "this folder").trim();
    const ok = window.confirm(`Delete folder "${label}" and all files/subfolders? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteHomeFolder({ folderKey: selectedHomeFolder.key });
      setLeftKey("");
      setSelectedHomeSubfolder("");
      setSelectedHomeFileId("");
      await refreshHomeFolders();
      await refreshHomeFilesAll();
      setHomeSubfolders([]);
      setHomeFiles([]);
    } catch (err) {
      console.error("deleteHomeFolder failed", err);
      alert("Failed to delete folder.");
    }
  };

  const refreshKpiPane = useCallback(async () => {
    if (!kpiId) {
      setKpiSubfolders([]);
      setKpiFiles([]);
      return;
    }

    try {
      await ensureKpiFolder({ kpiId, customerName, user, source: from || "attachments" });

      const [subs, docs] = await Promise.all([
        listVisibleSubfolders({ kpiId, currentUid: user?.uid, isAdmin }),
        selectedKpiSubfolder
          ? listFiles({
              kpiId,
              subfolderKey: selectedKpiSubfolder,
              currentUid: user?.uid,
              isAdmin,
            })
          : Promise.resolve([]),
      ]);

      setKpiSubfolders(subs);
      setKpiFiles(docs);

      if (selectedKpiSubfolder && !subs.some((x) => x.key === selectedKpiSubfolder)) {
        setSelectedKpiSubfolder("");
      }
    } catch (err) {
      setLoadError(getErrorMessage(err));
      setKpiSubfolders([]);
      setKpiFiles([]);
    }
  }, [kpiId, customerName, user?.uid, user?.displayName, user?.email, from, selectedKpiSubfolder, isAdmin]);

  const refreshHomePane = useCallback(async () => {
    if (!selectedHomeFolder?.key) {
      setHomeSubfolders([]);
      setHomeFiles([]);
      return;
    }

    try {
      const [subs, docs] = await Promise.all([
        listHomeSubfolders({
          folderKey: selectedHomeFolder.key,
          currentUid: user?.uid,
          isAdmin,
        }),
        listHomeFiles({
          folderKey: selectedHomeFolder.key,
          subfolderKey: selectedHomeSubfolder,
          currentUid: user?.uid,
          isAdmin,
        }),
      ]);

      setHomeSubfolders(subs);
      setHomeFiles(docs);
    } catch (err) {
      setLoadError(getErrorMessage(err));
      setHomeSubfolders([]);
      setHomeFiles([]);
    }
  }, [selectedHomeFolder?.key, selectedHomeSubfolder, user?.uid, isAdmin]);

  useEffect(() => {
    setLoadError("");
    refreshHomeFolders();
    refreshHomeFilesAll();
  }, [refreshHomeFolders, refreshHomeFilesAll]);

  useEffect(() => {
    if (initialKpiId) {
      setLeftKey(ATTACHMENTS_ROOT_KEY);
      setKpiId(initialKpiId);
      setCustomerName(initialCustomer);
      setSelectedKpiSubfolder(initialSubfolder || "");
      setSelectedKpiFileId("");
    }
  }, [initialKpiId, initialCustomer, initialSubfolder]);

  useEffect(() => {
    if (leftKey === ATTACHMENTS_ROOT_KEY) {
      setLoadError("");
      refreshKpiRows();
    }
  }, [leftKey, refreshKpiRows]);

  useEffect(() => {
    if (leftKey === ATTACHMENTS_ROOT_KEY) {
      setLoadError("");
      refreshKpiPane();
    }
  }, [leftKey, refreshKpiPane]);

  useEffect(() => {
    if (leftKey !== ATTACHMENTS_ROOT_KEY) {
      setLoadError("");
      refreshHomePane();
    }
  }, [leftKey, refreshHomePane]);

  const handleCreateContextItem = async () => {
    const name = String(contextCreateName || "").trim();
    if (!name) return alert("Name is required.");

    try {
      if (contextCreateType === "folder") {
        if (contextCreateInsideFolder && selectedHomeFolder?.key) {
          const created = await createHomeSubfolder({
            folderKey: selectedHomeFolder.key,
            name,
            visibility: contextCreateVisibility,
            user,
          });

          await refreshHomePane();
          if (created?.key) setSelectedHomeSubfolder(created.key);
        } else {
          const created = await createHomeFolder({
            name,
            visibility: contextCreateVisibility,
            user,
          });

          await refreshHomeFolders();
          if (created?.key) {
            setLeftKey(created.key);
            setSelectedHomeSubfolder("");
          }
        }
      } else {
        let targetFolderKey = selectedHomeFolder?.key || "";
        if (!targetFolderKey) {
          const base = await createHomeFolder({
            name: "Sheets",
            visibility: contextCreateVisibility,
            user,
          });
          await refreshHomeFolders();
          if (base?.key) {
            targetFolderKey = base.key;
            setLeftKey(base.key);
            setSelectedHomeSubfolder("");
          }
        }

        if (!targetFolderKey) return alert("Unable to create folder for sheet.");

        const created = await createHomeExcelShortcut({
          folderKey: targetFolderKey,
          subfolderKey: selectedHomeSubfolder,
          name,
          visibility: contextCreateVisibility,
          user,
        });

        await refreshHomePane();
        await refreshHomeFilesAll();
        if (created?.id) setSelectedHomeFileId(created.id);
      }

      setShowContextCreateModal(false);
      setContextCreateName("");
      setContextCreateVisibility("everyone");
      setContextCreateType("folder");
      setContextCreateInsideFolder(true);
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleUploadKpi = async (file) => {
    if (!file || !kpiId || !selectedKpiSubfolder) return;

    try {
      await uploadAttachment({
        kpiId,
        subfolderKey: selectedKpiSubfolder,
        file,
        visibility: uploadVisibility,
        user,
      });
      await refreshKpiPane();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleUploadHome = async (file) => {
    if (!file || !selectedHomeFolder?.key) return;

    try {
      await uploadHomeFile({
        folderKey: selectedHomeFolder.key,
        subfolderKey: selectedHomeSubfolder,
        file,
        visibility: uploadVisibility,
        user,
      });
      await refreshHomePane();
      await refreshHomeFilesAll();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const openFile = (url) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const isCreateSheetUrl = (url = "") =>
    String(url).includes("docs.google.com/spreadsheets/create");

  const extractSheetUrl = (input = "") => {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const iframeSrcMatch = raw.match(/src\s*=\s*"([^"]+)"/i) || raw.match(/src\s*=\s*'([^']+)'/i);
    return iframeSrcMatch ? iframeSrcMatch[1] : raw;
  };

  const isGoogleSheetUrl = (url = "") =>
    /docs\.google\.com\/spreadsheets\//i.test(String(url));

  const isPublishedSheetUrl = (url = "") =>
    /docs\.google\.com\/spreadsheets\/d\/e\/|\/pubhtml|\/pub\?/i.test(String(url));

  const parseSheetUrl = (input = "") => {
    const url = extractSheetUrl(input);
    if (!url) return { url: "", isCreate: false, isPublished: false, docId: "", pubId: "", gid: "" };

    const isCreate = isCreateSheetUrl(url);
    const isPublished = isPublishedSheetUrl(url);
    const pubMatch = url.match(/spreadsheets\/d\/e\/([^/]+)/i);
    const gidMatch = url.match(/[?#&]gid=(\d+)/i);
    const docMatch = pubMatch ? null : url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);

    return {
      url,
      isCreate,
      isPublished,
      docId: docMatch ? docMatch[1] : "",
      pubId: pubMatch ? pubMatch[1] : "",
      gid: gidMatch ? gidMatch[1] : "",
    };
  };

  const getPublishedEmbedUrl = (url = "") => {
    const u = String(url);
    if (u.includes("/pubhtml")) {
      return u.includes("widget=true") ? u : `${u}${u.includes("?") ? "&" : "?"}widget=true&headers=false`;
    }
    if (u.includes("/pub?")) {
      return u.includes("output=html") ? u : `${u}&output=html`;
    }
    return u;
  };

  const getSheetPreviewUrl = (url = "") => {
    const info = parseSheetUrl(url);
    if (!info.url) return "";
    if (info.isCreate) return info.url;
    if (info.isPublished) return getPublishedEmbedUrl(info.url);
    if (info.docId) {
      const base = `https://docs.google.com/spreadsheets/d/${info.docId}/edit`;
      const params = new URLSearchParams();
      params.set("embedded", "true");
      params.set("rm", "minimal");
      params.set("single", "true");
      params.set("widget", "true");
      params.set("headers", "false");
      if (info.gid) params.set("gid", info.gid);
      return `${base}?${params.toString()}`;
    }
    return info.url;
  };

  const getSheetOpenUrl = (url = "") => {
    const info = parseSheetUrl(url);
    if (!info.url) return "";
    if (info.isCreate) return info.url;
    if (info.docId) {
      const base = `https://docs.google.com/spreadsheets/d/${info.docId}/edit`;
      return info.gid ? `${base}?gid=${info.gid}` : base;
    }
    return info.url;
  };

  const openSheetInNewTab = (url = "") => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const selectedSheetInfo = useMemo(
    () => parseSheetUrl(selectedHomeFile?.url || ""),
    [selectedHomeFile?.url]
  );

  useEffect(() => {
    if (!selectedHomeFile?.id || selectedHomeFile?.type !== "excel") {
      setShowSheetPreview(false);
      return;
    }

    setShowSheetPreview(selectedSheetInfo.isPublished || false);
  }, [selectedHomeFile?.id, selectedHomeFile?.type, selectedSheetInfo.isPublished]);

  const handleUpdateSheetLink = async () => {
    if (!selectedHomeFile?.id) return;
    const input = window.prompt("Paste the Google Sheet link or embed code");
    if (!input) return;

    const nextUrl = extractSheetUrl(input);
    if (!nextUrl || !isGoogleSheetUrl(nextUrl)) {
      alert("Please paste a valid Google Sheets link (or the embed iframe code).");
      return;
    }

    try {
      await updateHomeFileUrl({ fileId: selectedHomeFile.id, url: nextUrl });
      await refreshHomeFilesAll();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleDeleteSheet = async () => {
    if (!selectedHomeFile?.id) return;
    const ok = window.confirm(`Delete sheet "${selectedHomeFile?.name || "Untitled"}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteHomeFile({ fileId: selectedHomeFile.id });
      setSelectedHomeFileId("");
      await refreshHomeFilesAll();
      await refreshHomePane();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const toMillis = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const ts = new Date(v).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  const formatDateTime = (v) => {
    const ms = toMillis(v);
    if (!ms) return "-";
    return new Date(ms).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getFileExt = (name = "") => {
    const clean = String(name || "").trim();
    const parts = clean.split(".");
    if (parts.length < 2) return "";
    return parts.pop().toLowerCase();
  };

  const isImageExt = (ext = "") => ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "calc(env(safe-area-inset-top) + 10px) 14px calc(env(safe-area-inset-bottom) + 12px)",
        boxSizing: "border-box",
        overflowX: "hidden",
        background: "radial-gradient(130% 120% at 0% 0%, #fff2f6 0%, #f8f4ff 48%, #ffffff 100%)",
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div
          className="attachments-topbar"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 12,
            background: BRAND_GRADIENT,
            color: "#fff",
            gap: 10,
            flexWrap: "wrap",
            border: "1px solid rgba(255,255,255,0.24)",
            boxShadow: "0 16px 30px rgba(74, 13, 98, 0.22)",
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          <div className="attachments-topbar-left" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={onBack}
              className="attachments-back-btn"
              style={{
                border: "none",
                borderRadius: 9,
                background: "rgba(14, 8, 26, 0.58)",
                color: "#fff",
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 700,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              Back
            </button>
            <div className="attachments-title" style={{ fontSize: 18, fontWeight: 800 }}>Attachments</div>
          </div>

          <div className="attachments-topbar-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {(showHomeActions || isUnselected) && (
            <>
              <button
                type="button"
                onClick={() => {
                  setContextCreateInsideFolder(!!selectedHomeFolder?.key);
                  setShowContextCreateModal(true);
                }}
                className="attachments-create-btn"
                style={{
                  border: "1px solid rgba(255,255,255,0.45)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.92)",
                  color: "#6b173e",
                  padding: "8px 14px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Create
              </button>

              {showHomeActions && (
                <>
                  <select
                    value={uploadVisibility ?? "everyone"}
                    onChange={(e) => setUploadVisibility(String(e.target.value || "everyone"))}
                    style={{ borderRadius: 8, border: "1px solid #d0d7de", padding: "7px 9px" }}
                  >
                    <option value="everyone">For Everyone</option>
                    <option value="forMe">For Me</option>
                  </select>

                  <label
                    style={{
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.45)",
                      padding: "7px 10px",
                      cursor: "pointer",
                      color: "#fff",
                      background: "rgba(255,255,255,0.12)",
                      fontWeight: 700,
                    }}
                  >
                    Upload
                    <input
                      type="file"
                      style={{ display: "none" }}
                      onChange={(e) => handleUploadHome(e.target.files?.[0])}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {showKpiUpload && (
            <label
              style={{
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.45)",
                padding: "7px 10px",
                cursor: "pointer",
                color: "#fff",
                background: "rgba(255,255,255,0.12)",
                fontWeight: 700,
              }}
            >
              Upload
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => handleUploadKpi(e.target.files?.[0])}
              />
            </label>
          )}
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 16, color: "#0f172a", fontWeight: 800 }}>
          {kpiId ? `${kpiId}${customerName ? ` • ${customerName}` : ""}` : ""}
        </div>
      </div>

      {loadError && (
        <div
          style={{
            marginBottom: 10,
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#9f1239",
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {loadError}
        </div>
      )}

      <div
        className="attachments-grid"
        style={{
          display: "grid",
          gridTemplateColumns: isSheetsSelected ? "260px minmax(0, 1fr)" : "260px minmax(0, 1fr) 320px",
          gap: 8,
          minHeight: "calc(100vh - 106px)",
        }}
      >
        <section
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.26)",
            background: BRAND_GRADIENT,
            color: "#fff",
            padding: 12,
            minHeight: "calc(100vh - 116px)",
            boxShadow: "0 18px 34px rgba(74, 13, 98, 0.2)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>Folders</div>

          <div
            onClick={() => {
              setLeftKey(ATTACHMENTS_ROOT_KEY);
              setSelectedHomeSubfolder("");
              setSelectedHomeFileId("");
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              background: leftKey === ATTACHMENTS_ROOT_KEY ? "rgba(255,255,255,0.24)" : "transparent",
              cursor: "pointer",
              marginBottom: 6,
              border: leftKey === ATTACHMENTS_ROOT_KEY ? "1px solid rgba(255,255,255,0.36)" : "1px solid transparent",
            }}
          >
            📁 Attachments
          </div>

          {visibleHomeFolders.map((f) => (
            <div
              key={f.id}
              onClick={() => {
                setLeftKey(f.key);
                setSelectedHomeSubfolder("");
                setSelectedHomeFileId("");
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                background: leftKey === f.key ? "rgba(255,255,255,0.24)" : "transparent",
                cursor: "pointer",
                marginBottom: 4,
                fontSize: 14,
                border: leftKey === f.key ? "1px solid rgba(255,255,255,0.36)" : "1px solid transparent",
              }}
            >
              📂 {f.name}
            </div>
          ))}

          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 14, marginBottom: 8 }}>Sheets</div>
          {homeExcelFiles.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.8 }}>No sheets yet.</div>
          ) : (
            homeExcelFiles.map((f) => (
              <div
                key={f.id}
                onClick={() => {
                  setLeftKey(SHEETS_ROOT_KEY);
                  setSelectedHomeSubfolder("");
                  setSelectedHomeFileId(f.id);
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: selectedHomeFileId === f.id ? "rgba(255,255,255,0.24)" : "transparent",
                  cursor: "pointer",
                  marginBottom: 4,
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: selectedHomeFileId === f.id ? "1px solid rgba(255,255,255,0.36)" : "1px solid transparent",
                }}
              >
                <span>📊</span>
                <span style={{ wordBreak: "break-word" }}>{f.name}</span>
              </div>
            ))
          )}
        </section>

        {!isSheetsSelected && (
          <section
            style={{
              borderRadius: 14,
              border: "1px solid #f0deeb",
              background: CARD_SURFACE,
              padding: 12,
              minHeight: "calc(100vh - 116px)",
              boxShadow: "0 14px 30px rgba(63, 11, 28, 0.1)",
            }}
          >
            {isUnselected ? (
              <div style={{ color: "#64748b", marginTop: 30 }}>
                Select a folder or choose Attachments to view KPI-ID folders.
              </div>
            ) : isAttachmentsSelected ? (
              <>
                {!kpiId ? (
                  <div style={{ color: "#64748b", marginTop: 30 }}>Select KPI-ID from right panel.</div>
                ) : !selectedKpiSubfolder ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 18, color: BRAND_MAROON, marginBottom: 10 }}>
                      KPI-ID Folders
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                      {kpiSubfolders.map((s) => (
                        <button
                          key={s.key || s.id}
                          type="button"
                          onClick={() => {
                            setSelectedKpiSubfolder(s.key);
                            setSelectedKpiFileId("");
                          }}
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(123,18,68,0.16)",
                            background: "linear-gradient(145deg, #ffffff 0%, #fff4fa 100%)",
                            padding: "14px 12px",
                            textAlign: "left",
                            cursor: "pointer",
                            boxShadow: "0 10px 18px rgba(74,13,98,0.08)",
                          }}
                        >
                          <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
                          <div style={{ fontWeight: 700 }}>{s.name}</div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontWeight: 800, fontSize: 18, color: BRAND_MAROON }}>
                        {kpiSubfolders.find((x) => x.key === selectedKpiSubfolder)?.name || "Folder"}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedKpiSubfolder("");
                          setSelectedKpiFileId("");
                        }}
                        style={{
                          border: `1px solid ${BRAND_MAROON}`,
                          color: BRAND_MAROON,
                          background: "#fff",
                          borderRadius: 8,
                          padding: "6px 10px",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        Back to folders
                      </button>
                    </div>

                    {kpiFiles.length === 0 ? (
                      <div style={{ color: "#64748b", marginTop: 30 }}>No files in this folder.</div>
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                          gap: 18,
                        }}
                      >
                        {kpiFiles.map((f) => {
                          const ext = getFileExt(f.name);
                          const isImage = isImageExt(ext);
                          const isSelected = selectedKpiFileId === f.id;
                          return (
                            <div
                              key={f.id}
                              onClick={() => setSelectedKpiFileId(f.id)}
                              onDoubleClick={() => openFile(f.url)}
                              style={{
                                borderRadius: 12,
                                padding: 8,
                                cursor: "pointer",
                                background: isSelected ? "#fff7f9" : "transparent",
                                boxShadow: isSelected ? "0 8px 18px rgba(125,13,45,0.12)" : "none",
                              }}
                            >
                              <div
                                style={{
                                  width: "100%",
                                  aspectRatio: "1 / 1",
                                  borderRadius: 12,
                                  border: isSelected ? `1.5px solid ${BRAND_MAROON}` : "1px solid #e7e2e7",
                                  background: "#faf7fb",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  overflow: "hidden",
                                }}
                              >
                                {isImage && f.url ? (
                                  <img
                                    src={f.url}
                                    alt={f.name}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  <div style={{ textAlign: "center", color: "#7b2d4c" }}>
                                    <div style={{ fontSize: 30 }}>📄</div>
                                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                                      {ext ? ext.toUpperCase() : "FILE"}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div
                                style={{
                                  marginTop: 8,
                                  fontWeight: 700,
                                  fontSize: 13,
                                  wordBreak: "break-word",
                                  textAlign: "center",
                                }}
                              >
                                {f.name}
                              </div>
                              {isSelected && (
                                <div style={{ fontSize: 12, color: "#475569", marginTop: 6, lineHeight: 1.4, textAlign: "center" }}>
                                  <div>Uploaded by {f.createdByName || "Unknown"}</div>
                                  <div>{formatDateTime(f.createdAt || f.uploadedAt)}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ fontWeight: 800, fontSize: 18, color: BRAND_MAROON, marginBottom: 8 }}>
                  {selectedHomeFolder?.name || "Folder"}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedHomeSubfolder("");
                      setSelectedHomeFileId("");
                    }}
                    style={{
                      borderRadius: 999,
                      border: "1px solid #d0d7de",
                      background: selectedHomeSubfolder ? "#fff" : "#fff1f3",
                      color: selectedHomeSubfolder ? "#334155" : BRAND_MAROON,
                      fontWeight: 700,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Root
                  </button>
                  {homeSubfolders.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedHomeSubfolder(s.key);
                        setSelectedHomeFileId("");
                      }}
                      style={{
                        borderRadius: 999,
                        border: "1px solid #d0d7de",
                        background: selectedHomeSubfolder === s.key ? "#fff1f3" : "#fff",
                        color: selectedHomeSubfolder === s.key ? BRAND_MAROON : "#334155",
                        fontWeight: 700,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                {homeFiles.length === 0 ? (
                  <div style={{ color: "#64748b", marginTop: 30 }}>No documents yet.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    {homeFiles
                      .filter((f) => f.type !== "excel")
                      .map((f) => (
                        <div
                          key={f.id}
                          onClick={() => setSelectedHomeFileId(f.id)}
                          onDoubleClick={() => openFile(f.url)}
                          style={{
                            borderRadius: 12,
                            border: selectedHomeFileId === f.id ? `1px solid ${BRAND_MAROON}` : "1px solid #e2e8f0",
                            padding: 10,
                            cursor: "pointer",
                            background: "#fff",
                          }}
                        >
                          <div style={{ fontSize: 24 }}>📄</div>
                          <div style={{ fontWeight: 700, marginTop: 6, wordBreak: "break-word" }}>{f.name}</div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                            {f.visibility === "forMe" ? "For Me" : "For Everyone"}
                          </div>
                          {selectedHomeFileId === f.id && (
                            <div style={{ fontSize: 12, color: "#475569", marginTop: 6, lineHeight: 1.4 }}>
                              <div>Uploaded by {f.createdByName || "Unknown"}</div>
                              <div>{formatDateTime(f.createdAt || f.uploadedAt)}</div>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <section
          style={{
            borderRadius: 14,
            border: "1px solid #f0deeb",
            background: CARD_SURFACE,
            padding: 12,
            minHeight: "calc(100vh - 116px)",
            boxShadow: "0 14px 30px rgba(63, 11, 28, 0.1)",
            gridColumn: isSheetsSelected ? "2 / span 1" : "auto",
          }}
        >
          {isAttachmentsSelected ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 17, color: BRAND_MAROON, marginBottom: 8 }}>KPI-ID Library</div>
              <input
                placeholder="Search KPI-ID / customer"
                value={search ?? ""}
                onChange={(e) => setSearch(String(e.target.value || ""))}
                style={{
                  width: "100%",
                  marginBottom: 10,
                  borderRadius: 8,
                  border: "1px solid #d0d7de",
                  padding: "8px 10px",
                }}
              />

              <div style={{ maxHeight: "62vh", overflowY: "auto" }}>
                {kpiRows.map((k) => (
                  <div
                    key={k.kpiId}
                    onClick={() => {
                      setKpiId(k.kpiId);
                      setCustomerName(k.customerName || "");
                      setSelectedKpiSubfolder(initialSubfolder || "");
                      setSelectedKpiFileId("");
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      cursor: "pointer",
                      marginBottom: 6,
                      border: kpiId === k.kpiId ? `1px solid ${BRAND_MAROON}` : "1px solid #e2e8f0",
                      background: kpiId === k.kpiId ? "linear-gradient(160deg, #fff1f6 0%, #f8efff 100%)" : "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      boxShadow: kpiId === k.kpiId ? "0 8px 16px rgba(122, 17, 69, 0.12)" : "none",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{k.kpiId}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{k.customerName || "-"}</div>
                    </div>
                    {isAdmin && kpiId === k.kpiId && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteKpiFolder(e, k)}
                        title={`Delete ${k.kpiId}`}
                        style={{
                          border: "1px solid #fecaca",
                          color: "#b91c1c",
                          background: "#fff1f2",
                          borderRadius: 8,
                          padding: "4px 8px",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : isHomeFolderSelected || isSheetsSelected ? (
            selectedHomeFile?.type === "excel" && selectedHomeFile?.url ? (
              <div style={{ height: "68vh", display: "flex", flexDirection: "column" }}>
                <div style={{ fontWeight: 800, fontSize: 17, color: BRAND_MAROON, marginBottom: 8 }}>
                  {selectedHomeFile?.name || "Sheet"}
                </div>
                {!selectedSheetInfo.isCreate && !selectedSheetInfo.isPublished && (
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                    Showing the editable view. If the preview stays blank, click “Open in Google Sheets” and (optionally)
                    publish the sheet to web, then update the link for a stable preview.
                  </div>
                )}
                {selectedSheetInfo.isCreate ? (
                  <div
                    style={{
                      flex: 1,
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      padding: 24,
                      color: "#475569",
                      background: "#fff",
                    }}
                  >
                    This is a Google Sheets create link. Click “Open in Google Sheets” to create it, then paste the new sheet link.
                  </div>
                ) : !showSheetPreview ? (
                  <div
                    style={{
                      flex: 1,
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      padding: 24,
                      color: "#475569",
                      background: "#fff",
                      gap: 10,
                    }}
                  >
                    <div>Preview is paused to avoid long blank loads.</div>
                    <button
                      type="button"
                      onClick={() => setShowSheetPreview(true)}
                      style={{
                        border: `1px solid ${BRAND_MAROON}`,
                        color: BRAND_MAROON,
                        background: "#fff",
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Load preview
                    </button>
                  </div>
                ) : (
                  <iframe
                    key={selectedHomeFile?.url || selectedHomeFile?.id}
                    title={selectedHomeFile?.name || "Google Sheet"}
                    src={getSheetPreviewUrl(selectedHomeFile.url)}
                    style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, width: "100%" }}
                    allow="clipboard-read; clipboard-write"
                  />
                )}
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleDeleteSheet}
                    style={{
                      border: "1px solid #fecaca",
                      color: "#b91c1c",
                      background: "#fff1f2",
                      borderRadius: 8,
                      padding: "8px 12px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Delete Sheet
                  </button>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginLeft: "auto" }}>
                  <button
                    type="button"
                    onClick={() => {
                      const openUrl = getSheetOpenUrl(selectedHomeFile.url);
                      if (openUrl) openSheetInNewTab(openUrl);
                    }}
                    style={{
                      border: `1px solid ${BRAND_MAROON}`,
                      color: BRAND_MAROON,
                      background: "#fff",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Open in Google Sheets
                  </button>
                  {!selectedSheetInfo.isCreate && (
                    <button
                      type="button"
                      onClick={() => setShowSheetPreview((prev) => !prev)}
                      style={{
                        border: "1px solid #cbd5f5",
                        color: "#1f2a8a",
                        background: "#eef2ff",
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      {showSheetPreview ? "Hide Preview" : "Show Preview"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleUpdateSheetLink}
                    style={{
                      border: `1px solid ${BRAND_MAROON}`,
                      color: BRAND_MAROON,
                      background: "#fff",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Update Sheet Link
                  </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: BRAND_MAROON }}>Folder Info</div>
                  {(isAdmin || String(selectedHomeFolder?.createdByUid || "").trim() === String(user?.uid || "").trim()) && (
                    <button
                      type="button"
                      onClick={handleDeleteHomeFolder}
                      style={{
                        border: "1px solid #fecaca",
                        color: "#b91c1c",
                        background: "#fff1f2",
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Delete Folder
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
                  <div><b>Name:</b> {selectedHomeFolder?.name || "-"}</div>
                  <div><b>Visibility:</b> {selectedHomeFolder?.visibility === "forMe" ? "For Me" : "For Everyone"}</div>
                  <div><b>Subfolders:</b> {homeSubfolders.length}</div>
                  <div><b>Documents:</b> {homeFiles.length}</div>
                </div>
              </>
            )
          ) : null}
        </section>
      </div>

      {showContextCreateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 16,
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width: "min(520px, 94vw)",
              background: "linear-gradient(180deg, #ffffff 0%, #fff6f8 100%)",
              borderRadius: 20,
              border: "1px solid #f0c9d4",
              padding: "20px 22px",
              boxShadow: "0 18px 40px rgba(63, 11, 28, 0.22)",
            }}
          >
            <div
              style={{
                fontWeight: 800,
                color: BRAND_MAROON,
                marginBottom: 12,
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              ✨ Create Item
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Type</label>
                <select
                  value={contextCreateType ?? "folder"}
                  onChange={(e) => setContextCreateType(String(e.target.value || "folder"))}
                  style={{
                    width: "100%",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    borderRadius: 12,
                    border: "1px solid #e3b1c0",
                    padding: "11px 14px",
                    background: "#fff",
                    fontSize: 15,
                  }}
                >
                  <option value="folder">Folder</option>
                  <option value="excel">Excel (Google Sheet)</option>
                </select>
              </div>

              {contextCreateType === "folder" && selectedHomeFolder?.key && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={contextCreateInsideFolder}
                    onChange={(e) => setContextCreateInsideFolder(e.target.checked)}
                  />
                  Create inside selected folder
                </label>
              )}

              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
                  {contextCreateType === "excel" ? "Sheet Name" : "Folder Name"}
                </label>
                <input
                  value={contextCreateName ?? ""}
                  onChange={(e) => setContextCreateName(String(e.target.value || ""))}
                  placeholder={contextCreateType === "excel" ? "e.g. Payment Tracker" : "e.g. 2026 Docs"}
                  style={{
                    width: "100%",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    borderRadius: 12,
                    border: "1px solid #e3b1c0",
                    padding: "11px 14px",
                    background: "#fff",
                    fontSize: 15,
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Visibility</label>
                <select
                  value={contextCreateVisibility ?? "everyone"}
                  onChange={(e) => setContextCreateVisibility(String(e.target.value || "everyone"))}
                  style={{
                    width: "100%",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    borderRadius: 12,
                    border: "1px solid #e3b1c0",
                    padding: "11px 14px",
                    background: "#fff",
                    fontSize: 15,
                  }}
                >
                  <option value="everyone">For Everyone</option>
                  <option value="forMe">For Me</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setShowContextCreateModal(false)}
                style={{ border: `1px solid ${BRAND_MAROON}`, color: BRAND_MAROON, background: "#fff", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateContextItem}
                style={{ border: "none", color: "#fff", background: BRAND_MAROON, borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700 }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 1100px) {
          .attachments-grid { grid-template-columns: 1fr !important; }
        }

        @media (max-width: 768px) {
          .attachments-topbar {
            flex-wrap: nowrap !important;
            align-items: center !important;
            gap: 8px !important;
            padding: 8px 9px !important;
          }

          .attachments-topbar-left {
            min-width: 0;
            flex: 1;
            gap: 6px !important;
          }

          .attachments-topbar-actions {
            flex-wrap: nowrap !important;
            gap: 6px !important;
            margin-left: auto;
          }

          .attachments-back-btn,
          .attachments-create-btn {
            padding: 6px 10px !important;
            font-size: 13px !important;
            border-radius: 8px !important;
            white-space: nowrap;
          }

          .attachments-title {
            font-size: 16px !important;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }

        @media (max-width: 520px) {
          .attachments-topbar {
            padding: 7px 8px !important;
            gap: 6px !important;
          }

          .attachments-topbar-actions select {
            display: none;
          }

          .attachments-back-btn,
          .attachments-create-btn {
            padding: 6px 8px !important;
            font-size: 12px !important;
          }

          .attachments-title {
            font-size: 15px !important;
          }
        }
      `}</style>
    </div>
  );
}