export interface CreateTmcTransferRequestInput {
  recipientId: string;
  itemIds: readonly string[];
  requestKind?: "handover" | "claim";
  quantityTransfers?: readonly {
    itemId: string;
    sourceLocalGroupId: string | null;
    sourceVersion: number;
    quantity: number;
  }[];
  comment?: string | null;
}

export interface TmcTransferItemDecision {
  itemId: string;
  itemVersion: number;
  decision: "accept" | "reject";
}

export interface CancelTmcTransferRequestInput {
  requestVersion: number;
  administrativeReason?: string | null;
}

export interface TmcOperationItemReference {
  itemId: string;
  itemVersion: number;
}

export type AcceptUnassignedTmcInput = TmcOperationItemReference;

export interface BulkChangeTmcLocationInput {
  items: readonly TmcOperationItemReference[];
  roomId: string;
  comment?: string | null;
}

export interface DecideTmcTransferRequestInput {
  requestVersion: number;
  decisions: readonly TmcTransferItemDecision[];
  /** Used only when server-side authorization identifies an admin override. */
  administrativeReason?: string | null;
}

export interface CancelTmcTransferRequestInput {
  requestVersion: number;
  /** Used only when server-side authorization identifies an admin override. */
  administrativeReason?: string | null;
}
