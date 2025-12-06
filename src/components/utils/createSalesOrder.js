import { db } from "../firebaseConfig";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { buildSalesOrder } from "./buildSalesOrder";

export async function createSalesOrder(deal) {
  const data = buildSalesOrder(deal);

  data.createdAt = serverTimestamp();
  data.updatedAt = serverTimestamp();

  const ref = await addDoc(collection(db, "salesOrders"), data);

  return ref.id;
}
