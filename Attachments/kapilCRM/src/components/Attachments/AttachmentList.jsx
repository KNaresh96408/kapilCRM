import React, { useEffect, useState } from 'react';
import { fetchAttachments } from '../../api/attachmentsApi';
import { AttachmentItem } from './AttachmentItem';
import './AttachmentList.css';

const AttachmentList = ({ folderId }) => {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadAttachments = async () => {
      try {
        const data = await fetchAttachments(folderId);
        setAttachments(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadAttachments();
  }, [folderId]);

  if (loading) {
    return <div>Loading attachments...</div>;
  }

  if (error) {
    return <div>Error loading attachments: {error}</div>;
  }

  return (
    <div className="attachment-list">
      <h2>Attachments</h2>
      <ul>
        {attachments.map((attachment) => (
          <AttachmentItem key={attachment.id} attachment={attachment} />
        ))}
      </ul>
    </div>
  );
};

export default AttachmentList;