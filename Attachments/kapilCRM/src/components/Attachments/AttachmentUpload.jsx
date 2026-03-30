import React, { useState } from 'react';
import { uploadAttachment } from '../../api/attachmentsApi';
import { useAuth } from '../../context/AuthContext';

const AttachmentUpload = () => {
  const [file, setFile] = useState(null);
  const [folder, setFolder] = useState('');
  const [visibility, setVisibility] = useState('personal');
  const { user } = useAuth();

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  const handleFolderChange = (event) => {
    setFolder(event.target.value);
  };

  const handleVisibilityChange = (event) => {
    setVisibility(event.target.value);
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file || !folder) {
      alert('Please select a file and folder.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    formData.append('visibility', visibility);
    formData.append('createdBy', user.uid);

    try {
      await uploadAttachment(formData);
      alert('File uploaded successfully!');
      setFile(null);
      setFolder('');
      setVisibility('personal');
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file. Please try again.');
    }
  };

  return (
    <div>
      <h2>Upload Attachment</h2>
      <form onSubmit={handleUpload}>
        <div>
          <label>
            File:
            <input type="file" onChange={handleFileChange} required />
          </label>
        </div>
        <div>
          <label>
            Folder:
            <input type="text" value={folder} onChange={handleFolderChange} required />
          </label>
        </div>
        <div>
          <label>
            Visibility:
            <select value={visibility} onChange={handleVisibilityChange}>
              <option value="personal">Personal</option>
              <option value="organization">Organization-wide</option>
            </select>
          </label>
        </div>
        <button type="submit">Upload</button>
      </form>
    </div>
  );
};

export default AttachmentUpload;