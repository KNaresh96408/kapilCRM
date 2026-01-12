import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

import {
  getStorage,
  ref,
  listAll,
  getDownloadURL,
} from "firebase/storage";

import JSZip from "jszip";
import { saveAs } from "file-saver";

const printStyles = `
@media print {

  /* Hide everything by default */
  body * {
    visibility: hidden;
  }

  /* Show only report */
  .print-area, .print-area * {
    visibility: visible;
  }

  .print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }

  /* Hide buttons */
  .no-print {
    display: none !important;
  }

  @page {
    size: A4;
    margin: 12mm;
  }
}
`;

export default function SurveyReportView() {
  const { dealId } = useParams();
  const [data, setData] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  const styleTag = <style>{printStyles}</style>;   // ✅ IMPORTANT

  useEffect(() => {
    loadReport();
    loadFiles();
  }, []);

  async function loadReport() {
    try {
      const snap = await getDoc(doc(db, "deals", dealId));

      if (!snap.exists()) setData(null);
      else setData(snap.data());

      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  async function loadFiles() {
    try {
      const storage = getStorage();
      const folderRef = ref(
        storage,
        `deals/${dealId}/attachments/siteSurveyReport`
      );

      const result = await listAll(folderRef);

      const urls = await Promise.all(
        result.items.map(async (item) => ({
          name: item.name.toLowerCase(),
          url: await getDownloadURL(item),
        }))
      );

      setFiles(urls);
    } catch (err) {
      console.error("Files load failed", err);
    }
  }

  function getFile(name) {
    return files.find((f) => f.name.includes(name))?.url;
  }

  function render(name, label) {
    const file = getFile(name);
    if (!file) return null;

    return (
      <div style={styles.fileRow}>
        <span>{label}</span>
        <a href={file} target="_blank" rel="noreferrer" style={styles.openBtn}>
          OPEN
        </a>
      </div>
    );
  }

  async function downloadZip() {
    if (!files.length) return alert("No attachments found");

    const zip = new JSZip();

    for (let f of files) {
      const res = await fetch(f.url);
      const blob = await res.blob();
      zip.file(f.name, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `SiteSurvey_${dealId}.zip`);
  }

  function printPage() {
    window.print();
  }

  if (loading) return <h3 style={{ padding: 20 }}>Loading...</h3>;

  if (!data?.siteSurveyStatus || data.siteSurveyStatus !== "completed")
    return (
      <h3 style={{ padding: 20, color: "red" }}>
        No Survey Report Found
      </h3>
    );

  const s = data.siteSurveyForm || {};

  const visitDate = data.siteSurveyCompletedOn
    ? new Date(data.siteSurveyCompletedOn).toLocaleDateString()
    : "-";

  const submittedBy = s.submittedBy || data.assignedConsultant || "-";
  const submittedOn = s.submittedOn || visitDate;

  const teleSales =
    data.teleExecutive ||
    data.teleSales ||
    data.tele ||
    "-";

  return (
    <>
      {styleTag}

      <div style={styles.pageContainer}>
        <div style={styles.page} className="print-area">
          <h1 style={styles.title}>Site Survey Report</h1>

          {/* ACTION BUTTONS */}
          <div style={styles.actionBar} className="no-print">
            <button style={styles.actionBtn} onClick={printPage}>
              🖨 Print / Save PDF
            </button>

            <button style={styles.actionBtn} onClick={downloadZip}>
              📎 Download All Attachments
            </button>
          </div>

          {/* CUSTOMER */}
          <Box title="Customer Details">
            <Row label="KPI ID" value={data.kpiId} />
            <Row label="Customer" value={data.name} />
            <Row label="Phone" value={data.phone} />
            <Row label="Location" value={data.location} />
            <Row label="Consultant" value={data.assignedConsultant || "-"} />
            <Row label="Tele-Sales" value={teleSales} />
            <Row label="Visit Date" value={visitDate} />
          </Box>

          {/* ELECTRICAL */}
          <Box title="Electrical Details">
            <Row label="Contracted Load" value={s.load} />
            <Row label="Monthly Bill" value={s.billAmount} />
            {render("power", "Power Bill")}
          </Box>

          {/* BUILDING */}
          <Box title="Building Details">
            <Row label="Length" value={s.length} />
            <Row label="Width" value={s.width} />
            <Row label="Height" value={s.height} />
            <Row label="Floors" value={s.floors} />
            <Row label="Roof Type" value={s.roofType} />
            <Row label="Project Type" value={s.projectType} />
          </Box>

          {/* MANDATORY */}
          <Box title="Mandatory Site Photos">
            {render("north", "North View")}
            {render("south", "South View")}
            {render("east", "East View")}
            {render("west", "West View")}
          </Box>

          {/* ADDITIONAL */}
          <Box title="Additional Photos">
            {render("hand", "Hand Sketch")}
            {render("inverter", "Inverter")}
            {render("meter", "Meter")}
            {render("earthing", "Earthing")}
            {render("outside", "Outside")}
            {render("roof", "Rooftop Video")}
          </Box>

          {/* SUBMISSION */}
          <Box title="Submission Details">
            <Row label="Submitted By" value={submittedBy} />
            <Row label="Submitted On" value={submittedOn} />
            <p style={{ color: "red", fontWeight: "bold" }}>
              Locked — Cannot Edit
            </p>
          </Box>
        </div>
      </div>
    </>
  );
}

/* ---------- UI COMPONENTS ---------- */

function Box({ title, children }) {
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <p style={styles.row}>
      <b>{label}: </b> {value || "-"}
    </p>
  );
}

/* ---------- STYLES ---------- */

const styles = {
  pageContainer: {
    height: "100vh",
    overflowY: "auto",
    background: "#fafafa",
  },
  page: {
    maxWidth: 950,
    margin: "auto",
    padding: 20,
  },
  title: {
    textAlign: "center",
    color: "#800000",
    marginBottom: 15,
  },

  actionBar: {
    display: "flex",
    gap: 10,
    justifyContent: "center",
    marginBottom: 15,
  },

  actionBtn: {
    background: "#800000",
    color: "white",
    borderRadius: 6,
    padding: "8px 14px",
    border: "none",
    cursor: "pointer",
  },

  card: {
    background: "white",
    borderRadius: 10,
    border: "1px solid #ccc",
    padding: 18,
    marginTop: 18,
    boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
  },

  cardTitle: {
    margin: 0,
    marginBottom: 10,
    color: "#800000",
  },

  row: {
    margin: "6px 0",
  },

  fileRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    margin: "6px 0",
  },

  openBtn: {
    padding: "4px 10px",
    background: "#800000",
    color: "white",
    borderRadius: 6,
    textDecoration: "none",
  },
};
