import React from 'react';
import { Route, Switch } from 'react-router-dom';
import AttachmentLayout from '../components/Attachments/AttachmentLayout';
import AttachmentListView from '../components/Attachments/AttachmentListView';
import AttachmentUploadView from '../components/Attachments/AttachmentUploadView';
import AttachmentDetailView from '../components/Attachments/AttachmentDetailView';
import KpiFolderList from '../components/Attachments/KpiFolderList';

const AttachmentsRoutes = () => {
  return (
    <AttachmentLayout>
      <Switch>
        <Route path="/attachments" exact component={KpiFolderList} />
        <Route path="/attachments/folder/:folderId" exact component={AttachmentListView} />
        <Route path="/attachments/upload/:folderId" exact component={AttachmentUploadView} />
        <Route path="/attachments/detail/:attachmentId" exact component={AttachmentDetailView} />
      </Switch>
    </AttachmentLayout>
  );
};

export default AttachmentsRoutes;