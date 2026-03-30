import { useState, useEffect } from 'react';
import { fetchKpiFolders } from '../services/attachmentsFirestore';

const useKpiFolders = () => {
    const [kpiFolders, setKpiFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadKpiFolders = async () => {
            try {
                const folders = await fetchKpiFolders();
                setKpiFolders(folders);
            } catch (err) {
                setError(err);
            } finally {
                setLoading(false);
            }
        };

        loadKpiFolders();
    }, []);

    return { kpiFolders, loading, error };
};

export default useKpiFolders;