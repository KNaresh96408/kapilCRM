// ✅ src/components/PDFPreviewModal.jsx
import React, { useRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const PDFPreviewModal = ({ open, onClose, quotationData }) => {
  const pdfRef = useRef();
  const maroon = "#800000";

  if (!open) return null;

  const handleDownload = async () => {
    const input = pdfRef.current;
    const canvas = await html2canvas(input, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, imgHeight);
    pdf.save(`${quotationData.customerName}_Quotation.pdf`);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "10px",
          width: "80%",
          height: "85%",
          overflowY: "auto",
          boxShadow: "0 0 20px rgba(0,0,0,0.2)",
          padding: "20px",
        }}
      >
        <div ref={pdfRef} style={{ padding: "20px", fontFamily: "Poppins" }}>
          <h2 style={{ color: maroon, textAlign: "center" }}>
            Kapil Power & Infra Pvt Ltd
          </h2>
          <p style={{ textAlign: "center", marginTop: "-8px" }}>
            Nanakramguda, Hyderabad | Ph: +91 9876543210
          </p>
          <hr style={{ margin: "10px 0", borderColor: maroon }} />

          <h3 style={{ color: maroon }}>Quotation</h3>
          <p>
            <strong>Customer:</strong> {quotationData.customerName} (
            {quotationData.customerPhone})
          </p>
          <p>
            <strong>Project Type:</strong> {quotationData.projectType} |{" "}
            <strong>Capacity:</strong> {quotationData.capacity} kW
          </p>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "15px",
              fontSize: "13px",
            }}
          >
            <thead style={{ background: maroon, color: "#fff" }}>
              <tr>
                <th style={{ padding: "8px" }}>Description</th>
                <th style={{ padding: "8px" }}>Rate (₹/kW)</th>
                <th style={{ padding: "8px" }}>Qty</th>
                <th style={{ padding: "8px" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: "#f7e6e6" }}>
                <td style={{ padding: "8px" }}>System Cost</td>
                <td style={{ padding: "8px" }}>
                  ₹{quotationData.systemCost.toLocaleString()}
                </td>
                <td style={{ padding: "8px" }}>{quotationData.capacity}</td>
                <td style={{ padding: "8px" }}>
                  ₹{(
                    quotationData.systemCost * quotationData.capacity
                  ).toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px" }}>Structure Cost</td>
                <td style={{ padding: "8px" }}>₹ 0</td>
                <td style={{ padding: "8px" }}>1</td>
                <td style={{ padding: "8px" }}>₹ 0</td>
              </tr>
            </tbody>
          </table>

          <p style={{ textAlign: "right", marginTop: "10px" }}>
            <strong>GST ({quotationData.gst}%)</strong>: ₹
            {(
              (quotationData.systemCost *
                quotationData.capacity *
                quotationData.gst) /
              100
            ).toLocaleString()}
          </p>
          <p style={{ textAlign: "right" }}>
            <strong>Subsidy</strong>: ₹{quotationData.subsidy || 0}
          </p>
          <p
            style={{
              textAlign: "right",
              color: maroon,
              fontWeight: "bold",
              fontSize: "16px",
            }}
          >
            Total = ₹
            {(
              quotationData.systemCost * quotationData.capacity +
              (quotationData.systemCost *
                quotationData.capacity *
                quotationData.gst) /
                100 -
              quotationData.subsidy
            ).toLocaleString()}
          </p>

          <hr style={{ margin: "10px 0", borderColor: maroon }} />
          <p>
            <strong>Amount in Words:</strong>{" "}
            {quotationData.amountInWords || ""}
          </p>
          <p style={{ marginTop: "40px", textAlign: "right" }}>
            <strong>Authorized Signatory</strong>
            <br />
            Kapil Power & Infra Pvt Ltd
          </p>
        </div>

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "10px",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "gray",
              color: "white",
              border: "none",
              padding: "10px 20px",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            style={{
              background: maroon,
              color: "white",
              border: "none",
              padding: "10px 20px",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
};

export default PDFPreviewModal;
