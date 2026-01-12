import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db, storage } from "../../firebase/firebaseConfig";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";



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

  if (!validateForm()) {
    alert("Please complete all required fields");
    return;
  }

  if (!window.confirm("Submit Survey? You cannot edit after submitting")) return;

  try {
    const basePath = `deals/${dealId}/attachments/siteSurveyReport`;

    const uploads = {};

    // Upload mandatory images
    uploads.north = await uploadFile(`${basePath}/north.jpg`, form.north);
    uploads.south = await uploadFile(`${basePath}/south.jpg`, form.south);
    uploads.east = await uploadFile(`${basePath}/east.jpg`, form.east);
    uploads.west = await uploadFile(`${basePath}/west.jpg`, form.west);

    // Additional
    uploads.handSketch = await uploadFile(`${basePath}/handSketch.jpg`, form.handSketch);
    uploads.inverter = await uploadFile(`${basePath}/inverter.jpg`, form.inverter);
    uploads.meter = await uploadFile(`${basePath}/meter.jpg`, form.meter);
    uploads.earthing = await uploadFile(`${basePath}/earthing.jpg`, form.earthing);
    uploads.outside = await uploadFile(`${basePath}/outside.jpg`, form.outside);

    // Power Bill
    uploads.powerBill = await uploadFile(`${basePath}/powerBill.jpg`, form.powerBill);

    // Video
    uploads.rooftopVideo = await uploadFile(`${basePath}/roofVideo.mp4`, form.rooftopVideo);

    // Save to Firestore
    // Save to Firestore
await updateDoc(doc(db, "deals", dealId), {
  siteSurveyStatus: "completed",
  siteSurveyCompletedOn: Date.now(),
  siteSurveyToken: null,

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
    type: "report",
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

    alert("Survey Submitted Successfully 🎉");
    window.location.href = "/site-survey/completed";

  } catch (err) {
    console.error(err);
    alert("Upload Failed ❌");
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
            {errors.rooftopVideo && <ErrorText />}
          </section>

          {/* ================= SUBMIT ================= */}
          <section style={sectionBox}>
            <button onClick={submitSurvey} style={submitBtn}>
              Submit Site Survey
            </button>
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
