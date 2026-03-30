import React from 'react';
import { HashRouter as Router, Route, Switch } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AttachmentsRoutes from './routes/attachmentsRoutes';

const App = () => {
  return (
    <AuthProvider>
      <Router>
        <Switch>
          <ProtectedRoute path="/crm/attachments" component={AttachmentsRoutes} />
          {/* Add other protected routes here */}
          <Route path="/" exact>
            <h1>Welcome to Kapil Power CRM</h1>
          </Route>
          {/* Add additional routes as needed */}
        </Switch>
      </Router>
    </AuthProvider>
  );
};

export default App;