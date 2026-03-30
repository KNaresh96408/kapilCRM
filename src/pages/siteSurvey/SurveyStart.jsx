import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function SurveyStart() {
  const { dealId, token } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState("Checking link…");

  useEffect(() => {
    const validate = async () => {
      try {
        const api = "https://us-central1-kapil-power-crm.cloudfunctions.net/getDealForSurvey";
        const url = `${api}?dealId=${encodeURIComponent(dealId)}&token=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = String(data?.error || "").toLowerCase();
          if (msg.includes("expired")) {
            setStatus("❌ Survey Link Expired");
            return;
          }
          if (msg.includes("invalid")) {
            setStatus("❌ Invalid or Tampered Link");
            return;
          }
          if (msg.includes("not found")) {
            setStatus("❌ Invalid Deal — Link Not Valid");
            return;
          }
          setStatus("❌ Link Validation Failed");
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
