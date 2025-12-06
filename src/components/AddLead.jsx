import React, { useState } from "react";
import { collection, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";

const AddLead = () => {
  const [lead, setLead] = useState({
    name: "",
    phone: "",
    email: "",
    location: "",
    source: "",
    teleSale: "",
    assignedConsultant: "",
    locationLink: "",
    status: "new",
  });

  const [loading, setLoading] = useState(false);

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
      const snapshot = await getDocs(leadsRef);
      const leadCount = snapshot.size + 1;
      const leadId = `KPI-${String(leadCount).padStart(3, "0")}`;

      await setDoc(doc(db, "leads", leadId), {
        ...lead,
        createdAt: serverTimestamp(),
      });

      alert(`✅ Lead added successfully with ID: ${leadId}`);

      setLead({
        name: "",
        phone: "",
        email: "",
        location: "",
        source: "",
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
          <input
            type="text"
            name="teleSale"
            placeholder="Tele-Sales Executive"
            value={lead.teleSale}
            onChange={handleChange}
            style={styles.input}
          />
          <input
            type="text"
            name="assignedConsultant"
            placeholder="Assigned Consultant"
            value={lead.assignedConsultant}
            onChange={handleChange}
            style={styles.input}
          />

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
