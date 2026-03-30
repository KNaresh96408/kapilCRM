import React from 'react';
import { Link } from 'react-router-dom';

const AttachmentBreadcrumbs = ({ currentFolder }) => {
  const folderPath = currentFolder.split('/');

  return (
    <nav className="attachment-breadcrumbs">
      <ul>
        {folderPath.map((folder, index) => {
          const path = folderPath.slice(0, index + 1).join('/');
          return (
            <li key={index}>
              <Link to={`/attachments/${path}`}>{folder || 'Home'}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default AttachmentBreadcrumbs;