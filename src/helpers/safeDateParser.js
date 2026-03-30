/**
 * Safe date parser that handles multiple Firestore date formats
 * Works with: Firestore Timestamp, ISO strings, milliseconds, Date objects, REST timestamps
 */
export const toJSDate = (value) => {
  if (!value) return null;

  // Firestore Timestamp object with toDate() method
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (e) {
      return null;
    }
  }

  // Firestore REST timestamp object { seconds, nanoseconds }
  if (value?.seconds && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  // ISO string or date string
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // Unix milliseconds
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // Already a Date object
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  return null;
};

/**
 * Format date for display (en-GB format)
 */
export const formatDateDisplay = (value) => {
  const date = toJSDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-GB");
};

/**
 * Format date as ISO string for input[type="date"]
 */
export const formatDateISO = (value) => {
  const date = toJSDate(value);
  if (!date) return "";
  return date.toISOString().split("T")[0];
};
