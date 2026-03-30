import { useState, useEffect } from 'react';
import { fetchKpiFolders, fetchAttachments, uploadAttachment } from '../api/attachmentsApi';

const useAttachments = () => {
  const [kpiFolders, setKpiFolders] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadKpiFolders = async () => {
    try {
      const folders = await fetchKpiFolders();
      setKpiFolders(folders);
    } catch (err) {
      setError(err);
    }
  };

  const loadAttachments = async (folderId) => {
    setLoading(true);
    try {
      const fetchedAttachments = await fetchAttachments(folderId);
      setAttachments(fetchedAttachments);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (folderId, file) => {
    try {
      await uploadAttachment(folderId, file);
      loadAttachments(folderId); // Refresh attachments after upload
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    loadKpiFolders();
  }, []);

  return {
    kpiFolders,
    attachments,
    loading,
    error,
    loadAttachments,
    handleUpload,
  };
};

export default useAttachments;