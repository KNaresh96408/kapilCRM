import { getMonthNumber } from "./getMonthNumber";

export const isDateInFilter = (firebaseDate, filters) => {
  if (!firebaseDate) return false;

  let d;
  if (firebaseDate?.toDate) {
    d = firebaseDate.toDate();
  } else if (firebaseDate?.seconds) {
    d = new Date(firebaseDate.seconds * 1000);
  } else if (firebaseDate instanceof Date) {
    d = firebaseDate;
  } else {
    d = new Date(firebaseDate);
  }

  if (isNaN(d.getTime())) return false;
  const monthNo = getMonthNumber(filters.month);

  // ✅ 1️⃣ Custom Date Highest Priority
  if (filters.startDate && filters.endDate)
    return d >= filters.startDate && d <= filters.endDate;

  // ✅ 2️⃣ Year + Month Together
  if (filters.year !== "All" && monthNo) {
    return (
      d.getFullYear() === Number(filters.year) &&
      d.getMonth() + 1 === monthNo
    );
  }

  // ✅ 3️⃣ Only Year
  if (filters.year !== "All") {
    return d.getFullYear() === Number(filters.year);
  }

  // ✅ 4️⃣ Only Month
  if (monthNo) {
    return d.getMonth() + 1 === monthNo;
  }

  // ✅ 5️⃣ All
  return true;
};
