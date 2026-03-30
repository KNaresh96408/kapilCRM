import React, { useEffect, useState } from 'react';
import { fetchCollectionDocs } from '../../../helpers/firestoreFetch';

const PIList = () => {
  const [pis, setPis] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPis = async () => {
      setLoading(true);
      try {
        const docs = await fetchCollectionDocs('pis');
        setPis(docs);
      } catch (err) {
        setPis([]);
      } finally {
        setLoading(false);
      }
    };
    fetchPis();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Material Purchase Invoices</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>PI Number</th>
            <th>Vendor Name</th>
            <th>PI Amount</th>
            <th>Status</th>
            <th>View PI</th>
            <th>Create PO</th>
          </tr>
        </thead>
        <tbody>
          {pis.map((pi) => (
            <tr key={pi.id}>
              <td>{pi.piNumber}</td>
              <td>{pi.vendorName}</td>
              <td>{pi.piAmount}</td>
              <td>{pi.status}</td>
              <td>
                {pi.piPdfUrl ? (
                  <a href={pi.piPdfUrl} target="_blank" rel="noopener noreferrer">View PI</a>
                ) : (
                  'N/A'
                )}
              </td>
              <td>
                <button
                  disabled={pi.status !== 'uploaded'}
                  onClick={() => {/* handle create PO logic here */}}
                >
                  Create PO
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PIList;
