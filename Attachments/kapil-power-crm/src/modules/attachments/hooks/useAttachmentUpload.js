import { useState } from 'react';
import { uploadFileToStorage } from '../services/attachmentsStorage';
import { saveFileMetadata } from '../services/attachmentsFirestore';

const useAttachmentUpload = () => {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    const uploadAttachment = async (file, kpiId, subfolder) => {
        setUploading(true);
        setError(null);
        setSuccess(false);

        try {
            // Upload file to storage
            const fileUrl = await uploadFileToStorage(file, kpiId, subfolder);

            // Save file metadata to Firestore
            await saveFileMetadata({
                fileName: file.name,
                fileUrl,
                kpiId,
                subfolder,
                createdBy: 'currentUserId', // Replace with actual user ID
                createdAt: new Date(),
            });

            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    };

    return {
        uploading,
        error,
        success,
        uploadAttachment,
    };
};

export default useAttachmentUpload;