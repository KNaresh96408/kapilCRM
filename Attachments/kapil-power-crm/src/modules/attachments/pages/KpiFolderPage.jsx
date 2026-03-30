import React, { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { fetchKpiFolderDetails } from '../services/attachmentsFirestore';
import UploadActionBar from '../components/UploadActionBar';
import LeftPanelFolders from '../components/LeftPanelFolders';
import FileList from '../components/FileList';
import BackButton from '../components/BackButton';

const KpiFolderPage = () => {
    const { kpiId } = useParams();
    const history = useHistory();
    const [folderDetails, setFolderDetails] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const getFolderDetails = async () => {
            const details = await fetchKpiFolderDetails(kpiId);
            setFolderDetails(details);
            setLoading(false);
        };

        getFolderDetails();
    }, [kpiId]);

    const handleBack = () => {
        history.goBack();
    };

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <div className="kpi-folder-page">
            <BackButton onClick={handleBack} />
            <h1>{folderDetails.customerName} - {kpiId}</h1>
            <UploadActionBar kpiId={kpiId} />
            <div className="folder-content">
                <LeftPanelFolders subfolders={folderDetails.subfolders} />
                <FileList files={folderDetails.files} />
            </div>
        </div>
    );
};

export default KpiFolderPage;