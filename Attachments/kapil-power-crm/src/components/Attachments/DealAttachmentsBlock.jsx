import React from 'react';
import { useHistory } from 'react-router-dom';
import { FolderGrid } from '../modules/attachments/components/FolderGrid';
import { useKpiFolders } from '../modules/attachments/hooks/useKpiFolders';

const DealAttachmentsBlock = () => {
    const history = useHistory();
    const { kpiFolders, loading, error } = useKpiFolders();

    const handleFolderClick = (kpiId) => {
        history.push(`/attachments/kpi/${kpiId}`);
    };

    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error loading folders: {error.message}</div>;
    }

    return (
        <div>
            <h2>Deal Attachments</h2>
            <FolderGrid folders={kpiFolders} onFolderClick={handleFolderClick} />
        </div>
    );
};

export default DealAttachmentsBlock;