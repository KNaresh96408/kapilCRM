import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchKpiFolders, fetchAttachments } from '../api/attachmentsApi';

const AttachmentsContext = createContext();

export const AttachmentsProvider = ({ children }) => {
  const [kpiFolders, setKpiFolders] = useState([]);
  const [attachments, setAttachments] = useState([]);
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

  return (
    <AttachmentsContext.Provider
      value={{
        kpiFolders,
        attachments,
        loading,
        error,
        loadAttachments,
      }}
    >
      {children}
    </AttachmentsContext.Provider>
  );
};

export const useAttachments = () => {
  return useContext(AttachmentsContext);
};