import type {
  IdempotencyRequestInput,
  IdempotencyReservation,
  IdempotencyResponse,
} from "../../lib/application/ports/inventory-concurrency-repositories";
import type {
  InsertTmcTransferRequestItemRecord,
  InsertTmcTransferRequestRecord,
  InsertedTmcTransferRequestItemRecord,
  DecideTmcTransferRequestItemRecord,
  CloseTmcTransferRequestRecord,
  CancelTmcTransferRequestRecord,
  TmcOperationRepositories,
  TmcTransferCandidateRecord,
  TmcTransferRequestRecord,
  TmcTransferRequestRepository,
  TmcTransferUserRecord,
} from "../../lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "../../lib/application/ports/tmc-operation-repositories";
import type { UnitOfWork } from "../../lib/application/ports/unit-of-work";
import { TmcTransferRequestService } from "../../lib/application/services/tmc-transfer-request-service";
import { ApplicationError } from "../../lib/domain/application-error";

export const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "employee" as const,
  sessionVersion: 1,
};
export const RECIPIENT_ID = "22222222-2222-4222-8222-222222222222";
export const SNAPSHOT_OWNER_ID = "33333333-3333-4333-8333-333333333333";
export const NOW = new Date("2026-08-09T12:00:00.000Z");
export const IDEMPOTENCY_KEY = "tmc-create-000001";

export function createHarness(options: {
  recipient?: TmcTransferUserRecord | null;
  actors?: TmcTransferUserRecord[];
  candidates?: TmcTransferCandidateRecord[];
  now?: Date;
  times?: Date[];
} = {}) {
  const repository = new MemoryRequestRepository();
  repository.recipient = options.recipient === undefined ? user() : options.recipient;
  if (repository.recipient) {
    repository.users.set(repository.recipient.id, repository.recipient);
  }
  repository.users.set(ACTOR.userId, user({ id: ACTOR.userId }));
  for (const actor of options.actors ?? []) {
    repository.users.set(actor.id, actor);
  }
  repository.candidates = options.candidates ?? [];
  const unitOfWork = new MemoryUnitOfWork(repository);
  const ids = {
    created: 0,
    create() {
      this.created += 1;
      return `90000000-0000-4000-8000-${String(this.created).padStart(12, "0")}`;
    },
  };
  const times = [...(options.times ?? [options.now ?? NOW])];
  let clockCalls = 0;
  const clock = {
    now() {
      const value = times[Math.min(clockCalls, times.length - 1)]!;
      clockCalls += 1;
      return value;
    },
  };
  return {
    repository,
    unitOfWork,
    ids,
    clockCalls: () => clockCalls,
    service: new TmcTransferRequestService(unitOfWork, clock, ids),
  };
}

export class MemoryUnitOfWork implements UnitOfWork<TmcOperationRepositories> {
  transactions = 0;
  readonly idempotency = new MemoryIdempotencyRepository();
  private depth = 0;
  readonly stageFour = {
    audits: [] as unknown[],
    notifications: [] as unknown[],
    async listHistory() { return []; },
    async listLocationHistory() { return []; },
    async appendAudit(input: unknown) { this.audits.push(input); },
    async createNotification(input: unknown) { this.notifications.push(input); },
    async listNotifications() { return []; },
    async countUnreadNotifications() { return 0; },
    async markNotificationRead() { return false; },
    async markAllNotificationsRead() {},
  };
  constructor(private readonly repository: TmcTransferRequestRepository) {}
  read<Result>(work: (repositories: TmcOperationRepositories) => Promise<Result>) {
    return work({
      idempotency: this.idempotency,
      transferRequests: this.repository,
      stageFour: this.stageFour,
    });
  }
  async transaction<Result>(work: (repositories: TmcOperationRepositories) => Promise<Result>) {
    const outer = this.depth === 0;
    if (outer) this.transactions += 1;
    const memory = this.repository as MemoryRequestRepository;
    const requestCount = memory.insertedRequests.length;
    const itemCount = memory.insertedItems.length;
    const resultCount = memory.insertedItemResults.length;
    const decisionCount = memory.decisionCalls.length;
    const aggregateSnapshot = structuredClone(memory.aggregate);
    const idempotencySnapshot = this.idempotency.snapshot();
    this.depth += 1;
    try {
      return await work({
        idempotency: this.idempotency,
        transferRequests: this.repository,
        stageFour: this.stageFour,
      });
    } catch (error) {
      memory.insertedRequests.length = requestCount;
      memory.insertedItems.length = itemCount;
      memory.insertedItemResults.length = resultCount;
      memory.decisionCalls.length = decisionCount;
      memory.aggregate = aggregateSnapshot;
      this.idempotency.restore(idempotencySnapshot);
      throw error;
    } finally {
      this.depth -= 1;
    }
  }
}

interface MemoryIdempotencyRecord {
  id: string;
  requestHash: string;
  response: IdempotencyResponse | null;
  state: "processing" | "completed";
}

export class MemoryIdempotencyRepository {
  failNextCompletion = false;
  private records = new Map<string, MemoryIdempotencyRecord>();

  async reserve(input: IdempotencyRequestInput): Promise<IdempotencyReservation> {
    const scope = `${input.actorId}\u0000${input.operation}\u0000${input.key}`;
    const existing = this.records.get(scope);
    if (!existing) {
      this.records.set(scope, {
        id: input.id,
        requestHash: input.requestHash,
        response: null,
        state: "processing",
      });
      return { kind: "reserved", id: input.id };
    }
    if (existing.requestHash !== input.requestHash) {
      return { kind: "key_reused" };
    }
    if (existing.state === "processing") return { kind: "in_progress" };
    return {
      kind: "replay",
      response: structuredClone(existing.response!),
    };
  }

  async complete(id: string, response: IdempotencyResponse) {
    const record = [...this.records.values()].find((value) => value.id === id);
    if (!record || record.state !== "processing") {
      throw new ApplicationError("conflict", "idempotency_request_not_processing");
    }
    record.state = "completed";
    record.response = structuredClone(response);
    if (this.failNextCompletion) {
      this.failNextCompletion = false;
      throw new Error("injected_idempotency_completion_failure");
    }
  }

  snapshot() {
    return structuredClone(this.records);
  }

  restore(snapshot: Map<string, MemoryIdempotencyRecord>) {
    this.records = snapshot;
  }

  corruptCompletedResponse(response: IdempotencyResponse) {
    const record = [...this.records.values()].find(
      (value) => value.state === "completed",
    );
    if (!record) throw new Error("missing_completed_idempotency_record");
    record.response = structuredClone(response);
  }
}

export class MemoryRequestRepository implements TmcTransferRequestRepository {
  recipient: TmcTransferUserRecord | null = user();
  candidates: TmcTransferCandidateRecord[] = [];
  aggregate: TmcTransferRequestRecord | null | undefined;
  calls: string[] = [];
  insertedRequests: InsertTmcTransferRequestRecord[] = [];
  insertedItems: InsertTmcTransferRequestItemRecord[] = [];
  insertedItemResults: InsertedTmcTransferRequestItemRecord[] = [];
  findByIdCalls = 0;
  requestedRecipientIds: string[] = [];
  requestedCandidateIds: string[][] = [];
  failures = new Map<string, TmcOperationRepositoryConflictError>();
  users = new Map<string, TmcTransferUserRecord>();
  photo: { bytes: Uint8Array; mimeType: "image/jpeg" } | null = null;
  photoCalls: string[][] = [];
  decisionCalls: DecideTmcTransferRequestItemRecord[] = [];
  decisionResults = new Map<string, "accepted" | "rejected" | "invalidated">();
  decisionFailureItemId: string | null = null;

  async findUserById(id: string) {
    this.calls.push("findUserById");
    this.requestedRecipientIds.push(id);
    return this.users.get(id) ?? null;
  }
  async findCandidates(itemIds: readonly string[]) {
    this.calls.push("findCandidates");
    this.requestedCandidateIds.push([...itemIds]);
    return this.candidates;
  }
  async findById(_id?: string) {
    this.calls.push("findById");
    this.findByIdCalls += 1;
    const aggregate = this.aggregate !== undefined ? this.aggregate : (
      this.insertedItems.length > 0
        ? requestRecord(
            this.insertedItems.map((item) => candidate(item.itemId)),
            { id: this.insertedRequests[0]!.id, comment: this.insertedRequests[0]!.comment },
          )
        : null
    );
    if (!aggregate) return null;
    if (_id && aggregate.id !== _id) return null;
    return {
      ...aggregate,
      items: aggregate.items.map((item) => ({
        ...item,
        requestId: aggregate.id,
        id: this.insertedItemResults.find(
          (inserted) => inserted.itemId === item.itemId,
        )?.id ?? item.id,
      })),
    };
  }
  async findByIdForUpdate(id: string) {
    return this.findById(id);
  }
  async findItemPhoto(requestId: string, itemId: string) {
    this.photoCalls.push([requestId, itemId]);
    return this.photo;
  }
  async decideItem(input: DecideTmcTransferRequestItemRecord) {
    this.decisionCalls.push(input);
    if (input.itemId === this.decisionFailureItemId) {
      throw new ApplicationError("conflict", "version_conflict");
    }
    const item = this.aggregate?.items.find((candidate) => candidate.id === input.requestItemId);
    if (!item || item.result !== "pending" || item.version !== input.expectedVersion) {
      throw new ApplicationError("conflict", "version_conflict");
    }
    const result = this.decisionResults.get(input.itemId) ?? (input.decision === "accept" ? "accepted" as const : "rejected" as const);
    Object.assign(item, {
      result,
      invalidReason: result === "invalidated" ? "responsibility_changed" : null,
      decidedAt: input.decidedAt,
      decidedBy: operationUser(input.decidedBy),
      version: item.version + 1,
    });
    return result;
  }
  async closeRequest(input: CloseTmcTransferRequestRecord) {
    if (!this.aggregate || this.aggregate.version !== input.expectedVersion) return false;
    Object.assign(this.aggregate, {
      status: input.status,
      closedAt: input.closedAt,
      closedBy: operationUser(input.closedBy),
      isAdministrativeDecision: input.isAdministrativeDecision,
      administrativeReason: input.administrativeReason,
      version: this.aggregate.version + 1,
    });
    return true;
  }
  async cancelRequest(input: CancelTmcTransferRequestRecord) {
    if (!this.aggregate || this.aggregate.version !== input.expectedVersion || this.aggregate.status !== "pending") return false;
    for (const item of this.aggregate.items) {
      if (item.result === "pending") Object.assign(item, {
        result: "cancelled", decidedAt: input.cancelledAt,
        decidedBy: operationUser(input.cancelledBy), version: item.version + 1,
      });
    }
    Object.assign(this.aggregate, {
      status: "cancelled", closedAt: input.cancelledAt,
      closedBy: operationUser(input.cancelledBy),
      isAdministrativeDecision: input.isAdministrativeDecision,
      administrativeReason: input.administrativeReason,
      version: this.aggregate.version + 1,
    });
    return true;
  }
  async insertRequest(input: InsertTmcTransferRequestRecord) {
    this.calls.push("insertRequest");
    this.insertedRequests.push(input);
  }
  async insertRequestItem(input: InsertTmcTransferRequestItemRecord) {
    this.calls.push("insertRequestItem");
    const failure = this.failures.get(input.itemId);
    if (failure) throw failure;
    this.insertedItems.push(input);
    const result: InsertedTmcTransferRequestItemRecord = {
      ...input,
      requestedQuantity: input.requestedQuantity ?? null,
      sourceLocalGroupId: input.sourceLocalGroupId ?? null,
      sourceVersion: input.sourceVersion ?? null,
      result: "pending",
      invalidReason: null,
      decidedAt: null,
      decidedBy: null,
      version: 1,
    };
    this.insertedItemResults.push(result);
    const aggregateItem = this.aggregate?.items.find(
      (item) => item.itemId === input.itemId,
    );
    if (aggregateItem) {
      aggregateItem.id = input.id;
      aggregateItem.requestId = input.requestId;
    }
    return result;
  }
}

export function candidate(
  itemId: string,
  overrides: Partial<TmcTransferCandidateRecord> = {},
): TmcTransferCandidateRecord {
  return {
    itemId,
    itemVersion: 1,
    itemStatus: "active",
    archivedAt: null,
    name: `Item ${itemId}`,
    inventoryNumber: `INV-${itemId}`,
    quantity: 1,
    unitPrice: 100,
    photoUrl: null,
    buildingId: uuid(80),
    buildingName: "Building",
    roomId: uuid(81),
    roomDesignation: "101",
    responsibilityPeriodId: uuid(90),
    responsibleUser: user({ id: ACTOR.userId }),
    hasActiveTransfer: false,
    ...overrides,
  };
}

export function user(overrides: Partial<TmcTransferUserRecord> = {}): TmcTransferUserRecord {
  return {
    ...operationUser(RECIPIENT_ID),
    active: true,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

export function operationUser(id: string, role: TmcTransferUserRecord["role"] = "employee") {
  return { id, fullName: `User ${id}`, email: `${id}@example.com`, role };
}

export function requestRecord(
  candidates: TmcTransferCandidateRecord[],
  overrides: Partial<TmcTransferRequestRecord> = {},
): TmcTransferRequestRecord {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    initiator: operationUser(ACTOR.userId),
    recipient: operationUser(RECIPIENT_ID),
    status: "pending",
    comment: null,
    createdAt: NOW,
    expiresAt: new Date("2026-08-10T12:00:00.000Z"),
    closedAt: null,
    closedBy: null,
    isAdministrativeDecision: false,
    administrativeReason: null,
    version: 1,
    items: candidates.map((item) => requestItem(item, "pending")),
    ...overrides,
  };
}

export function requestItem(
  candidateRecord: TmcTransferCandidateRecord,
  result: "pending" | "accepted" | "rejected" | "cancelled" | "invalidated",
) {
  const terminal = result !== "pending";
  return {
    id: `80000000-0000-4000-8000-${candidateRecord.itemId.slice(-12)}`,
    requestId: "90000000-0000-4000-8000-000000000001",
    itemId: candidateRecord.itemId,
    item: {
      id: candidateRecord.itemId,
      version: candidateRecord.itemVersion,
      name: candidateRecord.name,
      inventoryNumber: candidateRecord.inventoryNumber,
      quantity: candidateRecord.quantity,
      unitPrice: candidateRecord.unitPrice,
      photoUrl: candidateRecord.photoUrl,
      buildingId: candidateRecord.buildingId,
      buildingName: candidateRecord.buildingName,
      roomId: candidateRecord.roomId,
      roomDesignation: candidateRecord.roomDesignation,
    },
    responsibilityPeriodIdAtRequest: candidateRecord.responsibilityPeriodId!,
    currentResponsibleIdAtRequest: candidateRecord.responsibleUser!.id,
    requestedQuantity: null,
    sourceLocalGroupId: null,
    sourceVersion: null,
    responsibleUserProfile: candidateRecord.responsibleUser!,
    result,
    invalidReason: result === "invalidated" ? "responsibility_changed" : null,
    createdAt: NOW,
    decidedAt: terminal ? NOW : null,
    decidedBy: terminal ? operationUser(RECIPIENT_ID) : null,
    version: terminal ? 2 : 1,
  };
}

export function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
