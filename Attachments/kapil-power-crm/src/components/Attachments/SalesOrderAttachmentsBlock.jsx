import React from 'react';
import { useHistory } from 'react-router-dom';
import FolderGrid from '../modules/attachments/components/FolderGrid';
import UploadActionBar from '../modules/attachments/components/UploadActionBar';
import BackButton from '../modules/attachments/components/BackButton';

const SalesOrderAttachmentsBlock = () => {
    const history = useHistory();

    const handleBack = () => {
        history.goBack();
    };

    return (
        <div className="sales-order-attachments-block">
            <BackButton onClick={handleBack} />
            <h2>Sales Order Attachments</h2>
            <UploadActionBar />
            <FolderGrid />
        </div>
    );
};

export default SalesOrderAttachmentsBlock;