import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchDocument } from '../../api/attachmentsApi';
import { Document, Page } from 'react-pdf'; // Assuming you're using react-pdf for document viewing

const DocumentViewer = () => {
  const { documentId } = useParams();
  const [document, setDocument] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDocument = async () => {
      try {
        const doc = await fetchDocument(documentId);
        setDocument(doc);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [documentId]);

  if (loading) {
    return <div>Loading document...</div>;
  }

  if (error) {
    return <div>Error loading document: {error}</div>;
  }

  if (!document) {
    return <div>No document found.</div>;
  }

  return (
    <div>
      <h2>{document.name}</h2>
      <div>
        {document.type === 'pdf' ? (
          <Document file={document.url}>
            <Page pageNumber={1} />
          </Document>
        ) : (
          <iframe src={document.url} width="100%" height="600px" title={document.name} />
        )}
      </div>
    </div>
  );
};

export default DocumentViewer;