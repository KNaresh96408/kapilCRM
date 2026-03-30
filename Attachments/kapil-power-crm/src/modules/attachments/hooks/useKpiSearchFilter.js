import { useState, useEffect } from 'react';
import { fetchKpiFolders } from '../services/attachmentsFirestore';

const useKpiSearchFilter = (searchTerm) => {
    const [filteredKpiFolders, setFilteredKpiFolders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadKpiFolders = async () => {
            setLoading(true);
            try {
                const allKpiFolders = await fetchKpiFolders();
                const filteredFolders = allKpiFolders.filter(folder =>
                    folder.name.toLowerCase().includes(searchTerm.toLowerCase())
                );
                setFilteredKpiFolders(filteredFolders);
            } catch (error) {
                console.error("Error fetching KPI folders:", error);
            } finally {
                setLoading(false);
            }
        };

        loadKpiFolders();
    }, [searchTerm]);

    return { filteredKpiFolders, loading };
};

export default useKpiSearchFilter;