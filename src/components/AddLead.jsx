import React, { useEffect, useState } from "react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { db, serverTimestamp } from "../firebaseConfig";
import SearchableSelect from "./Universal/SearchableSelect";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";

const normalizeKPI = (input) => {
  const raw = String(input || "")
    .toUpperCase()
    .replace(/[^0-9]/g, "");
  if (!raw) return "";
  return `KPI-${raw.padStart(3, "0")}`;
};

const AddLead = () => {
  const [lead, setLead] = useState({
    autoId: "",
    name: "",
    phone: "",
    email: "",
    location: "",
    source: "",
    projectType: "Residential",
    teleSale: "",
    assignedConsultant: "",
    locationLink: "",
    status: "new",
  });

  const [loading, setLoading] = useState(false);
  const [teleUsers, setTeleUsers] = useState([]);
  const [consultants, setConsultants] = useState([]);

  const normalizeRole = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const rows = await fetchCollectionDocs("Users");
        const list = (rows || []).map((data) => ({
          id: data.id,
          name: data.Name || data.name || "",
          email: data.email || "",
          role: normalizeRole(data.role || data.designation || ""),
        }));

        const teleList = list.filter((u) => ["tele_caller", "telesales", "team_lead"].includes(u.role));
        const consultantList = list.filter((u) => ["consultant", "area_sales_manager", "zonal_manager"].includes(u.role));

        setTeleUsers(teleList);
        setConsultants(consultantList);
      } catch (err) {
        console.error("Tele users load error:", err);
        setTeleUsers([]);
        setConsultants([]);
      }
    };

    loadUsers();
  }, []);

  const handleChange = (e) => {
    setLead({
      ...lead,
      [e.target.name]: e.target.value,
    });
  };

  const handleAddLead = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const leadsRef = collection(db, "leads");
      const dealsRef = collection(db, "deals");
      const leadsSnap = await getDocs(leadsRef);
      const dealsSnap = await getDocs(dealsRef);

      const manualKpi = normalizeKPI(lead.autoId);

      let leadId = manualKpi;
      if (!leadId) {
        let max = 0;
        [...leadsSnap.docs, ...dealsSnap.docs].forEach((d) => {
          const data = d.data() || {};
          const kpi = data.autoId || data.kpiId || d.id;
          if (String(kpi).startsWith("KPI-")) {
            const n = parseInt(String(kpi).split("-")[1], 10);
            if (!Number.isNaN(n) && n > max) max = n;
          }
        });
        leadId = `KPI-${String(max + 1).padStart(3, "0")}`;
      }

      const duplicateInLeads = leadsSnap.docs.some((d) => {
        const data = d.data() || {};
        return d.id === leadId || data.autoId === leadId;
      });
      const duplicateInDeals = dealsSnap.docs.some((d) => {
        const data = d.data() || {};
        return data.autoId === leadId || data.kpiId === leadId;
      });

      if (duplicateInLeads || duplicateInDeals) {
        alert(`❌ KPI ID ${leadId} already exists.`);
        setLoading(false);
        return;
      }

      await setDoc(doc(db, "leads", leadId), {
        ...lead,
        autoId: leadId,
        createdAt: serverTimestamp(),
      });

      alert(`✅ Lead added successfully with ID: ${leadId}`);

      setLead({
        autoId: "",
        name: "",
        phone: "",
        email: "",
        location: "",
        source: "",
        projectType: "Residential",
        teleSale: "",
        assignedConsultant: "",
        locationLink: "",
        status: "new",
      });
    } catch (error) {
      console.error("Error adding lead:", error);
      alert("❌ Failed to add lead. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h2 style={styles.title}>Add New Lead</h2>
        <form onSubmit={handleAddLead} style={styles.form}>
          <input
            type="text"
            name="autoId"
            placeholder="KPI ID (optional) e.g. KPI-001"
            value={lead.autoId}
            onChange={handleChange}
            style={styles.input}
          />
          <input
            type="text"
            name="name"
            placeholder="Customer Name"
            value={lead.name}
            onChange={handleChange}
            required
            style={styles.input}
          />
          <input
            type="number"
            name="phone"
            placeholder="Contact Number"
            value={lead.phone}
            onChange={handleChange}
            required
            style={styles.input}
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={lead.email}
            onChange={handleChange}
            style={styles.input}
          />
          <input
            type="text"
            name="location"
            placeholder="Location"
            value={lead.location}
            onChange={handleChange}
            required
            style={styles.input}
          />
          <input
            type="text"
            name="locationLink"
            placeholder="Google Maps Link"
            value={lead.locationLink}
            onChange={handleChange}
            style={styles.input}
          />
          <input
            type="text"
            name="source"
            placeholder="Lead Source (e.g. Facebook, Website)"
            value={lead.source}
            onChange={handleChange}
            style={styles.input}
          />
          <select
            name="projectType"
            value={lead.projectType}
            onChange={handleChange}
            required
            style={styles.select}
          >
            <option value="Residential">Residential</option>
            <option value="Commercial">Commercial</option>
          </select>
          <div style={styles.inputGroup}>
            <SearchableSelect
              options={teleUsers}
              value={lead.teleSale}
              onChange={(val) => setLead((prev) => ({ ...prev, teleSale: val || "" }))}
              placeholder="Search Tele-Caller / Team Lead by name or email"
              getOptionValue={(u) => u.name || u.email || u.id}
              getOptionLabel={(u) => `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}`}
              getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""}`}
              allowClear
            />
          </div>

          <div style={styles.inputGroup}>
            <SearchableSelect
              options={consultants}
              value={lead.assignedConsultant}
              onChange={(val) => setLead((prev) => ({ ...prev, assignedConsultant: val || "" }))}
              placeholder="Search Assigned Consultant by name or email"
              getOptionValue={(u) => u.email || u.name || u.id}
              getOptionLabel={(u) => `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}`}
              getOptionSearchText={(u) => `${u.name || ""} ${u.email || ""}`}
              allowClear
            />
          </div>

          <select
            name="status"
            value={lead.status}
            onChange={handleChange}
            style={styles.select}
          >
            <option value="new">New</option>
            <option value="in_progress">In Progress</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Adding..." : "Add Lead"}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  page: {
    backgroundColor: "#fff8f8",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    maxWidth: "400px",
    width: "90%",
    margin: "20px auto",
    padding: "25px",
    borderRadius: "12px",
    backgroundColor: "#fff",
    boxShadow: "0 4px 10px rgba(128, 0, 0, 0.15)",
    borderTop: "6px solid maroon",
  },
  title: {
    textAlign: "center",
    color: "maroon",
    fontWeight: "bold",
    marginBottom: "15px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  input: {
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid #ccc",
    backgroundColor: "#fff",
    color: "#333",
  },
  select: {
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid #ccc",
    backgroundColor: "#fff",
    color: "#333",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  button: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "maroon",
    color: "#fff",
    fontWeight: "bold",
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
};

export default AddLead;
