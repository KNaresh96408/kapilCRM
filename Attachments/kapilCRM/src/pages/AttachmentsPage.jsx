import React, { useState, useEffect } from 'react';
import { AttachmentList, AttachmentUpload, FolderBreadcrumbs, FolderTree, PermissionGuard } from '../components/Attachments';
import { fetchFolders } from '../api/attachmentsApi';

const AttachmentsPage = () => {
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);

  useEffect(() => {
    const loadFolders = async () => {
      const fetchedFolders = await fetchFolders();
      setFolders(fetchedFolders);
    };

    loadFolders();
  }, []);

  const handleFolderSelect = (folder) => {
    setCurrentFolder(folder);
  };

  return (
    <div>
      <h1>Attachments</h1>
      <PermissionGuard>
        <FolderBreadcrumbs currentFolder={currentFolder} />
        <FolderTree folders={folders} onFolderSelect={handleFolderSelect} />
        <AttachmentUpload currentFolder={currentFolder} />
        <AttachmentList currentFolder={currentFolder} />
      </PermissionGuard>
    </div>
  );
};

export default AttachmentsPage;