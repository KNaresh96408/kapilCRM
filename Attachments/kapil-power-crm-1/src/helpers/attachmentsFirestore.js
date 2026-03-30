import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const db = getFirestore();
const auth = getAuth();

export const createKpiFolder = async (folderName) => {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    const folderRef = collection(db, "kpiFolders");
    const docRef = await addDoc(folderRef, {
      name: folderName,
      userId: user.uid,
      createdAt: new Date(),
    });
    return docRef.id;
  } catch (error) {
    console.error("Error creating KPI folder:", error);
    throw error;
  }
};

export const fetchKpiFolders = async () => {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    const folderRef = collection(db, "kpiFolders");
    const q = query(folderRef, where("userId", "==", user.uid));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error fetching KPI folders:", error);
    throw error;
  }
};

export const uploadDocument = async (folderId, file) => {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    const attachmentsRef = collection(db, `kpiFolders/${folderId}/attachments`);
    const docRef = await addDoc(attachmentsRef, {
      fileName: file.name,
      fileType: file.type,
      userId: user.uid,
      createdAt: new Date(),
    });
    return docRef.id;
  } catch (error) {
    console.error("Error uploading document:", error);
    throw error;
  }
};

export const fetchDocuments = async (folderId) => {
  try {
    const attachmentsRef = collection(db, `kpiFolders/${folderId}/attachments`);
    const querySnapshot = await getDocs(attachmentsRef);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error fetching documents:", error);
    throw error;
  }
};

export const deleteDocument = async (folderId, documentId) => {
  try {
    const docRef = doc(db, `kpiFolders/${folderId}/attachments`, documentId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error("Error deleting document:", error);
    throw error;
  }
};