import type {
  CancelLocalBarcodeInput,
  CreateLocalBarcodeTransferInput,
  LocalBarcodeDistributionDto,
  LocalBarcodeGroupDto,
  LocalBarcodeHistoryEventDto,
  LocalBarcodeTransferResultDto,
} from "@/lib/contracts/local-barcodes";
import type {
  LocalBarcodeGroupRecord,
  LocalBarcodeItemRecord,
  LocalBarcodeRepositories,
} from "@/lib/application/ports/local-barcode-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { executeIdempotentCommand } from "@/lib/application/services/idempotent-command-service";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { buildLocalBarcode, localBarcodeComparisonKey } from "@/lib/domain/local-barcode";
import { hasPermission, type AuthorizationActor } from "@/lib/security/permissions";

const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type AuthenticatedActor = AuthorizationActor & { sessionVersion: number };

export class LocalBarcodeService {
  constructor(
    private readonly unitOfWork: UnitOfWork<LocalBarcodeRepositories>,
    private readonly clock: { now(): Date },
    private readonly ids: { create(): string },
  ) {}

  async transferIdempotent(input: CreateLocalBarcodeTransferInput, actor: AuthenticatedActor, keyInput: unknown) {
    const normalized = normalizeTransfer(input);
    const key = normalizeKey(keyInput);
    const execution = await executeIdempotentCommand(this.unitOfWork, {
      id: this.ids.create(), actorId: actor.userId, operation: "local_barcode.transfer",
      key, requestHash: await sha256Hex(normalized), expiresInMs: IDEMPOTENCY_LIFETIME_MS,
    }, async () => {
      const result = await this.transfer(normalized, actor);
      return { status: 201, resourceId: result.group.id, body: { result } };
    }, { transaction: { isolation: "serializable", maxAttempts: 3 } });
    return { ...(execution.response.body as { result: LocalBarcodeTransferResultDto }), replayed: execution.kind === "replayed" };
  }

  async transfer(input: CreateLocalBarcodeTransferInput, actor: AuthenticatedActor): Promise<LocalBarcodeTransferResultDto> {
    const normalized = normalizeTransfer(input);
    return this.unitOfWork.transaction(async ({ localBarcodes }) => {
      const currentActor = await requireLiveActor(localBarcodes, actor);
      if (!hasPermission(currentActor.role, "inventory.local_barcode.transfer")) throw forbidden();
      const recipient = await localBarcodes.findRecipientForUpdate(normalized.recipientUserId);
      if (!recipient || !recipient.active || recipient.deletedAt || recipient.role !== "employee") {
        throw validation("recipient_unavailable");
      }
      const item = await localBarcodes.findItemForUpdate(normalized.itemId);
      if (!item) throw notFound("item_not_found");
      if (item.status !== "active") throw conflict("item_not_available");
      if (/^TMP-\d{4}-\d{6}$/i.test(item.inventoryNumber)) {
        throw validation("source_barcode_required");
      }
      const occurredAt = this.clock.now();

      if (normalized.sourceGroupId) {
        const source = await localBarcodes.findGroupForUpdate(normalized.sourceGroupId);
        if (!source || source.itemId !== item.id) throw notFound("local_group_not_found");
        if (source.status !== "active") throw conflict("local_group_cancelled");
        if (source.version !== normalized.sourceVersion) throw conflict("version_conflict");
        if (source.responsibleUserId !== currentActor.id) throw forbidden();
        if (source.responsibleUserId === recipient.id) throw conflict("already_responsible");
        if (normalized.quantity > source.quantity) throw conflict("quantity_exceeds_available");
        if (normalized.quantity === source.quantity) {
          const roomId = recipient.defaultRoomId && recipient.roomActive ? recipient.defaultRoomId : source.roomId;
          const updated = await localBarcodes.transferWholeGroup({ id: source.id, version: source.version, responsibleUserId: recipient.id, roomId, transferredAt: occurredAt });
          if (!updated) throw conflict("version_conflict");
          await localBarcodes.insertEvent({ id: this.ids.create(), groupId: source.id, eventType: "transferred", actorId: currentActor.id, fromResponsibleUserId: source.responsibleUserId, toResponsibleUserId: recipient.id, quantity: source.quantity, roomId, reason: null, occurredAt });
          await localBarcodes.appendAudit({ id: this.ids.create(), actorId: currentActor.id, actorRole: currentActor.role, groupId: source.id, revision: source.version + 1, action: "local_barcode.transferred", beforeValues: { responsibleUserId: source.responsibleUserId, roomId: source.roomId, quantity: source.quantity }, afterValues: { responsibleUserId: recipient.id, roomId, quantity: source.quantity }, reason: null, administrative: false, occurredAt });
          return { group: toDto((await localBarcodes.findGroup(source.id))!), createdNewCode: false };
        }
        if (!(await localBarcodes.reduceGroupQuantity(source.id, source.version, normalized.quantity))) throw conflict("version_conflict");
        return this.createSplit(localBarcodes, item, source, recipient, normalized.quantity, currentActor, occurredAt);
      }

      if (item.version !== normalized.sourceVersion) throw conflict("version_conflict");
      const allocated = await localBarcodes.allocatedQuantity(item.id);
      const available = item.quantity - allocated;
      if (normalized.quantity > available) throw conflict("quantity_exceeds_available");
      if (item.responsibleUserId !== currentActor.id && !(currentActor.role === "admin" && item.responsibleUserId === null)) throw forbidden();
      if (item.responsibleUserId === recipient.id) throw conflict("already_responsible");
      if (!(await localBarcodes.advanceItemVersion(item.id, item.version))) throw conflict("version_conflict");
      return this.createSplit(localBarcodes, item, null, recipient, normalized.quantity, currentActor, occurredAt);
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  private async createSplit(localBarcodes: LocalBarcodeRepositories["localBarcodes"], item: LocalBarcodeItemRecord, source: LocalBarcodeGroupRecord | null, recipient: { id: string; defaultRoomId: string | null; roomActive: boolean }, quantity: number, actor: { id: string; role: AuthenticatedActor["role"] }, occurredAt: Date): Promise<LocalBarcodeTransferResultDto> {
    const roomId = recipient.defaultRoomId && recipient.roomActive ? recipient.defaultRoomId : (source?.roomId ?? item.roomId);
    let sequence: bigint | null = null;
    let barcodeValue = "";
    let barcodeKey = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      sequence = await localBarcodes.nextSequence();
      try {
        barcodeValue = buildLocalBarcode(item.inventoryNumber, sequence);
      } catch (error) {
        if (error instanceof RangeError) {
          throw validation("source_barcode_not_code39");
        }
        throw error;
      }
      barcodeKey = localBarcodeComparisonKey(barcodeValue);
      if (!(await localBarcodes.isBarcodeRegistered(barcodeKey))) break;
      sequence = null;
    }
    if (sequence === null) throw conflict("local_barcode_namespace_exhausted");
    const id = this.ids.create();
    await localBarcodes.insertGroup({ id, itemId: item.id, parentGroupId: source?.id ?? null, sequenceNumber: sequence, barcodeValue, barcodeKey, quantity, responsibleUserId: recipient.id, roomId, previousResponsibleUserId: source?.responsibleUserId ?? item.responsibleUserId, previousRoomId: source?.roomId ?? item.roomId, createdBy: actor.id, occurredAt });
    await localBarcodes.insertEvent({ id: this.ids.create(), groupId: id, eventType: source ? "split" : "created", actorId: actor.id, fromResponsibleUserId: source?.responsibleUserId ?? item.responsibleUserId, toResponsibleUserId: recipient.id, quantity, roomId, reason: null, occurredAt });
    await localBarcodes.appendAudit({ id: this.ids.create(), actorId: actor.id, actorRole: actor.role, groupId: id, revision: 1, action: source ? "local_barcode.split" : "local_barcode.created", beforeValues: { sourceGroupId: source?.id ?? null, sourceQuantity: source?.quantity ?? item.quantity }, afterValues: { barcodeValue, quantity, responsibleUserId: recipient.id, roomId }, reason: null, administrative: false, occurredAt });
    return { group: toDto((await localBarcodes.findGroup(id))!), createdNewCode: true };
  }

  async cancelIdempotent(groupId: string, input: CancelLocalBarcodeInput, actor: AuthenticatedActor, keyInput: unknown) {
    const normalized = normalizeCancel(groupId, input);
    const key = normalizeKey(keyInput);
    const execution = await executeIdempotentCommand(this.unitOfWork, { id: this.ids.create(), actorId: actor.userId, operation: "local_barcode.cancel", key, requestHash: await sha256Hex(normalized), expiresInMs: IDEMPOTENCY_LIFETIME_MS }, async () => ({ status: 200, resourceId: normalized.groupId, body: { group: await this.cancel(normalized.groupId, normalized, actor) } }), { transaction: { isolation: "serializable", maxAttempts: 3 } });
    return { ...(execution.response.body as { group: LocalBarcodeGroupDto }), replayed: execution.kind === "replayed" };
  }

  async cancel(groupId: string, input: CancelLocalBarcodeInput, actor: AuthenticatedActor): Promise<LocalBarcodeGroupDto> {
    const normalized = normalizeCancel(groupId, input);
    return this.unitOfWork.transaction(async ({ localBarcodes }) => {
      const currentActor = await requireLiveActor(localBarcodes, actor);
      if (!hasPermission(currentActor.role, "inventory.local_barcode.cancel")) throw forbidden();
      const snapshot = await localBarcodes.findGroup(normalized.groupId);
      if (!snapshot) throw notFound("local_group_not_found");
      const item = await localBarcodes.findItemForUpdate(snapshot.itemId);
      if (!item) {
        throw notFound("item_not_found");
      }
      const group = await localBarcodes.findGroupForUpdate(normalized.groupId);
      if (!group) throw notFound("local_group_not_found");
      if (group.status !== "active") throw conflict("local_group_already_cancelled");
      if (group.version !== normalized.version) throw conflict("version_conflict");
      if ((await localBarcodes.countActiveChildren(group.id)) > 0) throw conflict("local_group_has_active_children");
      if (group.parentGroupId) {
        const parent = await localBarcodes.findGroupForUpdate(group.parentGroupId);
        if (!parent || parent.status !== "active" || parent.responsibleUserId !== group.previousResponsibleUserId || parent.roomId !== group.previousRoomId) throw conflict("cancellation_return_target_changed");
        if (!(await localBarcodes.increaseGroupQuantity(parent.id, group.quantity))) throw conflict("cancellation_return_target_changed");
      } else if (!(await localBarcodes.advanceItemVersion(item.id, item.version))) {
        throw conflict("version_conflict");
      }
      const occurredAt = this.clock.now();
      if (!(await localBarcodes.cancelGroup({ id: group.id, version: group.version, cancelledBy: currentActor.id, cancelledAt: occurredAt, reason: normalized.reason }))) throw conflict("version_conflict");
      await localBarcodes.insertEvent({ id: this.ids.create(), groupId: group.id, eventType: "cancelled", actorId: currentActor.id, fromResponsibleUserId: group.responsibleUserId, toResponsibleUserId: group.previousResponsibleUserId, quantity: group.quantity, roomId: group.previousRoomId ?? group.roomId, reason: normalized.reason, occurredAt });
      await localBarcodes.appendAudit({ id: this.ids.create(), actorId: currentActor.id, actorRole: currentActor.role, groupId: group.id, revision: group.version + 1, action: "local_barcode.cancelled", beforeValues: { status: group.status, quantity: group.quantity, responsibleUserId: group.responsibleUserId }, afterValues: { status: "cancelled", returnedToGroupId: group.parentGroupId, returnedToResponsibleUserId: group.previousResponsibleUserId }, reason: normalized.reason, administrative: true, occurredAt });
      return toDto((await localBarcodes.findGroup(group.id))!);
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  async getGroup(id: string, actor: AuthorizationActor): Promise<LocalBarcodeGroupDto> {
    if (!isUuid(id)) throw notFound("local_group_not_found");
    return this.unitOfWork.read(async ({ localBarcodes }) => {
      const group = await localBarcodes.findGroup(id.toLowerCase());
      if (!group || !canRead(actor, group.responsibleUserId)) throw notFound("local_group_not_found");
      return toDto(group);
    });
  }

  async resolveBarcode(value: unknown, actor: AuthorizationActor): Promise<LocalBarcodeGroupDto | null> {
    let key: string;
    try { key = localBarcodeComparisonKey(value); } catch { return null; }
    return this.unitOfWork.read(async ({ localBarcodes }) => {
      const group = await localBarcodes.findGroupByBarcodeKey(key);
      return group && canRead(actor, group.responsibleUserId) ? toDto(group) : null;
    });
  }

  async getDistribution(itemId: string, actor: AuthorizationActor): Promise<LocalBarcodeDistributionDto> {
    if (!isUuid(itemId)) throw notFound("item_not_found");
    return this.unitOfWork.read(async ({ localBarcodes }) => {
      const item = await localBarcodes.findItem(itemId.toLowerCase());
      if (!item) throw notFound("item_not_found");
      const groups = await localBarcodes.listGroups(item.id);
      if (!hasPermission(actor.role, "inventory.local_barcode.read_all") && actor.userId !== item.responsibleUserId && !groups.some((group) => group.status === "active" && group.responsibleUserId === actor.userId)) throw notFound("item_not_found");
      const active = groups.filter((group) => group.status === "active");
      return { itemId: item.id, itemName: item.name, originalBarcode: item.inventoryNumber, originalQuantity: item.quantity, originalVersion: item.version, originalRemainder: item.quantity - active.reduce((sum, group) => sum + group.quantity, 0), originalResponsible: item.responsibleUserId ? { id: item.responsibleUserId, fullName: item.responsibleName ?? "" } : null, originalLocation: { roomId: item.roomId, roomDesignation: item.roomDesignation, buildingId: item.buildingId, buildingName: item.buildingName }, groups: groups.map(toDto) };
    });
  }

  async getHistory(groupId: string, actor: AuthorizationActor): Promise<LocalBarcodeHistoryEventDto[]> {
    const group = await this.getGroup(groupId, actor);
    return this.unitOfWork.read(async ({ localBarcodes }) => (await localBarcodes.listEvents(group.id)).map((event) => ({ id: event.id, type: event.eventType, occurredAt: event.occurredAt.toISOString(), actor: { id: event.actorId, fullName: event.actorName }, fromResponsible: event.fromResponsibleUserId ? { id: event.fromResponsibleUserId, fullName: event.fromResponsibleName ?? "" } : null, toResponsible: event.toResponsibleUserId ? { id: event.toResponsibleUserId, fullName: event.toResponsibleName ?? "" } : null, quantity: event.quantity, location: { roomId: event.roomId, roomDesignation: event.roomDesignation, buildingId: event.buildingId, buildingName: event.buildingName }, reason: event.reason })));
  }
}

function toDto(group: LocalBarcodeGroupRecord): LocalBarcodeGroupDto {
  return { id: group.id, itemId: group.itemId, itemName: group.itemName, originalBarcode: group.originalBarcode, localBarcode: group.barcodeValue, parentGroupId: group.parentGroupId, quantity: group.quantity, responsible: { id: group.responsibleUserId, fullName: group.responsibleName }, location: { roomId: group.roomId, roomDesignation: group.roomDesignation, buildingId: group.buildingId, buildingName: group.buildingName }, transferredAt: group.transferredAt.toISOString(), status: group.status, version: group.version, cancellation: group.status === "cancelled" ? { reason: group.cancellationReason!, cancelledAt: group.cancelledAt!.toISOString(), administrator: { id: group.cancelledBy!, fullName: group.cancelledByName ?? "" } } : null };
}

function canRead(actor: AuthorizationActor, responsibleId: string) { return hasPermission(actor.role, "inventory.local_barcode.read_all") || (actor.userId === responsibleId && hasPermission(actor.role, "inventory.local_barcode.read_assigned")); }
async function requireLiveActor(repo: LocalBarcodeRepositories["localBarcodes"], actor: AuthenticatedActor) { const current = await repo.findActorForUpdate(actor.userId); if (!current || !current.active || current.deletedAt || current.role !== actor.role || current.version !== actor.sessionVersion) throw forbidden(); return current; }
function normalizeTransfer(input: CreateLocalBarcodeTransferInput): CreateLocalBarcodeTransferInput { if (!input || typeof input !== "object" || !isUuid(input.itemId) || (input.sourceGroupId !== null && !isUuid(input.sourceGroupId)) || !isUuid(input.recipientUserId) || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || !Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1) throw validation("invalid_local_transfer"); return { itemId: input.itemId.toLowerCase(), sourceGroupId: input.sourceGroupId?.toLowerCase() ?? null, recipientUserId: input.recipientUserId.toLowerCase(), quantity: input.quantity, sourceVersion: input.sourceVersion }; }
function normalizeCancel(groupId: string, input: CancelLocalBarcodeInput) { const reason = typeof input?.reason === "string" ? input.reason.normalize("NFKC").trim() : ""; if (!isUuid(groupId) || !Number.isSafeInteger(input?.version) || input.version < 1 || !reason || [...reason].length > 1000) throw validation("invalid_local_cancellation"); return { groupId: groupId.toLowerCase(), version: input.version, reason }; }
function normalizeKey(value: unknown) { if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) throw validation("idempotency_key_invalid"); return value; }
async function sha256Hex(value: unknown) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function validation(code: string) { return new ApplicationError("validation", code); }
function conflict(code: string) { return new ApplicationError("conflict", code); }
function notFound(code: string) { return new ApplicationError("not_found", code); }
function forbidden() { return new ApplicationError("forbidden", "forbidden"); }
