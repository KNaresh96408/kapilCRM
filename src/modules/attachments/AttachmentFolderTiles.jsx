import { useNavigate } from "react-router-dom";
import { DEFAULT_SUBFOLDERS } from "../../modules/attachments/constants/defaultSubfolders";
import { deleteKpiSubfolderContents } from "../../modules/attachments/services/attachmentsService";
import { isAdminSessionUser } from "../../helpers/bulkImport";

export default function AttachmentFolderTiles({ kpiId, customerName, from = "deals" }) {
  const navigate = useNavigate();
  const session = (() => {
    try {
      return JSON.parse(localStorage.getItem("kp-user") || "null");
    } catch {
      return null;
    }
  })();
  const uid = String(session?.uid || session?.profile?.uid || "").trim();
  const role = String(
    session?.role ||
      session?.Role ||
      session?.customRole ||
      session?.CustomRole ||
      session?.profile?.role ||
      session?.profile?.Role ||
      session?.profile?.customRole ||
      session?.profile?.CustomRole ||
      ""
  ).toLowerCase();
  const canDelete = role.includes("admin") || isAdminSessionUser() || uid === "26VHcREEDMMg8C24kXYVGzRXHe43";

  const openFolder = (subfolder) => {
    const qs = new URLSearchParams({
      kpiId: String(kpiId || ""),
      customerName: String(customerName || ""),
      subfolder,
      from,
    });
    navigate(`/crm/attachments?${qs.toString()}`);
  };

  const handleDeleteFolder = async (e, subfolder) => {
    e.preventDefault();
    e.stopPropagation();

    if (!kpiId) return alert("KPI ID not found.");

    const label = DEFAULT_SUBFOLDERS.find((x) => x.key === subfolder)?.label || "this folder";
    const ok = window.confirm(`Delete all files in "${label}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteKpiSubfolderContents({ kpiId, subfolderKey: subfolder });
      alert("Folder cleared.");
    } catch (err) {
      console.error("Delete folder contents failed", err);
      alert("Failed to delete folder contents.");
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(140px, 1fr))", gap: 12 }}>
      {DEFAULT_SUBFOLDERS.map((f) => (
        <div key={f.key} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => openFolder(f.key)}
            style={{
              width: "100%",
              border: "1px solid rgba(255,255,255,0.26)",
              borderRadius: 16,
              padding: 14,
              textAlign: "left",
              background: "linear-gradient(150deg, #9a1022 0%, #7b1244 52%, #4a0d62 100%)",
              color: "#fff",
              cursor: "pointer",
              boxShadow: "0 14px 24px rgba(74,13,98,0.22)",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.2px" }}>{f.label}</div>
            <div style={{ fontSize: 11, opacity: 0.88, marginTop: 4 }}>
              Open {kpiId || "KPI"} folder
            </div>
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={(e) => handleDeleteFolder(e, f.key)}
              title={`Delete ${f.label}`}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.35)",
                background: "rgba(255,255,255,0.14)",
                color: "#fff",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                fontSize: 14,
              }}
            >
              🗑️
            </button>
          )}
        </div>
      ))}
    </div>
  );
}