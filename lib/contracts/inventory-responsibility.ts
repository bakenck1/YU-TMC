export type TransferStatus =
  | "pending_current_owner"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "overridden";

export interface ResponsibilityDto {
  itemId: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  startedAt: string | null;
}

export interface ResponsibilityTimelineEntryDto {
  id: string;
  kind: "responsibility" | "transfer";
  occurredAt: string;
  actorName: string | null;
  responsibleName: string | null;
  status: string;
  detail: string | null;
  closedAt: string | null;
}

export interface TransferDto {
  id: string;
  itemId: string;
  requestedByName: string;
  status: TransferStatus;
  requestedAt: string;
  closedAt: string | null;
  decisionComment: string | null;
  version: number;
}

export interface CreateTransferInput {
  itemId: string;
}

export interface DecideTransferInput {
  version: number;
  decision: "confirm" | "reject";
  comment?: string | null;
}
