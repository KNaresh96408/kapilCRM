// src/components/QuotationPDFLayout.jsx
import React, { useRef, useEffect, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import Chart from "chart.js/auto";

// Firebase imports (kept but NOT used for convert)
import { db } from "../firebaseConfig";
import {
  doc,
  getDoc,
  addDoc,
  deleteDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const SCALE = 2;

const Page = ({ bgImageUrl, children }) => (
  <div
    className="pdf-page"
    style={{
      width: `${A4_WIDTH}px`,
      minHeight: `${A4_HEIGHT}px`,
      background: "#fff",
      position: "relative",
      overflow: "hidden",
      margin: "0 auto 18px",
      boxSizing: "border-box",
      backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      padding: 24,
    }}
  >
    {children}
  </div>
);

const QuotationPDFLayout = ({ quotationData = {}, onClose }) => {
  const pdfRef = useRef(null);
  const chartRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loadingImages, setLoadingImages] = useState(true);
  const [chartInstance, setChartInstance] = useState(null);

  const proposalImages = Array.from({ length: 8 }, (_, i) => `/proposal/${i + 1}.png`);

  useEffect(() => {
    Promise.all(
      proposalImages.map(
        (src) =>
          new Promise((res) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => res(true);
            img.onerror = () => res(false);
            img.src = src + "?v=" + Date.now();
          })
      )
    ).then(() => setLoadingImages(false));
  }, []);

  // CHART
  useEffect(() => {
    if (!chartRef.current) return;
    const ctx = chartRef.current.getContext("2d");

    const yearlyConsumption = 30000;
    const solarGeneration = 1825;
    const pricePerUnit = 6.3;
    const yearlyIncrement = 2;
    const years = 25;

    const labels = [];
    const before = [];
    const after = [];
    let p = pricePerUnit;

    for (let i = 1; i <= years; i++) {
      labels.push(i);
      before.push(Math.round(yearlyConsumption * p));
      after.push(Math.round((yearlyConsumption - solarGeneration) * p));
      p *= 1 + yearlyIncrement / 100;
    }

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Bill Before Solar",
            data: before,
            backgroundColor: "#2c7fb8",
            barThickness: 10,
          },
          {
            label: "Bill After Solar",
            data: after,
            backgroundColor: "#b33f3f",
            barThickness: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: {
            ticks: {
              callback: (v) => "₹" + v.toLocaleString(),
            },
          },
        },
      },
    });

    setChartInstance(chart);
    return () => chart.destroy();
  }, []);

  const makePDF = async () => {
    setGenerating(true);
    const pdf = new jsPDF("p", "mm", "a4");
    const pages = pdfRef.current.querySelectorAll(".pdf-page");

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: SCALE,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const img = canvas.toDataURL("image/jpeg", 1.0);
      const width = pdf.internal.pageSize.getWidth();
      const height = (canvas.height * width) / canvas.width;

      if (i) pdf.addPage();
      pdf.addImage(img, "JPEG", 0, 0, width, height);
    }

    setGenerating(false);
    return pdf;
  };

  const handlePreview = async () => {
    try {
      const pdf = await makePDF();
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (err) {
      console.error("Preview error:", err);
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    try {
      const pdf = await makePDF();
      pdf.save(`${quotationData.customerName || "quotation"}.pdf`);
    } catch (err) {
      console.error("Download error:", err);
      setGenerating(false);
    }
  };

  const safeNum = (v) => (isNaN(Number(v)) ? 0 : Number(v));

  const systemCost = safeNum(quotationData.systemCost);
  const capacity = safeNum(quotationData.capacity);
  const gst = safeNum(quotationData.gst);
  const subsidy = safeNum(quotationData.subsidy);

  const systemTotal = Math.round(systemCost * capacity);
  const gstValue = Math.round((systemTotal * gst) / 100);
  const grandTotal = systemTotal + gstValue - subsidy;

  const CustomerDetailsBox = () => (
    <div
      style={{
        width: "100%",
        marginTop: 40,
        padding: 20,
        borderRadius: 12,
        background: "#e6f6f8",
        position: "relative",
      }}
    >
      <div
        style={{
          background: "#19719a",
          padding: "8px 14px",
          borderRadius: "10px 10px 0px 0px",
          color: "#fff",
          fontWeight: 700,
          fontSize: 16,
          marginBottom: 0,
          position: "absolute",
          top: -28,
          left: 0,
          width: "100%",
        }}
      >
        Customer Details & System Summary
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", marginBottom: 8 }}>
          <div style={{ width: "28%", fontWeight: 700 }}>Customer</div>
          <div style={{ width: "72%" }}>
            {quotationData.customerName} ({quotationData.customerPhone})
          </div>
        </div>

        <div style={{ display: "flex", marginBottom: 8 }}>
          <div style={{ width: "28%", fontWeight: 700 }}>Address</div>
          <div style={{ width: "72%" }}>{quotationData.location}</div>
        </div>

        <div style={{ display: "flex", marginBottom: 8 }}>
          <div style={{ width: "28%", fontWeight: 700 }}>System Size</div>
          <div style={{ width: "72%" }}>{capacity} kW</div>
        </div>

        <div style={{ display: "flex", marginBottom: 8 }}>
          <div style={{ width: "28%", fontWeight: 700 }}>Panel</div>
          <div style={{ width: "72%" }}>
            {quotationData.panelBrand} | {quotationData.panelWatt} |{" "}
            {quotationData.panelType}
          </div>
        </div>

        <div style={{ marginTop: 12, paddingLeft: 10 }}>
  <ul style={{ margin: 0, paddingLeft: 20 }}>
    <li style={{ marginBottom: 4 }}>
      High-efficiency solar panels for optimal generation.
    </li>
    <li style={{ marginBottom: 4 }}>
      Smart inverter with advanced monitoring.
    </li>
    <li style={{ marginBottom: 4 }}>
      Durable hot-dip galvanized structure.
    </li>
    <li style={{ marginBottom: 4 }}>
      Includes full Balance of System & electrical safety components.
    </li>
  </ul>
</div>

        <div style={{ display: "flex", marginBottom: 8 }}>
          <div style={{ width: "28%", fontWeight: 700 }}>Inverter</div>
          <div style={{ width: "72%" }}>
            {quotationData.inverterBrand} | {quotationData.inverterSize}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "95%",
          height: "95%",
          background: "#fff",
          borderRadius: 8,
          overflow: "auto",
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 10,
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              border: "1px solid #b33f3f",
              background: "transparent",
              color: "#b33f3f",
              padding: "6px 10px",
              borderRadius: 6,
            }}
          >
            ✕ Close
          </button>

          <div style={{ flex: 1 }} />

          <button
            disabled={generating || loadingImages}
            onClick={handlePreview}
            style={{
              background: "#2c9ad1",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: 6,
            }}
          >
            {generating ? "Generating..." : "Generate Preview"}
          </button>

          <button
            disabled={!previewUrl || generating}
            onClick={handleDownload}
            style={{
              background: "#b33f3f",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: 6,
            }}
          >
            Download PDF
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, height: "90%" }}>
          {/* LEFT */}
          <div
            style={{
              width: "48%",
              overflowY: "auto",
              border: "1px solid #eee",
              padding: 8,
            }}
          >
            <div ref={pdfRef}>
              {proposalImages.slice(0, 4).map((img, i) => (
                <Page key={i} bgImageUrl={img} />
              ))}

              {/* PAGE 5 */}
              <Page bgImageUrl={proposalImages[4]}>
                <div
                  style={{
                    position: "absolute",
                    bottom: 60,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "85%",
                    height: 260,
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 8,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      textAlign: "center",
                      color: "#b33f3f",
                      fontWeight: 700,
                      marginBottom: 6,
                    }}
                  >
                    Solar Savings Graph
                  </div>
                  <canvas ref={chartRef} style={{ width: "100%", height: "210px" }} />
                </div>
              </Page>

              {/* PAGE 6 */}
              <Page bgImageUrl={proposalImages[5]}>
                <div style={{ marginBottom: 20 }}>
                  <CustomerDetailsBox />
                </div>

                <div style={{ marginTop: 20 }}>
                  <div
                    style={{
                      border: "1px solid #b33f3f",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background: "#2c9ad1",
                        color: "#fff",
                        display: "flex",
                        justifyContent: "space-between",
                        fontWeight: 700,
                        padding: "8px 12px",
                      }}
                    >
                      <div style={{ width: "40%" }}>Description</div>
                      <div style={{ width: "20%", textAlign: "center" }}>
                        Price per kW
                      </div>
                      <div style={{ width: "10%", textAlign: "center" }}>Qty</div>
                      <div style={{ width: "20%", textAlign: "right" }}>
                        Subtotal
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#fff",
                        display: "flex",
                        padding: "8px 12px",
                      }}
                    >
                      <div style={{ width: "40%" }}>System Cost</div>
                      <div style={{ width: "20%", textAlign: "center" }}>
                        ₹{systemCost.toLocaleString()}
                      </div>
                      <div style={{ width: "10%", textAlign: "center" }}>{capacity}</div>
                      <div style={{ width: "20%", textAlign: "right" }}>
                        ₹{systemTotal.toLocaleString()}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#eef7f9",
                        display: "flex",
                        padding: "8px 12px",
                      }}
                    >
                      <div style={{ width: "40%" }}>Structure Cost</div>
                      <div style={{ width: "20%", textAlign: "center" }}>₹0</div>
                      <div style={{ width: "10%", textAlign: "center" }}>1</div>
                      <div style={{ width: "20%", textAlign: "right" }}>₹0</div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        padding: "8px 12px",
                        background: "#fff",
                      }}
                    >
                      <div style={{ width: "40%", fontWeight: 600 }}>Subtotal</div>
                      <div style={{ width: "20%" }}></div>
                      <div style={{ width: "10%" }}></div>
                      <div style={{ width: "20%", textAlign: "right" }}>
                        ₹{systemTotal.toLocaleString()}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        padding: "8px 12px",
                        background: "#eef7f9",
                      }}
                    >
                      <div style={{ width: "40%", fontWeight: 600 }}>
                        Tax GST ({gst}%)
                      </div>
                      <div style={{ width: "20%" }}></div>
                      <div style={{ width: "10%" }}></div>
                      <div style={{ width: "20%", textAlign: "right" }}>
                        ₹{gstValue.toLocaleString()}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#2c9ad1",
                        color: "#fff",
                        fontWeight: 700,
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                      }}
                    >
                      <div>Total</div>
                      <div>₹{grandTotal.toLocaleString()}</div>
                    </div>
                  </div>

                  <p style={{ marginTop: 6, fontWeight: 700 }}>
                    Amount in Words: {quotationData.amountInWords}
                  </p>
                </div>
              </Page>

              {/* PAGES 7–8 */}
              {proposalImages.slice(6).map((img, i) => (
                <Page key={i + 6} bgImageUrl={img} />
              ))}
            </div>
          </div>

          {/* RIGHT preview */}
          <div
            style={{
              flex: 1,
              border: "1px solid #eee",
              borderRadius: 6,
            }}
          >
            {previewUrl ? (
              <iframe
                src={previewUrl}
                title="preview"
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            ) : (
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 12 }}>
                  <strong>Customer:</strong> {quotationData.customerName} (
                  {quotationData.customerPhone})
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>System Size:</strong> {capacity} kW
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>Panel:</strong> {quotationData.panelBrand} |{" "}
                  {quotationData.panelWatt} | {quotationData.panelType}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>Inverter:</strong> {quotationData.inverterBrand} |{" "}
                  {quotationData.inverterSize}
                </div>

                <div style={{ marginTop: 20 }}>
                  Click <b>Generate Preview</b> to build the PDF.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuotationPDFLayout;
