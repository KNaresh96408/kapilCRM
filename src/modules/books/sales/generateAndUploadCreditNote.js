import { pdf } from "@react-pdf/renderer";
import React from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { DeliveryChallanPDF } from "./DeliveryChallanPDF";
import { db, storage } from "../../../firebaseConfig";
import defaultAuthorizedSignatory from "../../../purchaseAssets/authorized/authorized-signatory.png";

export async function generateAndUploadCreditNote(cnData, items, logoUrl) {
  try {
    const docInstance = React.createElement(DeliveryChallanPDF, {
      dcData: cnData,
      items,
      logoUrl,
      signatureUrl: defaultAuthorizedSignatory,
      title: "CREDIT NOTE",
      numberLabel: "Credit Note Number",
      numberValue: cnData.creditNoteNumber,
      quantityLabel: "Returned Quantity",
    });

    const asPdf = pdf([]);
    asPdf.updateContainer(docInstance);
    const blob = await asPdf.toBlob();

    const safeName = String(cnData.creditNoteNumber || cnData.id || Date.now()).replace(/[\\/]/g, "-");
    const filePath = `creditNotes/${safeName}.pdf`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, blob);
    const downloadURL = await getDownloadURL(storageRef);

    await updateDoc(doc(db, "creditNotes", cnData.id), {
      creditNotePdfUrl: downloadURL,
      status: "generated",
      updatedAt: serverTimestamp(),
    });

    return downloadURL;
  } catch (err) {
    if (cnData?.id) {
      try {
        await updateDoc(doc(db, "creditNotes", cnData.id), {
          status: "pdf_failed",
          pdfError: err?.message || "Credit Note PDF generation failed",
          updatedAt: serverTimestamp(),
        });
      } catch {
        // no-op
      }
    }
    throw err;
  }
}
