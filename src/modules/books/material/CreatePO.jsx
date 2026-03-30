import React, { useEffect, useState } from 'react';
import { fetchDocById } from '../../../helpers/firestoreFetch';
import { db } from '../../firebaseConfig';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  serverTimestamp
} from 'firebase/firestore';


const CreatePO = ({ selectedPI }) => {
  const [piDoc, setPiDoc] = useState(null);
  const [poNumber, setPoNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchPI = async () => {
      setLoading(true);
      try {
        const doc = await fetchDocById('pis', selectedPI.id);
        setPiDoc(doc);
      } catch (err) {
        setPiDoc(null);
      } finally {
        setLoading(false);
      }
    };
    if (selectedPI?.id) fetchPI();
  }, [selectedPI]);

  useEffect(() => {
    const getNextPONumber = async () => {
      try {
        const counterDocRef = doc(db, 'poCounter', 'counter');
        const counterSnap = await getDoc(counterDocRef);
        let nextNum = 1;
        if (counterSnap.exists()) {
          nextNum = (counterSnap.data().value || 0) + 1;
        }
        setPoNumber(`PO-${String(nextNum).padStart(3, '0')}`);
      } catch (err) {
        setPoNumber('PO-001');
      }
    };
    getNextPONumber();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // 1. Create purchaseOrders document
      const poData = {
        poNumber,
        vendorId: piDoc.vendorId,
        linkedPiId: selectedPI.id,
        totalAmount: piDoc.piAmount,
        items: piDoc.items || [],
        status: 'pending_approval',
        paymentStatus: 'pending',
        createdBy: piDoc.createdBy,
        createdAt: serverTimestamp(),
      };
      const poRef = await addDoc(collection(db, 'purchaseOrders'), poData);
      const newPoId = poRef.id;

      // 2. Update PI
      await updateDoc(doc(db, 'pis', selectedPI.id), {
        status: 'converted_to_po',
        linkedPoId: newPoId,
      });

      // 3. Increment counter
      const counterDocRef = doc(db, 'poCounter', 'counter');
      await updateDoc(counterDocRef, { value: parseInt(poNumber.split('-')[1], 10) });

      // 4. Create notification to finance manager
      await addDoc(collection(db, 'notifications'), {
        title: 'PO Approval Required',
        message: `PO ${poNumber} requires approval`,
        type: 'approval',
        module: 'books',
        referenceId: newPoId,
        referenceType: 'purchaseOrder',
        toRole: 'dgm',
        toUserId: null,
        status: 'unread',
        createdAt: serverTimestamp(),
      });
      alert('PO created successfully!');
    } catch (err) {
      alert('Error creating PO');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !piDoc) return <div>Loading...</div>;

  return (
    <form onSubmit={handleSubmit}>
      <h2>Create Purchase Order</h2>
      <div>
        <label>PO Number:</label>
        <input value={poNumber} readOnly />
      </div>
      <div>
        <label>Vendor ID:</label>
        <input value={piDoc.vendorId} readOnly />
      </div>
      <div>
        <label>PI Amount:</label>
        <input value={piDoc.piAmount} readOnly />
      </div>
      <button type="submit" disabled={submitting}>Create PO</button>
    </form>
  );
};

export default CreatePO;
