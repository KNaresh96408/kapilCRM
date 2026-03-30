import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import AttachmentsHomePage from '../modules/attachments/pages/AttachmentsHomePage';
import KpiFolderPage from '../modules/attachments/pages/KpiFolderPage';
import SubfolderPage from '../modules/attachments/pages/SubfolderPage';

const AttachmentsRoutes = () => {
    return (
        <Router>
            <Switch>
                <Route path="/attachments" exact component={AttachmentsHomePage} />
                <Route path="/attachments/kpi/:kpiId" component={KpiFolderPage} />
                <Route path="/attachments/kpi/:kpiId/subfolder/:subfolderId" component={SubfolderPage} />
            </Switch>
        </Router>
    );
};

export default AttachmentsRoutes;