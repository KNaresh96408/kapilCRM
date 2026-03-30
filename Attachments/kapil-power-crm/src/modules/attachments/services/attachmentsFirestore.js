import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc } from "firebase/firestore"; 
import { getAuth } from "firebase/auth"; 
import { firebaseApp } from "../../../firebaseConfig"; 

const db = getFirestore(firebaseApp); 
const auth = getAuth(firebaseApp); 

export const createKpiFolder = async (kpiId) => { 
    try { 
        const docRef = await addDoc(collection(db, "kpiFolders"), { 
            kpiId, 
            createdBy: auth.currentUser.uid, 
            createdAt: new Date() 
        }); 
        return docRef.id; 
    } catch (error) { 
        console.error("Error creating KPI folder: ", error); 
        throw error; 
    } 
}; 

export const listKpiFolders = async () => { 
    try { 
        const q = query(collection(db, "kpiFolders")); 
        const querySnapshot = await getDocs(q); 
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
    } catch (error) { 
        console.error("Error listing KPI folders: ", error); 
        throw error; 
    } 
}; 

export const createSubfolder = async (kpiId, subfolderName) => { 
    try { 
        const kpiFolderRef = doc(db, "kpiFolders", kpiId); 
        await updateDoc(kpiFolderRef, { 
            subfolders: arrayUnion(subfolderName) 
        }); 
    } catch (error) { 
        console.error("Error creating subfolder: ", error); 
        throw error; 
    } 
}; 

export const saveFileMetadata = async (kpiId, fileMetadata) => { 
    try { 
        const kpiFolderRef = doc(db, "kpiFolders", kpiId); 
        await updateDoc(kpiFolderRef, { 
            files: arrayUnion(fileMetadata) 
        }); 
    } catch (error) { 
        console.error("Error saving file metadata: ", error); 
        throw error; 
    } 
}; 