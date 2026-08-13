import type { TransferStatus } from "@/lib/contracts/inventory-responsibility";
import type { UserRole } from "@/lib/contracts/users";

export interface ItemResponsibilityState {
  itemId: string;
  responsibilityPeriodId: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  itemStatus: "active" | "maintenance" | "decommissioned";
}

export interface InventoryResponsibilityAuthorizationUser {
  id: string;
  role: UserRole;
  active: boolean;
  deletedAt: Date | null;
  version: number;
}

export interface ListTransfersForAuthorizedUser {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export interface TransferRecord {
  id: string;
  itemId: string;
  itemName?: string | null;
  itemInventoryNumber?: string | null;
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
  expectedResponsibilityPeriodId: string;
  expectedResponsibleUserId: string;
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
  currentResponsibleIdAtRequest: string;
  status: "confirmed" | "rejected";
  closedBy: string;
  closedAt: Date;
  decisionComment: string | null;
}

export interface CancelTransferRecord {
  id: string;
  version: number;
  requestedBy: string;
  closedBy: string;
  closedAt: Date;
}

export interface OverrideTransferRecord {
  id: string;
  expectedItemId: string;
  expectedResponsibilityPeriodId: string;
  expectedCurrentResponsibleId: string;
  version: number;
  administratorId: string;
  administratorSessionVersion: number;
  closedAt: Date;
  administrativeReason: string;
  overrideOutcome: "assigned" | "released";
  overrideResponsibleId: string | null;
}

export interface AppendResponsibilityAuditRecord {
  id: string;
  actorId: string;
  actorRole: UserRole;
  subjectKind: "responsibility" | "transfer";
  subjectId: string;
  subjectRevision?: number;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  reason?: string | null;
  isAdministrativeException?: boolean;
  occurredAt: Date;
}

export interface InventoryResponsibilityRepository {
  findItemState(itemId: string): Promise<ItemResponsibilityState | null>;
  findItemStateForUpdate(itemId: string): Promise<ItemResponsibilityState | null>;
  findAuthorizationUserForUpdate(
    userId: string,
  ): Promise<InventoryResponsibilityAuthorizationUser | null>;
  isUserActiveForUpdate(userId: string): Promise<boolean>;
  findPendingTransfer(itemId: string): Promise<TransferRecord | null>;
  findTransfer(id: string): Promise<TransferRecord | null>;
  findTransferForDecision(
    id: string,
    currentResponsibleId: string,
  ): Promise<TransferRecord | null>;
  findTransferForCancellation(
    id: string,
    requestedBy: string,
  ): Promise<TransferRecord | null>;
  findTransferForOverride(id: string): Promise<TransferRecord | null>;
  listTransfersForUser(userId: string): Promise<TransferRecord[]>;
  listTransfersForAuthorizedUser(
    input: ListTransfersForAuthorizedUser,
  ): Promise<TransferRecord[]>;
  listTimeline(itemId: string): Promise<ResponsibilityTimelineRecord[]>;
  insertResponsibility(input: InsertResponsibilityRecord): Promise<void>;
  closeResponsibility(input: CloseResponsibilityRecord): Promise<boolean>;
  insertTransfer(input: InsertTransferRecord): Promise<TransferRecord>;
  decideTransfer(input: DecideTransferRecord): Promise<TransferRecord | null>;
  cancelTransfer(input: CancelTransferRecord): Promise<TransferRecord | null>;
  overrideTransfer(input: OverrideTransferRecord): Promise<TransferRecord | null>;
  appendAudit(input: AppendResponsibilityAuditRecord): Promise<void>;
}

export interface InventoryResponsibilityRepositories {
  responsibility: InventoryResponsibilityRepository;
}
