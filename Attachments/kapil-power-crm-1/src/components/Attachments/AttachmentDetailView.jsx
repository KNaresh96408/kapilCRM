import React from 'react';
import { useParams } from 'react-router-dom';
import { useAttachments } from '../../hooks/useAttachments';
import AttachmentBreadcrumbs from './AttachmentBreadcrumbs';
import './attachments.css';

const AttachmentDetailView = () => {
  const { attachmentId } = useParams();
  const { getAttachmentDetails } = useAttachments();
  const [attachmentDetails, setAttachmentDetails] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const fetchAttachmentDetails = async () => {
      try {
        const details = await getAttachmentDetails(attachmentId);
        setAttachmentDetails(details);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAttachmentDetails();
  }, [attachmentId, getAttachmentDetails]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="attachment-detail-view">
      <AttachmentBreadcrumbs />
      <h2>Attachment Details</h2>
      <div className="attachment-info">
        <h3>{attachmentDetails.name}</h3>
        <p><strong>Uploaded By:</strong> {attachmentDetails.uploadedBy}</p>
        <p><strong>Upload Date:</strong> {new Date(attachmentDetails.uploadDate).toLocaleString()}</p>
        <p><strong>Description:</strong> {attachmentDetails.description}</p>
        <a href={attachmentDetails.url} target="_blank" rel="noopener noreferrer">Download Attachment</a>
      </div>
    </div>
  );
};

export default AttachmentDetailView;