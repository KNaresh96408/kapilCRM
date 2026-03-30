# Kapil Power CRM

## Overview
Kapil Power CRM is a React-based single-page application (SPA) designed for managing customer relationships and attachments efficiently. The application utilizes Firebase for authentication, Firestore for data storage, and Capacitor for mobile builds.

## Features
- **Attachments Module**: A dedicated module for managing attachments related to deals and sales orders.
- **KPI-ID Folders**: Automatically creates folders for each KPI-ID, allowing users to upload and manage documents efficiently.
- **Dynamic Navigation**: Users can navigate through KPI-ID folders and subfolders seamlessly.
- **File Uploads**: Supports quick file uploads with no size limits, ensuring a smooth user experience.
- **Permissions Management**: Implements user permissions to control visibility and access to files.

## Project Structure
```
kapil-power-crm
├── src
│   ├── modules
│   │   └── attachments
│   │       ├── pages
│   │       │   ├── AttachmentsHomePage.jsx
│   │       │   ├── KpiFolderPage.jsx
│   │       │   └── SubfolderPage.jsx
│   │       ├── components
│   │       │   ├── FolderGrid.jsx
│   │       │   ├── LeftPanelFolders.jsx
│   │       │   ├── FileList.jsx
│   │       │   ├── UploadActionBar.jsx
│   │       │   └── BackButton.jsx
│   │       ├── hooks
│   │       │   ├── useKpiFolders.js
│   │       │   ├── useAttachmentUpload.js
│   │       │   └── useKpiSearchFilter.js
│   │       ├── services
│   │       │   ├── attachmentsFirestore.js
│   │       │   ├── attachmentsStorage.js
│   │       │   └── attachmentsPermissions.js
│   │       ├── constants
│   │       │   └── defaultSubfolders.js
│   │       └── index.js
│   ├── components
│   │   └── Attachments
│   │       ├── DealAttachmentsBlock.jsx
│   │       └── SalesOrderAttachmentsBlock.jsx
│   ├── api
│   │   └── attachmentsApi.js
│   ├── routes
│   │   └── attachmentsRoutes.jsx
│   ├── firebaseConfig.js
│   └── App.jsx
├── functions
│   ├── attachments
│   │   ├── createKpiFolder.js
│   │   ├── listKpiFolders.js
│   │   ├── createSubfolder.js
│   │   └── saveFileMetadata.js
│   └── index.js
├── firestore.rules
├── storage.rules
├── package.json
├── vite.config.js
└── README.md
```

## Setup Instructions
1. **Clone the Repository**: 
   ```
   git clone <repository-url>
   cd kapil-power-crm
   ```

2. **Install Dependencies**: 
   ```
   npm install
   ```

3. **Configure Firebase**: 
   Update the `src/firebaseConfig.js` file with your Firebase project credentials.

4. **Run the Development Server**: 
   ```
   npm run dev
   ```

5. **Build for Production**: 
   ```
   npm run build
   ```

6. **Preview the Build**: 
   ```
   npm run preview
   ```

## Usage
- Navigate to the attachments module to manage KPI-ID folders and upload files.
- Use the left panel to view existing subfolders and navigate through them.
- Click on the upload button to add new files or create folders.
- Utilize the search filter to quickly find specific KPI-ID folders.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.