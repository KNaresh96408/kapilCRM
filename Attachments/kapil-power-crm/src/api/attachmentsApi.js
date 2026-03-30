import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE;

export const createKpiFolder = async (kpiId) => {
    const response = await axios.post(`${API_BASE_URL}/attachments/kpi-folder`, { kpiId });
    return response.data;
};

export const listKpiFolders = async () => {
    const response = await axios.get(`${API_BASE_URL}/attachments/kpi-folders`);
    return response.data;
};

export const createSubfolder = async (kpiId, subfolderName) => {
    const response = await axios.post(`${API_BASE_URL}/attachments/kpi-folder/${kpiId}/subfolder`, { subfolderName });
    return response.data;
};

export const uploadFile = async (kpiId, subfolderName, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axios.post(`${API_BASE_URL}/attachments/kpi-folder/${kpiId}/subfolder/${subfolderName}/upload`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
    return response.data;
};

export const listFilesInSubfolder = async (kpiId, subfolderName) => {
    const response = await axios.get(`${API_BASE_URL}/attachments/kpi-folder/${kpiId}/subfolder/${subfolderName}/files`);
    return response.data;
};