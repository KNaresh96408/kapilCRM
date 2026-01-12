// src/helpers/getScopedQuery.js

import {
  collection,
  query,
  where,
  doc,
  getDoc
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getAuth } from "firebase/auth";

/**
 * Returns a Firestore query scoped by role
 * Returns NULL if access is not allowed
 */
export async function getScopedQuery(collectionName) {
  const auth = getAuth();
  const firebaseUser = auth.currentUser;

  if (!firebaseUser?.uid) {
    throw new Error("Auth not ready");
  }

  const userSnap = await getDoc(doc(db, "Users", firebaseUser.uid));
  if (!userSnap.exists()) {
    throw new Error("User profile not found");
  }

  const user = userSnap.data();
  const role = (user.role || "").toLowerCase();

  console.log(
    "[ScopedQuery]",
    "collection:", collectionName,
    "role:", role,
    "email:", user.email
  );

  // 🔓 SUPER ROLES
  const SUPER_ROLES = [
    "admin",
    "sales_head",
    "director",
    "finance_manager",
    "hr_operations_manager"
  ];

  if (SUPER_ROLES.includes(role)) {
    return collection(db, collectionName);
  }

  // 👤 CONSULTANT
  if (role === "consultant") {
    if (collectionName === "salesOrders") {
      return user.Name
        ? query(
            collection(db, collectionName),
            where("consultantName", "==", user.Name)
          )
        : null;
    }

    return user.email
      ? query(
          collection(db, collectionName),
          where("assignedConsultant", "==", user.email)
        )
      : null;
  }

  // 🎧 TELESALES
  if (role === "telesales") {
    return user.Name
      ? query(
          collection(db, collectionName),
          where("teleSale", "==", user.Name)
        )
      : null;
  }

  // 🏛 STATE HEAD / TEAM LEAD
  if (role === "state_head" || role === "team_lead") {
    return user.state
      ? query(
          collection(db, collectionName),
          where("state", "==", user.state)
        )
      : null;
  }

  // 🌍 ZONAL MANAGER
  if (role === "zonal_manager") {
    return user.sales_zone
      ? query(
          collection(db, collectionName),
          where("sales_zone", "==", user.sales_zone)
        )
      : null;
  }

  // 📍 AREA SALES MANAGER
  if (role === "area_sales_manager") {
    return user.sales_area
      ? query(
          collection(db, collectionName),
          where("sales_area", "==", user.sales_area)
        )
      : null;
  }

  // 🎨 DESIGNER → ONLY DEALS
  if (role === "designer") {
    return collectionName === "deals"
      ? collection(db, collectionName)
      : null;
  }

  // 🏗 OPERATIONS → ONLY PROJECTS
  if (role === "operations_manager" || role === "operations_executive") {
    return collectionName === "projects"
      ? collection(db, collectionName)
      : null;
  }

  // 💰 ACCOUNTANT
  if (role === "accountant") {
    return ["deals", "salesOrders", "projects"].includes(collectionName)
      ? collection(db, collectionName)
      : null;
  }

  // 🔧 SERVICE ENGINEER
  if (role === "service_engineer") {
    return collectionName === "projects" && user.sales_area
      ? query(
          collection(db, collectionName),
          where("sales_area", "==", user.sales_area)
        )
      : null;
  }

  // 🔒 FINAL FALLBACK
  return query(
    collection(db, collectionName),
    where("ownerUid", "==", firebaseUser.uid)
  );
}
