import React, { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { fetchSubfolderFiles, fetchSubfolderDetails } from '../services/attachmentsFirestore';
import LeftPanelFolders from '../components/LeftPanelFolders';
import FileList from '../components/FileList';
import UploadActionBar from '../components/UploadActionBar';
import BackButton from '../components/BackButton';

const SubfolderPage = () => {
    const { kpiId, subfolderName } = useParams();
    const history = useHistory();
    const [files, setFiles] = useState([]);
    const [subfolderDetails, setSubfolderDetails] = useState(null);

    useEffect(() => {
        const loadSubfolderData = async () => {
            const details = await fetchSubfolderDetails(kpiId, subfolderName);
            setSubfolderDetails(details);
            const filesData = await fetchSubfolderFiles(kpiId, subfolderName);
            setFiles(filesData);
        };

        loadSubfolderData();
    }, [kpiId, subfolderName]);

    const handleBack = () => {
        history.goBack();
    };

    return (
        <div className="subfolder-page">
            <BackButton onClick={handleBack} />
            <h1>{subfolderDetails ? `${subfolderDetails.name} - ${kpiId}` : 'Loading...'}</h1>
            <UploadActionBar kpiId={kpiId} subfolderName={subfolderName} />
            <div className="subfolder-content">
                <LeftPanelFolders subfolderName={subfolderName} />
                <FileList files={files} />
            </div>
        </div>
    );
};

export default SubfolderPage;