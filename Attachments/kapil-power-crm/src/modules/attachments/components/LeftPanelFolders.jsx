import React from 'react';
import { useKpiFolders } from '../hooks/useKpiFolders';

const LeftPanelFolders = ({ onSelectFolder }) => {
    const { kpiFolders, loading, error } = useKpiFolders();

    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error loading folders: {error.message}</div>;
    }

    return (
        <div className="left-panel-folders">
            <h3>KPI-ID Folders</h3>
            <ul>
                {kpiFolders.map(folder => (
                    <li key={folder.id} onClick={() => onSelectFolder(folder.id)}>
                        <span className="folder-icon">📁</span>
                        {folder.name}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default LeftPanelFolders;