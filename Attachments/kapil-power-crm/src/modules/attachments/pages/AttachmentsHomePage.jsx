import React from 'react';
import { useKpiFolders } from '../hooks/useKpiFolders';
import FolderGrid from '../components/FolderGrid';
import { Link } from 'react-router-dom';

const AttachmentsHomePage = () => {
    const { kpiFolders, loading, error } = useKpiFolders();

    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error loading KPI folders: {error.message}</div>;
    }

    return (
        <div>
            <h1>Attachments</h1>
            <div className="folder-grid">
                {kpiFolders.map(folder => (
                    <Link key={folder.id} to={`/attachments/kpi/${folder.id}`}>
                        <FolderGrid folder={folder} />
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default AttachmentsHomePage;