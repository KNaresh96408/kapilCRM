import React from 'react';
import { useKpiFolders } from '../hooks/useKpiFolders';
import { useKpiSearchFilter } from '../hooks/useKpiSearchFilter';

const FileList = ({ selectedSubfolder }) => {
    const { files, loading, error } = useKpiFolders(selectedSubfolder);
    const { searchTerm, setSearchTerm } = useKpiSearchFilter();

    if (loading) {
        return <div>Loading files...</div>;
    }

    if (error) {
        return <div>Error loading files: {error.message}</div>;
    }

    const filteredFiles = files.filter(file => 
        file.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="file-list">
            <input 
                type="text" 
                placeholder="Search files..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
            />
            <ul>
                {filteredFiles.map(file => (
                    <li key={file.id}>
                        <span>{file.name}</span>
                        <span>Created by: {file.createdBy}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default FileList;