import React from 'react';
import { useHistory } from 'react-router-dom';

const FolderGrid = ({ folders }) => {
  const history = useHistory();

  const handleFolderClick = (kpiId) => {
    history.push(`/attachments/kpi/${kpiId}`);
  };

  return (
    <div className="folder-grid">
      {folders.map((folder) => (
        <div
          key={folder.kpiId}
          className="folder-icon"
          onClick={() => handleFolderClick(folder.kpiId)}
        >
          <img src="/path/to/folder-icon.png" alt="Folder Icon" />
          <span>{folder.kpiId}</span>
        </div>
      ))}
    </div>
  );
};

export default FolderGrid;