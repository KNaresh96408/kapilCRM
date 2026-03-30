import React, { useState, useEffect } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  increment,
  serverTimestamp
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const storage = getStorage();

const GRNPage = () => {
  const [grnFile, setGrnFile] = useState(null);
  const [grnUrl, setGrnUrl] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState({});
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (showModal) {
      fetchCollectionDocs('inventoryItems').then(setInventoryItems);
    }
  }, [showModal]);

  const handleFileChange = (e) => {
    setGrnFile(e.target.files[0]);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!grnFile) return;
    try {
      const storageRef = ref(storage, `grns/${grnFile.name}`);
      await uploadBytes(storageRef, grnFile);
      const url = await getDownloadURL(storageRef);
      setGrnUrl(url);
      setShowModal(true);
    } catch (err) {
      alert('Error uploading GRN PDF');
    }
  };

  const handleSelect = (e) => {
    const { name, value } = e.target;
    setSelectedItem({ ...selectedItem, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // 1. Create GRN document
      const grnData = {
        grnNumber: `GRN-${Date.now()}`,
        poId: selectedItem.poId || '',
        vendorId: selectedItem.vendorId || '',
        products: [
          {
            variantId: selectedItem.variantId || selectedItem.id,
            quantity: Number(quantity)
          }
        ],
        createdAt: serverTimestamp(),
      };
      const grnRef = await addDoc(collection(db, 'grns'), grnData);
      const grnId = grnRef.id;

      // 2. Update inventoryVariants (variant-level stock)
      const variantDocRef = doc(db, 'inventoryVariants', selectedItem.variantId || selectedItem.id);
      await updateDoc(variantDocRef, {
        availableQuantity: increment(Number(quantity)),
      });

      // 3. Create stockLedger entry
      await addDoc(collection(db, 'stockLedger'), {
        variantId: selectedItem.variantId || selectedItem.id,
        productId: selectedItem.productId || '',
        quantity: Number(quantity),
        type: 'stockIN',
        referenceType: 'GRN',
        referenceId: grnId,
        createdAt: serverTimestamp(),
      });

      alert('GRN processed and inventory updated!');
      setShowModal(false);
      setGrnFile(null);
      setGrnUrl('');
      setSelectedItem({});
      setQuantity('');
    } catch (err) {
      alert('Error processing GRN');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>Upload GRN PDF</h2>
      <form onSubmit={handleUpload}>
        <input type="file" accept="application/pdf" onChange={handleFileChange} required />
        <button type="submit">Upload</button>
      </form>
      {showModal && (
        <div className="modal">
          <h3>Enter Inventory Details</h3>
          <form onSubmit={handleSubmit}>
            <select name="id" value={selectedItem.id || ''} onChange={handleSelect} required>
              <option value="">Select Item</option>
              {inventoryItems.map(item => (
                <option key={item.id} value={item.id}>
                  {item.product} - {item.brand} - {item.variant}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Quantity"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              required
            />
            <button type="submit" disabled={submitting}>Submit</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default GRNPage;
