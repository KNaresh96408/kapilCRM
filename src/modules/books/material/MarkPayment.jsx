import React, { useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  increment,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';


const MarkPayment = ({ po, onPaymentMarked }) => {
  const [paidAmount, setPaidAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // 1. Fetch latest PO
      const poDocRef = doc(db, 'purchaseOrders', po.id);
      const poSnap = await getDoc(poDocRef);
      if (!poSnap.exists()) throw new Error('PO not found');
      const poData = poSnap.data();
      const totalAmount = poData.totalAmount || 0;
      const existingPayment = poData.paymentAmount || 0;
      const newPaid = Number(paidAmount);
      const remaining = totalAmount - existingPayment;
      if (newPaid > remaining) {
        alert(`Paid amount exceeds remaining balance. Remaining: ${remaining}`);
        setSubmitting(false);
        return;
      }

      // 2. Update PO payment
      const updatedPayment = existingPayment + newPaid;
      let paymentStatus = 'partial';
      if (updatedPayment >= totalAmount) paymentStatus = 'paid';
      await updateDoc(poDocRef, {
        paymentAmount: updatedPayment,
        paymentStatus,
        paymentDate: serverTimestamp(),
      });

      // 3. Update vendor totals
      const vendorDocRef = doc(db, 'vendors', po.vendorId);
      await updateDoc(vendorDocRef, {
        totalPaid: increment(newPaid),
        totalNeedToPay: increment(-newPaid),
      });

      // 4. Create notification
      await addDoc(collection(db, 'notifications'), {
        title: 'PO Payment Completed',
        message: `Payment done for ${po.poNumber}. Please upload invoice.`,
        type: 'payment_update',
        module: 'books',
        referenceId: po.id,
        referenceType: 'purchaseOrder',
        toUserId: po.createdBy,
        status: 'unread',
        createdAt: serverTimestamp(),
      });

      if (onPaymentMarked) onPaymentMarked();
      alert('Payment marked successfully!');
    } catch (err) {
      alert('Error marking payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h3>Mark Payment</h3>
      <div>
        <label>Paid Amount:</label>
        <input
          type="number"
          value={paidAmount}
          onChange={e => setPaidAmount(e.target.value)}
          required
        />
      </div>
      <button type="submit" disabled={submitting}>Submit</button>
    </form>
  );
};

export default MarkPayment;
