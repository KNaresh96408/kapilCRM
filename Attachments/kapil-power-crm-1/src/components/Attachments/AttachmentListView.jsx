import React, { useContext, useEffect } from 'react';
import { AttachmentsContext } from '../../context/AttachmentsContext';
import { KpiFolderList } from './KpiFolderList';
import { AttachmentBreadcrumbs } from './AttachmentBreadcrumbs';
import { AttachmentUploadView } from './AttachmentUploadView';

const AttachmentListView = () => {
  const { selectedFolder, fetchAttachments } = useContext(AttachmentsContext);

  useEffect(() => {
    if (selectedFolder) {
      fetchAttachments(selectedFolder.id);
    }
  }, [selectedFolder, fetchAttachments]);

  return (
    <div className="attachment-list-view">
      <AttachmentBreadcrumbs />
      <KpiFolderList />
      <AttachmentUploadView />
      {/* Render the list of attachments here */}
      <div className="attachments-list">
        {/* Map through attachments and display them */}
      </div>
    </div>
  );
};

export default AttachmentListView;