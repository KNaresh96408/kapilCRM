# Attachments Module for Kapil Power CRM

## Overview
The Attachments module allows users to upload and manage attachments associated with KPI-IDs. It includes features for folder navigation, document display, and user permissions to ensure secure access to files.

## Features
- **Upload Attachments**: Users can upload files to specific folders and set visibility permissions (personal or organization-wide).
- **Folder Navigation**: Navigate through a tree structure of folders associated with KPI-IDs.
- **Document Viewer**: View the contents of various document types in a user-friendly interface.
- **Permission Management**: Ensure that only authorized users can access or upload specific files.

## File Structure
The Attachments module consists of the following files:

- **src/api/attachmentsApi.js**: Functions for interacting with the backend API for attachments.
- **src/components/Attachments/AttachmentList.jsx**: Displays a list of attachments in the selected folder.
- **src/components/Attachments/AttachmentUpload.jsx**: UI for uploading new attachments.
- **src/components/Attachments/DocumentViewer.jsx**: Displays the contents of selected documents.
- **src/components/Attachments/FolderBreadcrumbs.jsx**: Shows the navigation path for the current folder.
- **src/components/Attachments/FolderTree.jsx**: Presents a tree view of the folder structure.
- **src/components/Attachments/PermissionGuard.jsx**: Checks user permissions before allowing access to features.
- **src/components/Attachments/index.jsx**: Entry point for the Attachments module.
- **src/pages/AttachmentsPage.jsx**: Main page for the Attachments module.
- **src/services/attachmentsService.js**: Business logic for managing attachments.
- **src/helpers/attachmentsFetch.js**: Helper functions for fetching data related to attachments.
- **src/types/attachments.js**: TypeScript types and interfaces related to attachments.
- **functions/attachments/index.js**: Cloud Functions for backend operations related to attachments.
- **functions/attachments/permissions.js**: Manages user permissions for attachments.
- **loadtest/k6-attachments.js**: Load testing scripts for the Attachments module.

## Setup Instructions
1. Clone the repository and navigate to the project directory.
2. Install the necessary dependencies using `npm install`.
3. Set up environment variables for API base URL and authentication tokens.
4. Run the development server with `npm run dev`.

## Usage Guidelines
- Access the Attachments module through the CRM interface.
- Use the folder tree to navigate to the desired KPI-ID folder.
- Upload files using the upload component and manage permissions accordingly.
- View documents directly within the application using the document viewer.

## API References
Refer to the `src/api/attachmentsApi.js` file for detailed information on the available API endpoints and their usage.

## Contributing
Contributions to the Attachments module are welcome. Please submit a pull request or open an issue for any enhancements or bug fixes.