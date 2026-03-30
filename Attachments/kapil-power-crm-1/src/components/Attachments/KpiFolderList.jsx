import React, { useContext, useEffect } from 'react';
import { AttachmentsContext } from '../../context/AttachmentsContext';
import { Link } from 'react-router-dom';

const KpiFolderList = () => {
  const { kpiFolders, fetchKpiFolders } = useContext(AttachmentsContext);

  useEffect(() => {
    fetchKpiFolders();
  }, [fetchKpiFolders]);

  return (
    <div className="kpi-folder-list">
      <h2>KPI-ID Folders</h2>
      <ul>
        {kpiFolders.map((folder) => (
          <li key={folder.id}>
            <Link to={`/attachments/${folder.id}`}>{folder.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default KpiFolderList;