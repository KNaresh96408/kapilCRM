import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

export default function SurveyStart() {
  const { dealId, token } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState("Checking link…");

  useEffect(() => {
    const validate = async () => {
      try {
        const ref = doc(db, "deals", dealId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setStatus("❌ Invalid Deal — Link Not Valid");
          return;
        }

        const data = snap.data();

        // Check token exists
        if (!data.siteSurveyToken) {
          setStatus("❌ No Survey Token Found for this Deal");
          return;
        }

        // Token mismatch
        if (data.siteSurveyToken !== token) {
          setStatus("❌ Invalid or Tampered Link");
          return;
        }

        // Expiry Check
        if (data.siteSurveyExpiry && data.siteSurveyExpiry < Date.now()) {
          setStatus("❌ Survey Link Expired");
          return;
        }

        // Already Submitted?
        if (data.siteSurveyStatus === "completed") {
          setStatus("✔ Survey Already Submitted");
          return;
        }

        // SUCCESS
        setStatus("✔ Link Verified… Opening Form");

        setTimeout(() => {
          navigate(`/site-survey/form/${dealId}/${token}`);
        }, 800);

      } catch (error) {
        console.error(error);
        setStatus("❌ Server Error — Try Again");
      }
    };

    validate();
  }, [dealId, token, navigate]);

  return (
    <div style={{
      minHeight:"100vh",
      display:"flex",
      justifyContent:"center",
      alignItems:"center",
      fontSize:"20px",
      fontWeight:"bold"
    }}>
      {status}
    </div>
  );
}
