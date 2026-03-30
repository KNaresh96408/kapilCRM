import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import { AttachmentsProvider } from '../context/AttachmentsContext';
import AttachmentLayout from '../components/Attachments/AttachmentLayout';
import AttachmentListView from '../components/Attachments/AttachmentListView';
import AttachmentUploadView from '../components/Attachments/AttachmentUploadView';
import AttachmentDetailView from '../components/Attachments/AttachmentDetailView';
import KpiFolderList from '../components/Attachments/KpiFolderList';
import AttachmentBreadcrumbs from '../components/Attachments/AttachmentBreadcrumbs';
import './attachments.css';

const AttachmentsPage = () => {
  return (
    <AttachmentsProvider>
      <AttachmentLayout>
        <AttachmentBreadcrumbs />
        <Router>
          <Switch>
            <Route path="/attachments/folders" component={KpiFolderList} />
            <Route path="/attachments/upload" component={AttachmentUploadView} />
            <Route path="/attachments/details/:id" component={AttachmentDetailView} />
            <Route path="/attachments" component={AttachmentListView} />
          </Switch>
        </Router>
      </AttachmentLayout>
    </AttachmentsProvider>
  );
};

export default AttachmentsPage;