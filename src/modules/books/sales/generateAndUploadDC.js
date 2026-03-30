import { pdf } from "@react-pdf/renderer";
import React from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { DeliveryChallanPDF } from "./DeliveryChallanPDF";
import { db, storage } from "../../../firebaseConfig";
import defaultAuthorizedSignatory from "../../../purchaseAssets/authorized/authorized-signatory.png";

/**
 * Generate and upload Delivery Challan PDF, then update Firestore with the PDF URL.
 * @param {Object} dcData - Delivery Challan data (must include dcNumber, id, createdAtStr, etc.)
 * @param {Array} items - Array of DC items
 * @param {string} logoUrl - Company logo URL
 * @returns {Promise<string>} - Download URL of the uploaded PDF
 */
export async function generateAndUploadDC(dcData, items, logoUrl) {
  try {
    // 1. Generate PDF as blob
    const docInstance = React.createElement(DeliveryChallanPDF, {
      dcData,
      items,
      logoUrl,
      signatureUrl: defaultAuthorizedSignatory,
    });
    const asPdf = pdf([]);
    asPdf.updateContainer(docInstance);
    const blob = await asPdf.toBlob();

    // 2. Upload to Firebase Storage
    const safeName = String(dcData.dcNumber || dcData.id || Date.now()).replace(/[\\/]/g, "-");
    const filePath = `deliveryChallans/${safeName}.pdf`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, blob);

    // 3. Get download URL
    const downloadURL = await getDownloadURL(storageRef);

    // 4. Update deliveryChallans document
    const dcDocRef = doc(db, "deliveryChallans", dcData.id);
    await updateDoc(dcDocRef, {
      dcPdfUrl: downloadURL,
      status: "generated",
      updatedAt: serverTimestamp(),
    });

    return downloadURL;
  } catch (err) {
    if (dcData?.id) {
      try {
        const dcDocRef = doc(db, "deliveryChallans", dcData.id);
        await updateDoc(dcDocRef, {
          status: "pdf_failed",
          pdfError: err?.message || "PDF generation/upload failed",
          updatedAt: serverTimestamp(),
        });
      } catch {
        // no-op: preserve original error
      }
    }
    throw err;
  }
}
