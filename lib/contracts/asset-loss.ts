export type AssetLossStatus =
  | "payment_pending"
  | "accounting_review"
  | "rejected"
  | "closed";

export interface AssetLossCaseDto {
  id: string;
  employeeId: string;
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  status: AssetLossStatus;
  amount: string;
  currency: "KZT";
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewResult: "approved" | "rejected" | null;
  reviewComment: string | null;
  closedAt: string | null;
}
