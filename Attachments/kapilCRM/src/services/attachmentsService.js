import { getAuth } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { uploadBytes, ref, getDownloadURL } from "firebase/storage";
import { storage } from "../firebaseConfig"; // Assuming storage is initialized in firebaseConfig

const db = getFirestore();
const auth = getAuth();

export const createFolder = async (folderName, parentFolderId) => {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  const folderRef = doc(collection(db, "attachments"), folderName);
  await setDoc(folderRef, {
    name: folderName,
    parentId: parentFolderId,
    createdBy: user.uid,
    createdAt: new Date(),
  });
};

export const uploadFile = async (file, folderId) => {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  const fileRef = ref(storage, `attachments/${folderId}/${file.name}`);
  await uploadBytes(fileRef, file);
  const downloadURL = await getDownloadURL(fileRef);

  const fileDocRef = doc(collection(db, "attachments"), file.name);
  await setDoc(fileDocRef, {
    name: file.name,
    folderId,
    downloadURL,
    createdBy: user.uid,
    createdAt: new Date(),
  });
};

export const getFolderContents = async (folderId) => {
  const q = query(collection(db, "attachments"), where("parentId", "==", folderId));
  const querySnapshot = await getDocs(q);
  const contents = [];
  querySnapshot.forEach((doc) => {
    contents.push({ id: doc.id, ...doc.data() });
  });
  return contents;
};

export const getDocument = async (documentId) => {
  const docRef = doc(db, "attachments", documentId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  } else {
    throw new Error("Document not found");
  }
};