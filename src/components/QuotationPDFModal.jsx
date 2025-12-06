import React, { useRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const QuotationPDFModal = ({ data, onClose }) => {
  const pdfRef = useRef();

  const handleDownloadPDF = async () => {
    const element = pdfRef.current;
    const canvas = await html2canvas(element, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const width = pdf.internal.pageSize.getWidth();
    const height = (canvas.height * width) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, width, height);
    pdf.save(`Quotation-${data.customerName}.pdf`);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: "800px",
          height: "90vh",
          backgroundColor: "#fff",
          borderRadius: "10px",
          overflowY: "auto",
          padding: "20px",
        }}
      >
        <div ref={pdfRef} style={{ fontFamily: "Poppins" }}>
          <h2 style={{ textAlign: "center" }}>Offer for {data.customerName}</h2>
          <p style={{ textAlign: "center" }}>System Size: {data.capacity} kW</p>
          <p style={{ textAlign: "center" }}>Quotation ID: {data.quotationId || "Draft"}</p>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "20px",
              fontSize: "14px",
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#247ba0", color: "white" }}>
                <th style={{ padding: "10px" }}>Description</th>
                <th style={{ padding: "10px" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "10px" }}>System Cost</td>
                <td style={{ padding: "10px" }}>₹{data.systemCost?.toLocaleString()}</td>
              </tr>
              <tr>
                <td style={{ padding: "10px" }}>GST ({data.gst}%)</td>
                <td style={{ padding: "10px" }}>₹{data.gstValue?.toLocaleString()}</td>
              </tr>
              <tr>
                <td style={{ padding: "10px" }}>Subsidy</td>
                <td style={{ padding: "10px" }}>₹{data.subsidy}</td>
              </tr>
              <tr style={{ fontWeight: "bold", backgroundColor: "#e6f3f9" }}>
                <td style={{ padding: "10px" }}>Total</td>
                <td style={{ padding: "10px" }}>₹{data.total?.toLocaleString()}</td>
              </tr>
              <tr>
                <td colSpan="2" style={{ padding: "10px", textAlign: "center" }}>
                  <strong>Amount in Words:</strong> {data.inWords}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "20px", textAlign: "center" }}>
          <button
            onClick={handleDownloadPDF}
            style={{
              backgroundColor: "#16a34a",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            ⬇️ Download PDF
          </button>
          <button
            onClick={onClose}
            style={{
              marginLeft: "10px",
              backgroundColor: "#ef4444",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            ❌ Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuotationPDFModal;
