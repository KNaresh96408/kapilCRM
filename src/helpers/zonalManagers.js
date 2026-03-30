export const ZONAL_MANAGER_NAMES = [
  "Arun",
  "P Raju",
  "Ramajaneyulu",
  "B Ramu",
  "Rajesh",
  "B Manikanta",
  "Gopikrishna",
  "Mahesh",
];

export const isZonalManagerField = (fieldName = "") => {
  const key = String(fieldName || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return key === "zonalmanager";
};
