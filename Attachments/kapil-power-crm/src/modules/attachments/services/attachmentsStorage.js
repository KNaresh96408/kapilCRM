import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";

const storage = getStorage();

export const uploadFile = async (file, kpiId, subfolder) => {
    const folderRef = ref(storage, `${kpiId}/${subfolder}/${uuidv4()}_${file.name}`);
    try {
        await uploadBytes(folderRef, file);
        const fileUrl = await getDownloadURL(folderRef);
        return { success: true, fileUrl };
    } catch (error) {
        console.error("File upload failed:", error);
        return { success: false, error: error.message };
    }
};

export const listFilesInFolder = async (kpiId, subfolder) => {
    const folderRef = ref(storage, `${kpiId}/${subfolder}`);
    const fileList = [];

    try {
        const listResult = await listAll(folderRef);
        listResult.items.forEach((item) => {
            fileList.push({
                name: item.name,
                url: await getDownloadURL(item),
            });
        });
        return fileList;
    } catch (error) {
        console.error("Failed to list files:", error);
        return [];
    }
};