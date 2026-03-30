# Kapil Power CRM

## Overview
Kapil Power CRM is a React-based single-page application designed to manage customer relationships effectively. This project integrates various modules, including an Attachments module for managing documents and KPI-ID folders.

## Features
- **Attachments Module**: Manage KPI-ID folders, upload documents, and navigate between different attachment views.
- **Firebase Integration**: Utilizes Firebase for authentication and data storage.
- **Responsive Design**: Built with a mobile-first approach using Capacitor for iOS and Android compatibility.

## Project Structure
The project is organized into several directories, each serving a specific purpose:

- **src**: Contains the main application code.
  - **api**: Functions for interacting with the backend API related to attachments.
  - **components**: UI components for the Attachments module.
  - **context**: Context API for managing attachment state.
  - **hooks**: Custom hooks for encapsulating attachment logic.
  - **pages**: Main page components for different modules.
  - **routes**: Routing definitions for the application.
  - **helpers**: Helper functions for Firestore interactions.
  - **utils**: Utility functions for validation.
  - **styles**: CSS styles specific to the Attachments module.
  - **App.jsx**: Main application component.

- **functions**: Contains Cloud Functions for managing attachments.

- **package.json**: Configuration file for npm dependencies and scripts.

- **vite.config.js**: Configuration file for Vite build options.

## Setup Instructions
1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd kapil-power-crm
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Environment Variables**:
   Create a `.env` file in the root directory and define the necessary environment variables, including `VITE_API_BASE`.

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```

5. **Build for Production**:
   ```bash
   npm run build
   ```

## Usage
- Navigate to the Attachments module to manage KPI-ID folders and documents.
- Use the provided components to upload, view, and manage attachments effectively.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for more details.