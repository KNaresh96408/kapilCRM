import React, { useState } from 'react';
import { useAttachments } from '../../hooks/useAttachments';
import { useParams } from 'react-router-dom';

const AttachmentUploadView = () => {
  const { folderId } = useParams();
  const { uploadAttachment } = useAttachments();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      await uploadAttachment(folderId, file);
      setFile(null);
    } catch (err) {
      setError('Failed to upload the file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="attachment-upload-view">
      <h2>Upload Document</h2>
      {error && <div className="error">{error}</div>}
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  );
};

export default AttachmentUploadView;