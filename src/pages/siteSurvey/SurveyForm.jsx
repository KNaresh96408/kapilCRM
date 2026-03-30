import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db, storage } from "../../firebase/firebaseConfig";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_TARGET_SIZE_KB = 220;
const IMAGE_MIN_QUALITY = 0.45;
const VIDEO_MAX_DIMENSION = 960;
const VIDEO_TARGET_BITRATE = 350_000;
const VIDEO_FPS = 15;
const VIDEO_COMPRESS_TIMEOUT_MS = 15_000;
const RECOMMENDED_VIDEO_SIZE_MB = 80;

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (!value) return "0 KB";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const toSafeFileName = (name = "") => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "file";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const readImageFile = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = (e) => reject(e);
  img.src = URL.createObjectURL(file);
});

const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("image_blob_failed"))),
    mimeType,
    quality
  );
});

const compressImageFile = async (file) => {
  if (!file || !String(file.type || "").startsWith("image/")) return file;

  const image = await readImageFile(file);
  const ratio = Math.min(
    1,
    IMAGE_MAX_DIMENSION / Math.max(image.width || 1, image.height || 1)
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor((image.width || 1) * ratio));
  canvas.height = Math.max(1, Math.floor((image.height || 1) * ratio));

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return file;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  URL.revokeObjectURL(image.src);

  const targetBytes = IMAGE_TARGET_SIZE_KB * 1024;
  const mimeType = "image/jpeg";
  let quality = 0.86;
  let bestBlob = await canvasToBlob(canvas, mimeType, quality);

  while (bestBlob.size > targetBytes && quality > IMAGE_MIN_QUALITY) {
    quality = Math.max(IMAGE_MIN_QUALITY, quality - 0.08);
    bestBlob = await canvasToBlob(canvas, mimeType, quality);
    if (quality === IMAGE_MIN_QUALITY) break;
  }

  if (bestBlob.size >= file.size) return file;

  const compressedName = `${toSafeFileName(file.name).replace(/\.[^.]+$/, "") || "image"}.jpg`;
  return new File([bestBlob], compressedName, {
    type: mimeType,
    lastModified: Date.now(),
  });
};

const buildUploadName = (fallbackName, file) => {
  const original = String(file?.name || "").trim();
  const ext = original.includes(".") ? original.split(".").pop() : "";
  const fallbackExt = String(fallbackName || "").includes(".")
    ? String(fallbackName).split(".").pop()
    : "";
  const safeExt = (ext || fallbackExt || "bin").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const stem = String(fallbackName || "file").replace(/\.[^.]+$/, "");
  return `${toSafeFileName(stem)}.${safeExt || "bin"}`;
};

const selectMediaRecorderMimeType = () => {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  const options = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return options.find((x) => window.MediaRecorder.isTypeSupported?.(x)) || "";
};

const compressVideoFile = async (file) => {
  if (!file || !String(file.type || "").startsWith("video/")) return file;
  if (typeof window === "undefined" || typeof document === "undefined") return file;
  if (typeof window.MediaRecorder === "undefined") return file;

  const mimeType = selectMediaRecorderMimeType();
  if (!mimeType) return file;

  const objectUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video_metadata_failed"));
    });

    const srcW = Math.max(1, Number(video.videoWidth || 1));
    const srcH = Math.max(1, Number(video.videoHeight || 1));
    const ratio = Math.min(1, VIDEO_MAX_DIMENSION / Math.max(srcW, srcH));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.floor(srcW * ratio));
    canvas.height = Math.max(2, Math.floor(srcH * ratio));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return file;

    const stream = canvas.captureStream(VIDEO_FPS);
    const chunks = [];

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: VIDEO_TARGET_BITRATE,
    });

    const recordingDone = new Promise((resolve, reject) => {
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = () => reject(new Error("video_record_failed"));
      recorder.onstop = () => resolve();
    });

    let rafId = 0;
    const draw = () => {
      if (video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      rafId = window.requestAnimationFrame(draw);
    };

    const finished = new Promise((resolve) => {
      video.onended = () => resolve();
    });

    recorder.start(1000);
    await video.play();
    draw();

    await Promise.race([
      finished,
      new Promise((resolve) => setTimeout(resolve, VIDEO_COMPRESS_TIMEOUT_MS)),
    ]);

    window.cancelAnimationFrame(rafId);
    if (recorder.state !== "inactive") recorder.stop();
    await recordingDone;

    if (!chunks.length) return file;

    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size || blob.size >= file.size) return file;

    const ext = mimeType.includes("webm") ? "webm" : "mp4";
    const compressedName = `${toSafeFileName(file.name).replace(/\.[^.]+$/, "") || "video"}.${ext}`;
    return new File([blob], compressedName, {
      type: mimeType,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};



const SurveyForm = () => {
    const { dealId, token } = useParams();


  // ---------------- AUTO FILLED INFO ----------------
  const [autoInfo, setAutoInfo] = useState({
    kpiId: "",
    customerName: "",
    phone: "",
    location: "",
    googleMapLink: "",
    teleExecutive: "",
    consultant: ""
  });

useEffect(() => {
 const fetchDeal = async () => {
  try {
    console.log("🌍 Calling API...");

    const url = `https://us-central1-kapil-power-crm.cloudfunctions.net/getDealForSurvey?dealId=${dealId}&token=${token}`;

    const res = await fetch(url);
    const data = await res.json();

    console.log("📩 API RESPONSE =", data);

    const d = data.deal;

    setAutoInfo({
      kpiId: d.kpi || "",
      customerName: d.customer || "",
      phone: d.phone || "",
      location: d.location || "",
      googleMapLink: d.googleMaps || "",
      teleExecutive: d.telesales || "",
      consultant: d.consultant || "",
    });

    console.log("✅ UI UPDATED");

  } catch (err) {
    console.error("❌ Survey Fetch Error", err);
  }
};

  fetchDeal();
}, [dealId, token]);


  // ---------------- FORM STATE ----------------
  const [form, setForm] = useState({
    load: "",
    billAmount: "",
    length: "",
    width: "",
    height: "",
    floors: "",
    roofType: "",
    projectType: "",
    powerBill: null,

    north: null,
    south: null,
    east: null,
    west: null,

    handSketch: null,
    inverter: null,
    meter: null,
    earthing: null,
    outside: null,

    rooftopVideo: null
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [sizeSummary, setSizeSummary] = useState([]);

  // ---------------- VALIDATION ----------------
  const validateForm = () => {
    let err = {};

    // TEXT
    if (!form.load) err.load = true;
    if (!form.billAmount) err.billAmount = true;
    if (!form.length) err.length = true;
    if (!form.width) err.width = true;
    if (!form.height) err.height = true;
    if (!form.floors) err.floors = true;

    // DROPDOWNS
    if (!form.roofType) err.roofType = true;
    if (!form.projectType) err.projectType = true;

    // IMAGES
    if (!form.powerBill) err.powerBill = true;

    ["north","south","east","west"].forEach(d=>{
      if(!form[d]) err[d]=true;
    });

    ["handSketch","inverter","meter","earthing","outside"].forEach(d=>{
      if(!form[d]) err[d]=true;
    });

    if (!form.rooftopVideo) err.rooftopVideo = true;

    setErrors(err);

    return Object.keys(err).length === 0;
  };

  const uploadFile = (path, file) => {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      () => {},
      (error) => reject(error),
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(url);
      }
    );
  });
};

  // ---------------- SUBMIT ----------------
const submitSurvey = async () => {

  if (isSubmitting) return;

  if (!validateForm()) {
    alert("Please complete all required fields");
    return;
  }

  if (!window.confirm("Submit Survey? You cannot edit after submitting")) return;

  try {
    setIsSubmitting(true);
    setSubmitStatus("Preparing files...");
    setSizeSummary([]);

    const fileQueue = [
      ["north", form.north, "north.jpg"],
      ["south", form.south, "south.jpg"],
      ["east", form.east, "east.jpg"],
      ["west", form.west, "west.jpg"],
      ["handSketch", form.handSketch, "handSketch.jpg"],
      ["inverter", form.inverter, "inverter.jpg"],
      ["meter", form.meter, "meter.jpg"],
      ["earthing", form.earthing, "earthing.jpg"],
      ["outside", form.outside, "outside.jpg"],
      ["powerBill", form.powerBill, "powerBill.jpg"],
      ["rooftopVideo", form.rooftopVideo, "roofVideo.mp4"],
    ];

    const preparedEntries = [];
    let videoCompressed = false;
    for (const [key, originalFile, fallbackName] of fileQueue) {
      if (!originalFile) continue;
      let processedFile = originalFile;
      if (String(originalFile.type || "").startsWith("image/")) {
        processedFile = await compressImageFile(originalFile);
      } else if (String(originalFile.type || "").startsWith("video/")) {
        setSubmitStatus("Compressing video...");
        processedFile = await compressVideoFile(originalFile);
        videoCompressed = processedFile.size < originalFile.size;
      }
      preparedEntries.push({
        key,
        originalFile,
        file: processedFile,
        uploadName: buildUploadName(fallbackName, processedFile),
      });
    }

    const summary = preparedEntries
      .filter((x) => String(x.originalFile?.type || "").startsWith("image/"))
      .map((x) => ({
        key: x.key,
        before: Number(x.originalFile?.size || 0),
        after: Number(x.file?.size || 0),
      }));
    const videoEntry = preparedEntries.find((x) => x.key === "rooftopVideo");
    if (videoEntry) {
      summary.push({
        key: videoCompressed ? "rooftopVideo (compressed)" : "rooftopVideo (original)",
        before: Number(videoEntry.originalFile?.size || 0),
        after: Number(videoEntry.file?.size || 0),
      });
    }
    setSizeSummary(summary);

    const basePath = `deals/${dealId}/attachments/siteSurveyReport`;
    const surveyReportUrl = `https://crm.kapilpower.com/#/survey-report/${dealId}`;

    setSubmitStatus("Uploading files (optimized)...");
    const uploadPairs = await Promise.all(
      preparedEntries.map(async ({ key, file, uploadName }) => {
        const url = await uploadFile(`${basePath}/${uploadName}`, file);
        return [key, url];
      })
    );
    const uploads = Object.fromEntries(uploadPairs);

    // Save to Firestore
    // Save to Firestore
setSubmitStatus("Saving survey data...");
await updateDoc(doc(db, "deals", dealId), {
  siteSurveyStatus: "completed",
  siteSurveyCompletedOn: Date.now(),
  siteSurveyToken: null,
  siteSurveyLink: surveyReportUrl,

  // Store file links
  siteSurveyFiles: uploads,

  // Store form values
  siteSurveyForm: {
    load: form.load,
    billAmount: form.billAmount,
    length: form.length,
    width: form.width,
    height: form.height,
    floors: form.floors,
    roofType: form.roofType,
    projectType: form.projectType,
  }
});

// ⭐ CREATE ATTACHMENT ENTRY (THIS MAKES IT SHOW IN DEALS UI)
await setDoc(
  doc(db, "deals", dealId, "attachments", "siteSurveyReport"),
  {
    name: "Site Survey Report",
    title: "Site Survey Report",
    type: "siteSurvey",
    category: "Site Survey Documents",
    folderName: "Site Survey Documents",
    url: surveyReportUrl,
    source: "siteSurvey",
    createdAt: Date.now(),
    submittedBy: autoInfo.consultant || "Consultant",

    // Short summary
    kpiId: autoInfo?.kpiId || "",
    customerName: autoInfo?.customerName || "",
    phone: autoInfo?.phone || "",
    location: autoInfo?.location || "",

    // Links we uploaded
    files: uploads
  }
);

await setDoc(
  doc(db, "deals", dealId, "attachments", "siteSurveyFormPrint"),
  {
    title: "Site Survey Form Print",
    type: "siteSurveyPrint",
    category: "Site Survey Documents",
    folderName: "Site Survey Documents",
    url: surveyReportUrl,
    source: "siteSurvey",
    formData: {
      ...form,
      powerBill: undefined,
      north: undefined,
      south: undefined,
      east: undefined,
      west: undefined,
      handSketch: undefined,
      inverter: undefined,
      meter: undefined,
      earthing: undefined,
      outside: undefined,
      rooftopVideo: undefined,
    },
    createdAt: Date.now(),
  },
  { merge: true }
);

    alert("Survey Submitted Successfully 🎉");
    window.location.href = "/site-survey/completed";

  } catch (err) {
    console.error(err);
    alert("Upload Failed ❌");
  } finally {
    setIsSubmitting(false);
    setSubmitStatus("");
  }
};

  return (
    <div
      style={{
        background: "#eeeeee",
        minHeight: "100vh",
        maxHeight: "100vh",
        overflowY: "auto"
      }}
    >

      {/* Header */}
      <header style={headerStyle}>
        Kapil Power – Site Survey Form
      </header>

      {/* CENTER PAPER FORM */}
      <div style={formWrapper}>
        <div style={paperCard}>
{/* KPI Summary */}
<div style={summaryBox}>
  <h3 style={{ margin: 0, color: "#800000" }}>
    KPI ID: {autoInfo.kpiId || "--"}
  </h3>

  <p style={p0}>Customer: {autoInfo.customerName || "--"}</p>
  <p style={p0}>Phone: {autoInfo.phone || "--"}</p>
</div>


{/* ================= CUSTOMER INFO ================= */}
<section style={sectionBox}>
  <Title text="Customer Information" />

  <Readonly label="Customer Name" value={autoInfo.customerName || "--"} />
  <Readonly label="Phone" value={autoInfo.phone || "--"} />
  <Readonly label="Location" value={autoInfo.location || "--"} />
  <Readonly label="Google Maps" value={autoInfo.googleMapLink || "--"} />
  <Readonly label="Tele-Sales Executive" value={autoInfo.teleExecutive || "--"} />
  <Readonly label="Assigned Consultant" value={autoInfo.consultant || "--"} />
</section>
          {/* ================= ELECTRICAL ================= */}
          <section style={sectionBox}>
            <Title text="Electrical Details" />

            <Input
              label="Contracted Load (KW)"
              value={form.load}
              onChange={(e)=>setForm({...form, load:e.target.value})}
              error={errors.load}
            />

            <Input
              label="Monthly Bill Amount (₹)"
              value={form.billAmount}
              onChange={(e)=>setForm({...form, billAmount:e.target.value})}
              error={errors.billAmount}
            />

            <label style={labelBold}>
              Upload Latest Power Bill <span style={{color:"red"}}>*</span>
            </label>
            <input
              type="file"
              accept="image/*"
              style={{ ...fileInput, ...(errors.powerBill && errorStyle) }}
              onChange={(e)=>setForm({...form, powerBill:e.target.files[0]})}
            />
            {form.powerBill && (
              <small style={fileMetaText}>Selected: {formatBytes(form.powerBill.size)}</small>
            )}
            {errors.powerBill && <ErrorText />}
          </section>

          {/* ================= BUILDING ================= */}
          <section style={sectionBox}>
            <Title text="Building Details" />

            <Input
              label="Building Length (ft)"
              value={form.length}
              onChange={(e)=>setForm({...form, length:e.target.value})}
              error={errors.length}
            />

            <Input
              label="Building Width (ft)"
              value={form.width}
              onChange={(e)=>setForm({...form, width:e.target.value})}
              error={errors.width}
            />

            <Input
              label="Building Height (ft)"
              value={form.height}
              onChange={(e)=>setForm({...form, height:e.target.value})}
              error={errors.height}
            />

            <Input
              label="Number of Floors"
              value={form.floors}
              onChange={(e)=>setForm({...form, floors:e.target.value})}
              error={errors.floors}
            />

            {/* Roof */}
            <label style={labelBold}>
              Roof Type <span style={{color:"red"}}>*</span>
            </label>
            <select
              style={{ ...selectBox, ...(errors.roofType && errorStyle) }}
              value={form.roofType}
              onChange={(e)=>setForm({...form, roofType:e.target.value})}
            >
              <option value="">Select</option>
              <option>RCC</option>
              <option>Metal Sheet</option>
              <option>Ground Mounted</option>
            </select>
            {errors.roofType && <ErrorText />}

            {/* Project Type */}
            <label style={labelBold}>
              Project Type <span style={{color:"red"}}>*</span>
            </label>
            <select
              style={{ ...selectBox, ...(errors.projectType && errorStyle) }}
              value={form.projectType}
              onChange={(e)=>setForm({...form, projectType:e.target.value})}
            >
              <option value="">Select</option>
              <option>Residential</option>
              <option>Commercial</option>
              <option>Petrol Bunk</option>
            </select>
            {errors.projectType && <ErrorText />}
          </section>

          {/* ================= PHOTOS ================= */}
          <section style={sectionBox}>
            <Title text="Mandatory Site Photos" />
            <p style={{ marginTop: 0 }}>Upload directional building photos:</p>

            <div style={gridBox}>
              {["north","south","east","west"].map((d)=>(
                <div style={uploadCard} key={d}>
                  <b>{d.toUpperCase()} View *</b>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ marginTop: 6, ...(errors[d] && errorStyle) }}
                    onChange={(e)=>setForm({...form, [d]:e.target.files[0]})}
                  />
                  {form[d] && <small style={fileMetaText}>Selected: {formatBytes(form[d].size)}</small>}
                  {errors[d] && <ErrorText />}
                </div>
              ))}
            </div>

            <Title text="Additional Required Photos" />
            <div style={gridBox}>
              {[
                ["handSketch","Hand Sketch"],
                ["inverter","Inverter Location"],
                ["meter","Meter Location"],
                ["earthing","Earthing Location"],
                ["outside","Building Outside"]
              ].map(([key,label])=>(
                <div style={uploadCard} key={key}>
                  <b>{label} *</b>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ marginTop: 6, ...(errors[key] && errorStyle) }}
                    onChange={(e)=>setForm({...form, [key]:e.target.files[0]})}
                  />
                  {form[key] && <small style={fileMetaText}>Selected: {formatBytes(form[key].size)}</small>}
                  {errors[key] && <ErrorText />}
                </div>
              ))}
            </div>

            <Title text="Rooftop 4-Side Video" />
            <input
              type="file"
              accept="video/*"
              style={{ ...fileInput, ...(errors.rooftopVideo && errorStyle) }}
              onChange={(e)=>setForm({...form, rooftopVideo:e.target.files[0]})}
            />
            {form.rooftopVideo && (
              <small style={fileMetaText}>Selected: {formatBytes(form.rooftopVideo.size)} (auto-compress enabled, recommended &lt; {RECOMMENDED_VIDEO_SIZE_MB} MB)</small>
            )}
            {errors.rooftopVideo && <ErrorText />}
          </section>

          {/* ================= SUBMIT ================= */}
          <section style={sectionBox}>
            <button onClick={submitSurvey} style={submitBtn} disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Site Survey"}
            </button>
            {!!submitStatus && <p style={statusText}>{submitStatus}</p>}

            {sizeSummary.length > 0 && (
              <div style={sizeSummaryBox}>
                <b style={{ color: "#0f5132" }}>Image size converter (before → optimized):</b>
                <ul style={{ margin: "8px 0 0 16px" }}>
                  {sizeSummary.map((item) => (
                    <li key={item.key}>
                      {item.key}: {formatBytes(item.before)} → {formatBytes(item.after)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
};


/************* STYLES *************/
const headerStyle = {
  background: "#800000",
  color: "white",
  padding: "15px",
  fontSize: "18px",
  fontWeight: "bold",
  textAlign: "center",
  position: "sticky",
  top: 0,
  zIndex: 10
};

const formWrapper = {
  display: "flex",
  justifyContent: "center",
  padding: "20px 10px"
};

const paperCard = {
  width: "100%",
  maxWidth: "900px",
  background: "white",
  borderRadius: "12px",
  boxShadow: "0 5px 20px rgba(0,0,0,.15)",
  padding: "18px",
};

const summaryBox = {
  border: "1px solid #ddd",
  borderRadius: "10px",
  padding: "15px",
  marginBottom: "12px",
  background:"#fafafa"
};

const sectionBox = {
  border: "1px solid #ddd",
  borderRadius: "10px",
  padding: "15px",
  marginBottom: "12px",
  background:"#fff"
};

const p0 = { margin: "3px 0" };
const labelBold = { fontWeight:"bold", marginTop:"10px", display:"block" };
const errorStyle = { border:"2px solid red" };

const ErrorText = () => (
  <small style={{color:"red"}}>Required</small>
);

const Title = ({ text }) => (
  <h3 style={{ marginTop: 0, color:"#800000" }}>{text}</h3>
);

const Readonly = ({ label, value }) => (
  <div style={{ marginBottom: "10px" }}>
    <label style={labelBold}>{label}</label>
    <input value={value || ""} disabled style={readonlyInput} />
  </div>
);

const readonlyInput = {
  width: "100%",
  padding: "8px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  marginTop:"3px",
  background:"#f5f5f5"
};

const Input = ({ label, value, onChange, error }) => (
  <div style={{ marginBottom: "10px" }}>
    <label style={labelBold}>
      {label} <span style={{color:"red"}}>*</span>
    </label>
    <input
      value={value}
      onChange={onChange}
      style={{ ...textInput, ...(error && errorStyle) }}
    />
    {error && <ErrorText />}
  </div>
);

const textInput = {
  width:"100%",
  padding:"8px",
  borderRadius:"6px",
  border:"1px solid #ccc",
  marginTop:"3px"
};

const selectBox = { ...textInput };

const fileInput = {
  width:"100%",
  padding:"6px",
  border:"1px dashed gray",
  borderRadius:"6px",
  marginTop:"5px"
};

const gridBox = {
  display:"grid",
  gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",
  gap:"10px",
  marginTop:"8px"
};

const uploadCard = {
  border:"1px solid #ccc",
  borderRadius:"10px",
  padding:"10px",
  background:"#fafafa"
};

const fileMetaText = {
  display: "block",
  marginTop: 6,
  color: "#555",
  fontSize: 12,
};

const statusText = {
  marginTop: 10,
  color: "#0b5ed7",
  fontWeight: 600,
};

const sizeSummaryBox = {
  marginTop: 10,
  padding: 10,
  borderRadius: 8,
  border: "1px solid #badbcc",
  background: "#d1e7dd",
  color: "#0f5132",
  fontSize: 13,
};

const submitBtn = {
  width:"100%",
  background:"#800000",
  color:"white",
  padding:"12px",
  border:"none",
  borderRadius:"8px",
  fontSize:"16px",
  fontWeight:"bold",
  cursor:"pointer"
};

export default SurveyForm;
