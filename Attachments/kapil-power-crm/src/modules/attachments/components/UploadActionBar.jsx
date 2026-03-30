import React from 'react';
import { useAttachmentUpload } from '../hooks/useAttachmentUpload';

const UploadActionBar = ({ onUploadSuccess }) => {
    const { handleFileUpload, isUploading } = useAttachmentUpload(onUploadSuccess);

    const handleUploadClick = () => {
        document.getElementById('file-input').click();
    };

    const handleFileChange = (event) => {
        const files = event.target.files;
        if (files.length > 0) {
            handleFileUpload(files);
        }
    };

    return (
        <div className="upload-action-bar">
            <input
                type="file"
                id="file-input"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                multiple
            />
            <button onClick={handleUploadClick} disabled={isUploading}>
                {isUploading ? 'Uploading...' : 'Upload Files'}
            </button>
            <button onClick={() => alert('Create Folder functionality to be implemented')}>
                Create Folder
            </button>
        </div>
    );
};

export default UploadActionBar;