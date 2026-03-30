import React from 'react';
import { HashRouter as Router, Route, Switch } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AttachmentsPage from './pages/AttachmentsPage';
import { AuthProvider } from './context/AuthContext';
import { AttachmentsProvider } from './context/AttachmentsContext';

const App = () => {
  return (
    <AuthProvider>
      <AttachmentsProvider>
        <Router>
          <Switch>
            <ProtectedRoute path="/crm/attachments" component={AttachmentsPage} />
            {/* Add other protected routes here */}
          </Switch>
        </Router>
      </AttachmentsProvider>
    </AuthProvider>
  );
};

export default App;