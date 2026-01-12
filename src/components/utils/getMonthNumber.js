export const getMonthNumber = (month) => {
  if (!month || month === "All") return null;

  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  return months.indexOf(month) + 1;
};
