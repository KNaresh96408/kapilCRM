import React from 'react';
import { Outlet } from 'react-router-dom';
import AttachmentBreadcrumbs from './AttachmentBreadcrumbs';
import './attachments.css';

const AttachmentLayout = () => {
  return (
    <div className="attachment-layout">
      <AttachmentBreadcrumbs />
      <div className="attachment-content">
        <Outlet />
      </div>
    </div>
  );
};

export default AttachmentLayout;