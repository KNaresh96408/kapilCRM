import React, { useState } from "react";
import { db } from "../../firebase/firebaseConfig";
import { doc, setDoc } from "firebase/firestore";

export default function TargetSetter({ userRole }) {
  const [target, setTarget] = useState("");

  if (userRole !== "admin" && userRole !== "sales_head") return null;

  const saveTarget = async () => {
    const monthKey = `${new Date().getFullYear()}-${new Date().getMonth()+1}`;

    await setDoc(doc(db, "paymentTargets", monthKey), {
      targetAmount: Number(target),
      createdAt: new Date()
    });

    alert("Target Saved Successfully");
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <input
        type="number"
        placeholder="Enter Monthly Target ₹"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />

      <button onClick={saveTarget}>
        Save Target
      </button>
    </div>
  );
}
