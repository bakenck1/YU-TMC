import type { TransferStatus } from "@/lib/contracts/inventory-responsibility";

export interface ItemResponsibilityState {
  itemId: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  itemStatus: "active" | "maintenance" | "decommissioned";
}

export interface TransferRecord {
  id: string;
  itemId: string;
  requestedBy: string;
  requestedByName: string;
  proposedResponsibleId: string;
  currentResponsibleIdAtRequest: string;
  currentResponsibleName: string;
  status: TransferStatus;
  requestedAt: Date;
  closedAt: Date | null;
  decisionComment: string | null;
  version: number;
}

export interface ResponsibilityTimelineRecord {
  id: string;
  kind: "responsibility" | "transfer";
  occurredAt: Date;
  actorName: string | null;
  responsibleName: string | null;
  status: string;
  detail: string | null;
  closedAt: Date | null;
}

export interface InsertResponsibilityRecord {
  id: string;
  itemId: string;
  responsibleUserId: string;
  source: "accepted" | "transfer" | "admin_override";
  startedBy: string;
  startedAt: Date;
}

export interface CloseResponsibilityRecord {
  itemId: string;
  endedBy: string;
  endedAt: Date;
  endReason: string;
}

export interface InsertTransferRecord {
  id: string;
  itemId: string;
  requestedBy: string;
  proposedResponsibleId: string;
  currentResponsibleIdAtRequest: string;
  requestedAt: Date;
}

export interface DecideTransferRecord {
  id: string;
  version: number;
  status: "confirmed" | "rejected";
  closedBy: string;
  closedAt: Date;
  decisionComment: string | null;
}

export interface CancelTransferRecord {
  id: string;
  version: number;
  closedBy: string;
  closedAt: Date;
}

export interface OverrideTransferRecord {
  id: string;
  version: number;
  closedBy: string;
  closedAt: Date;
  administrativeReason: string;
  overrideOutcome: "assigned" | "released";
  overrideResponsibleId: string | null;
}

export interface AppendResponsibilityAuditRecord {
  id: string;
  actorId: string;
  actorRole: "admin" | "owner" | "warehouse" | "employee";
  subjectKind: "responsibility" | "transfer";
  subjectId: string;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface InventoryResponsibilityRepository {
  findItemState(itemId: string): Promise<ItemResponsibilityState | null>;
  findPendingTransfer(itemId: string): Promise<TransferRecord | null>;
  findTransfer(id: string): Promise<TransferRecord | null>;
  listTransfersForUser(userId: string): Promise<TransferRecord[]>;
  listTimeline(itemId: string): Promise<ResponsibilityTimelineRecord[]>;
  insertResponsibility(input: InsertResponsibilityRecord): Promise<void>;
  closeResponsibility(input: CloseResponsibilityRecord): Promise<void>;
  insertTransfer(input: InsertTransferRecord): Promise<TransferRecord>;
  decideTransfer(input: DecideTransferRecord): Promise<TransferRecord | null>;
  cancelTransfer(input: CancelTransferRecord): Promise<TransferRecord | null>;
  overrideTransfer(input: OverrideTransferRecord): Promise<TransferRecord | null>;
  appendAudit(input: AppendResponsibilityAuditRecord): Promise<void>;
}

export interface InventoryResponsibilityRepositories {
  responsibility: InventoryResponsibilityRepository;
}
