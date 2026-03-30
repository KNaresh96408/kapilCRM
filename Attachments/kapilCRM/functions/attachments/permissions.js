import { getAuth } from "firebase-admin/auth";
import { db } from "../firebaseConfig"; // Adjust the path as necessary

export const checkUserPermission = async (userId, kpiId) => {
  const userPermissionsRef = db.collection("userPermissions").doc(userId);
  const userPermissionsDoc = await userPermissionsRef.get();

  if (!userPermissionsDoc.exists) {
    throw new Error("User permissions not found");
  }

  const userPermissions = userPermissionsDoc.data();
  return userPermissions.kpiIds.includes(kpiId);
};

export const setUserPermission = async (userId, kpiId, permission) => {
  const userPermissionsRef = db.collection("userPermissions").doc(userId);
  await userPermissionsRef.set(
    {
      kpiIds: admin.firestore.FieldValue.arrayUnion(kpiId),
      permissions: {
        [kpiId]: permission,
      },
    },
    { merge: true }
  );
};

export const removeUserPermission = async (userId, kpiId) => {
  const userPermissionsRef = db.collection("userPermissions").doc(userId);
  await userPermissionsRef.update({
    kpiIds: admin.firestore.FieldValue.arrayRemove(kpiId),
  });
};