
import React, { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';


const POApproval = () => {
  const [pos, setPOs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState({});
  const [reason, setReason] = useState({});
  const [submitting, setSubmitting] = useState({});

  useEffect(() => {
    const fetchPOs = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'purchaseOrders'), where('status', '==', 'pending'));
        const querySnapshot = await getDocs(q);
        const docs = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        setPOs(docs);
      } catch (err) {
        setPOs([]);
      } finally {
        setLoading(false);
      }
    };
    fetchPOs();
  }, []);

  const handleAction = (poId, actionType) => {
    setAction({ ...action, [poId]: actionType });
    setReason({ ...reason, [poId]: '' });
  };

  const handleReasonChange = (poId, value) => {
    setReason({ ...reason, [poId]: value });
  };

  const handleSubmit = async (po) => {
    setSubmitting({ ...submitting, [po.id]: true });
    let update = {};
    let status = '';
    const auth = getAuth();
    const currentUser = auth.currentUser;
    const approvedBy = currentUser?.uid || null;
    if (action[po.id] === 'approve') {
      status = 'approved';
      update = {
        status,
        approvedBy,
        approvedAt: serverTimestamp(),
      };
    } else if (action[po.id] === 'hold') {
      status = 'on_hold';
      update = {
        status,
        approvalReason: reason[po.id],
        approvedBy,
        approvedAt: serverTimestamp(),
      };
    } else if (action[po.id] === 'reject') {
      status = 'rejected';
      update = {
        status,
        approvalReason: reason[po.id],
        approvedBy,
        approvedAt: serverTimestamp(),
      };
    }
    try {
      await updateDoc(doc(db, 'purchaseOrders', po.id), update);
      await addDoc(collection(db, 'notifications'), {
        title: 'PO Status Update',
        message: `PO ${po.poNumber} has been ${status}`,
        type: 'approval_update',
        module: 'books',
        referenceId: po.id,
        referenceType: 'purchaseOrder',
        toUserId: po.createdBy,
        status: 'unread',
        createdAt: serverTimestamp(),
      });
      alert('Action completed');
    } catch (err) {
      alert('Error updating PO');
    } finally {
      setSubmitting({ ...submitting, [po.id]: false });
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>PO Approval</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>PO Number</th>
            <th>Vendor ID</th>
            <th>PI Amount</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pos.map((po) => (
            <tr key={po.id}>
              <td>{po.poNumber}</td>
              <td>{po.vendorId}</td>
              <td>{po.piAmount}</td>
              <td>
                <div>
                  <button
                    disabled={submitting[po.id]}
                    onClick={() => handleAction(po.id, 'approve')}
                  >Approve</button>
                  <button
                    disabled={submitting[po.id]}
                    onClick={() => handleAction(po.id, 'hold')}
                  >Hold</button>
                  <button
                    disabled={submitting[po.id]}
                    onClick={() => handleAction(po.id, 'reject')}
                  >Reject</button>
                </div>
                {(action[po.id] === 'hold' || action[po.id] === 'reject') && (
                  <div>
                    <input
                      type="text"
                      placeholder="Enter reason"
                      value={reason[po.id] || ''}
                      onChange={e => handleReasonChange(po.id, e.target.value)}
                    />
                  </div>
                )}
                {action[po.id] && (
                  <button
                    disabled={submitting[po.id] || (['hold', 'reject'].includes(action[po.id]) && !reason[po.id])}
                    onClick={() => handleSubmit(po)}
                  >Submit</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default POApproval;
