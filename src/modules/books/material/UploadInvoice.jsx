import React, { useState } from 'react';
import { db } from '../../firebaseConfig';
import { collection, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const storage = getStorage();

const UploadInvoice = ({ po }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      // Upload file to Firebase Storage (v9 modular)
      const storageRef = ref(storage, `invoices/${po.id}/${file.name}`);
      await uploadBytes(storageRef, file);
      const invoicePdfUrl = await getDownloadURL(storageRef);

      // Update PO with invoice URL and timestamp
      await updateDoc(doc(db, 'purchaseOrders', po.id), {
        invoicePdfUrl,
        invoiceUploadedAt: serverTimestamp(),
      });

      // Notification to upload GRN (v9 structure)
      await addDoc(collection(db, 'notifications'), {
        title: 'Upload GRN',
        message: `Invoice uploaded for PO ${po.poNumber}. Please upload GRN.`,
        type: 'po_invoice_uploaded',
        module: 'books',
        referenceId: po.id,
        referenceType: 'purchaseOrder',
        toUserId: po.createdBy,
        toRole: null,
        status: 'unread',
        createdAt: serverTimestamp(),
      });
      alert('Invoice uploaded successfully!');
    } catch (err) {
      alert('Error uploading invoice');
    } finally {
      setUploading(false);
    }
  };

  if (po.paymentStatus !== 'paid') return null;

  return (
    <form onSubmit={handleUpload}>
      <h3>Upload Invoice</h3>
      <input type="file" accept="application/pdf" onChange={handleFileChange} required />
      <button type="submit" disabled={uploading}>Upload</button>
    </form>
  );
};

export default UploadInvoice;
