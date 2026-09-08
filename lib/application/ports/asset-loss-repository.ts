import type { AssetLossStatus } from "@/lib/contracts/asset-loss";
import type { UserRole } from "@/lib/contracts/users";

export interface AssetLossActorRecord {
  id: string;
  role: UserRole;
  active: boolean;
  version: number;
}

export interface AssetLossRecord {
  id: string;
  employeeId: string;
  itemId: string;
  responsibilityPeriodId: string | null;
  itemName: string;
  inventoryNumber: string;
  status: AssetLossStatus;
  amount: string;
  currency: "KZT";
  receiptPhotoId: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewResult: "approved" | "rejected" | null;
  reviewComment: string | null;
  closedAt: Date | null;
}

export interface AssetLossReviewSnapshot extends AssetLossRecord {
  employeeActive: boolean;
  activeResponsibilityPeriodId: string | null;
  responsibleUserId: string | null;
}

export interface AssetLossReceiptRecord {
  bytes: Uint8Array;
  mediaType: string;
}

export interface AssetLossRepository {
  findActor(userId: string, lock: boolean): Promise<AssetLossActorRecord | null>;
  list(input: {
    employeeId: string | null;
    before: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<AssetLossRecord[]>;
  findAssignableItemForUpdate(itemId: string, employeeId: string): Promise<{ amount: string; responsibilityPeriodId: string } | null>;
  insertCase(input: { id: string; employeeId: string; itemId: string; responsibilityPeriodId: string; amount: string }): Promise<void>;
  findCase(id: string): Promise<AssetLossRecord | null>;
  findCaseForUpdate(id: string): Promise<AssetLossRecord | null>;
  insertReceipt(input: {
    id: string;
    itemId: string;
    uploadedBy: string;
    bytes: Uint8Array;
    width: number;
    height: number;
    checksum: string;
    now: Date;
  }): Promise<void>;
  supersedeReceipt(photoId: string, now: Date): Promise<boolean>;
  submitReceipt(input: {
    caseId: string;
    expectedStatus: "payment_pending" | "rejected";
    photoId: string;
    submittedBy: string;
    now: Date;
  }): Promise<boolean>;
  getReceipt(caseId: string, employeeId: string | null): Promise<AssetLossReceiptRecord | null>;
  findReviewSnapshotForUpdate(caseId: string): Promise<AssetLossReviewSnapshot | null>;
  reviewCase(input: {
    caseId: string;
    decision: "approved" | "rejected";
    reviewedBy: string;
    comment: string | null;
    now: Date;
  }): Promise<boolean>;
  closeResponsibility(input: {
    periodId: string;
    itemId: string;
    employeeId: string;
    endedBy: string;
    now: Date;
  }): Promise<boolean>;
  appendEvent(input: {
    id: string;
    caseId: string;
    fromStatus: AssetLossStatus | null;
    toStatus: AssetLossStatus;
    actorId: string;
    comment: string | null;
  }): Promise<void>;
}

export interface AssetLossRepositories {
  assetLosses: AssetLossRepository;
}
