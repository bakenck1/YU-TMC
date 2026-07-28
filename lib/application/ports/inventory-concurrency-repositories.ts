export const VERSIONED_INVENTORY_RECORDS = [
  "building",
  "room",
  "item",
  "inspection",
  "qr_identifier",
  "transfer",
  "deviation_decision",
  "photo",
] as const;

export type VersionedInventoryRecord =
  (typeof VERSIONED_INVENTORY_RECORDS)[number];

export interface AdvanceInventoryRecordVersionInput {
  id: string;
  record: VersionedInventoryRecord;
  expectedVersion: number;
}

export interface VersionedInventoryRecordRepository {
  advanceVersion(
    input: AdvanceInventoryRecordVersionInput,
  ): Promise<number | null>;
}

export interface IdempotencyRequestInput {
  actorId: string;
  operation: string;
  key: string;
  requestHash: string;
  expiresAt: Date;
  id: string;
}

export interface IdempotencyResponse {
  body: Record<string, unknown>;
  resourceId?: string;
  status: number;
}

export type IdempotencyReservation =
  | { kind: "reserved"; id: string }
  | { kind: "replay"; response: IdempotencyResponse }
  | { kind: "in_progress" }
  | { kind: "key_reused" };

export interface IdempotencyRequestRepository {
  reserve(input: IdempotencyRequestInput): Promise<IdempotencyReservation>;
  complete(
    id: string,
    response: IdempotencyResponse,
    completedAt: Date,
  ): Promise<void>;
}

export interface InventoryConcurrencyRepositories {
  idempotency: IdempotencyRequestRepository;
  versions: VersionedInventoryRecordRepository;
}
