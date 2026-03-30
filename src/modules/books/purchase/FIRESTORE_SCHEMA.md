# Purchase Module Firestore Schema

## `pis/{piId}`
- `vendorId: string`
- `vendorName: string`
- `piNumber: string`
- `piAmount: number`
- `piPdfUrl: string`
- `status: "uploaded"`
- `createdBy: string`
- `createdAt: serverTimestamp`

## `purchaseOrders/{poId}` (Material)
- `poNumber: string` (PO-M-1001)
- `vendorId: string`
- `vendorName: string`
- `linkedPiId: string`
- `piNumber: string`
- `piPdfUrl: string`
- `items: Array<{ productId, productName, brandName, variantId, variantName, quantity, rate, total, unit }>`
- `terms: object`
- `totalAmount: number`
- `paymentAmount: number`
- `paymentStatus: "pending" | "partial" | "paid"`
- `status: "draft" | "pending_approval" | "approved" | "hold" | "rejected"`
- `approved: boolean`
- `approvedBy: string | null`
- `approvedAt: serverTimestamp | null`
- `approvalReason: string`
- `poPdfUrl: string`
- `receiptUrl: string`
- `utrNumber: string`
- `paymentDate: serverTimestamp`
- `vendorTotalBooked: boolean`
- `createdBy: string`
- `createdAt: serverTimestamp`
- `updatedAt: serverTimestamp`

## `servicePurchaseOrders/{poId}`
- `poNumber: string` (SV/PO-001)
- `vendorId: string`
- `vendorName: string`
- `assignedProjectsCount: number`
- `ratePerProject: number`
- `totalAmount: number`
- `terms: object`
- `paymentAmount: number`
- `paymentStatus: "pending" | "partial" | "paid"`
- `status: "draft" | "pending_approval" | "approved" | "hold" | "rejected"`
- `approved: boolean`
- `approvedBy: string | null`
- `approvedAt: serverTimestamp | null`
- `approvalReason: string`
- `poPdfUrl: string`
- `createdBy: string`
- `createdAt: serverTimestamp`
- `updatedAt: serverTimestamp`

## `poCounters/{docId}`
- `material.nextNumber: number`
- `service.nextNumber: number`

> Implemented as docs:
- `poCounters/material` -> `{ nextNumber }`
- `poCounters/service` -> `{ nextNumber }`

## `purchaseConfig/materialApproval`
- `signatureUrl: string`
- `stampUrl: string`
- `approvedByName: string`
- `updatedAt: serverTimestamp`

## `notifications/{notificationId}`
- `title: string`
- `message: string`
- `type: "po_approval" | "po_status_update" | "po_payment_update"`
- `module: "books"`
- `referenceId: string`
- `referenceType: string`
- `toRole: string | null`
- `toUserId: string | null`
- `dedupeKey: string`
- `status: "unread" | "read"`
- `createdAt: serverTimestamp`
- `pushDispatchState: "sent" | "partial" | "no_tokens"`
- `pushSentAt: serverTimestamp`
- `pushFailureCount: number`

## `notificationPushRetries/{notificationId}`
- `notificationId: string`
- `attempts: number`
- `status: "pending" | "done"`
- `nextAttemptAt: serverTimestamp`
- `createdAt: serverTimestamp`
- `error: string`
