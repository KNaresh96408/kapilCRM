import { doc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebaseConfig";


export async function reduceInventoryVariant(variantId, deliveredQuantity) {
  try {
    const variantDocRef = doc(db, "inventoryVariants", variantId);
    await updateDoc(variantDocRef, {
      availableQuantity: increment(-deliveredQuantity),
      lastUpdatedAt: serverTimestamp(),
    });
  } catch (err) {
    // Handle error
    console.error("Error reducing inventory:", err);
  }
}
