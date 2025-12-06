// src/utils/buildSalesOrder.js

export function buildSalesOrder(deal) {
  return {
    kpiId: deal.autoId || "",

    // customer details
    name: deal.name || "",
    phone: deal.phone || "",
    address: deal.address || "",

    // technical
    capacity: Number(deal.capacity || 0),

    // financial
    invoiceAmount: Number(deal.invoiceAmount || 0),
    paymentReceived: 0,
    pendingPayment: Number(deal.invoiceAmount || 0),
    paymentPercentage: 0,

    // status
    status: "Open",
    convertedToProject: false,

    // timestamps
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
