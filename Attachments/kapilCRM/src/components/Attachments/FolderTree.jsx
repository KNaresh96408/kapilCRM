import React, { useEffect, useState } from 'react';
import { fetchFolders } from '../../api/attachmentsApi';
import FolderItem from './FolderItem';

const FolderTree = ({ selectedFolderId, onFolderSelect }) => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadFolders = async () => {
      try {
        const data = await fetchFolders();
        setFolders(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadFolders();
  }, []);

  const handleFolderSelect = (folderId) => {
    onFolderSelect(folderId);
  };

  if (loading) {
    return <div>Loading folders...</div>;
  }

  if (error) {
    return <div>Error loading folders: {error}</div>;
  }

  return (
    <div className="folder-tree">
      <h3>Folders</h3>
      <ul>
        {folders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            isSelected={folder.id === selectedFolderId}
            onSelect={handleFolderSelect}
          />
        ))}
      </ul>
    </div>
  );
};

export default FolderTree;