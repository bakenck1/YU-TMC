import type { AssetLossRepository, AssetLossRepositories, AssetLossRecord } from "@/lib/application/ports/asset-loss-repository";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type { AssetLossCaseDto, AssetLossPageDto } from "@/lib/contracts/asset-loss";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";

export interface AssetLossActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export interface NormalizedLossReceipt {
  bytes: Uint8Array;
  width: number;
  height: number;
  mediaType: "image/jpeg";
}

interface Dependencies {
  now(): Date;
  id(): string;
  checksum(bytes: Uint8Array): string;
}

const PAGE_SIZE = 100;

export class AssetLossService {
  constructor(
    private readonly unitOfWork: UnitOfWork<AssetLossRepositories>,
    private readonly dependencies: Dependencies,
  ) {}

  async list(actor: AssetLossActor, cursor?: string): Promise<AssetLossPageDto> {
    const before = cursor ? decodeCursor(cursor) : null;
    return this.unitOfWork.transaction(async ({ assetLosses }) => {
      const current = await requireActor(assetLosses, actor, false);
      const rows = await assetLosses.list({
        employeeId: current.role === "admin" ? null : current.id,
        before,
        limit: PAGE_SIZE + 1,
      });
      const hasMore = rows.length > PAGE_SIZE;
      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);
      return {
        lossCases: page.map(toDto),
        nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    }, { isolation: "repeatable-read", readOnly: true, maxAttempts: 1 });
  }

  async create(input: { itemId: string; employeeId?: string; amount?: string }, actor: AssetLossActor) {
    assertUuid(input.itemId, "invalid_loss_item_id");
    if (input.employeeId !== undefined) assertUuid(input.employeeId, "invalid_loss_employee_id");
    return this.unitOfWork.transaction(async ({ assetLosses }) => {
      const current = await requireActor(assetLosses, actor, true);
      const employeeId = current.role === "admin" && input.employeeId ? input.employeeId : current.id;
      if (current.role !== "admin" && input.employeeId && input.employeeId !== current.id) throw forbidden();
      const item = await assetLosses.findAssignableItemForUpdate(input.itemId, employeeId);
      if (!item) throw new ApplicationError("not_found", "loss_item_not_found");
      const id = this.dependencies.id();
      try {
        await assetLosses.insertCase({ id, employeeId, itemId: input.itemId, responsibilityPeriodId: item.responsibilityPeriodId, amount: normalizeMoney(input.amount ?? item.amount) });
      } catch (error) {
        throw normalizeConflict(error);
      }
      await assetLosses.appendEvent({ id: this.dependencies.id(), caseId: id, fromStatus: null, toStatus: "payment_pending", actorId: current.id, comment: null });
      return toDto(await requireCase(assetLosses, id));
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  async submitReceipt(caseId: string, receipt: NormalizedLossReceipt, actor: AssetLossActor) {
    assertUuid(caseId, "invalid_loss_case_id");
    return this.unitOfWork.transaction(async ({ assetLosses }) => {
      const current = await requireActor(assetLosses, actor, true);
      const loss = await assetLosses.findCaseForUpdate(caseId);
      if (!loss) throw new ApplicationError("not_found", "loss_case_not_found");
      if (current.role !== "admin" && loss.employeeId !== current.id) throw new ApplicationError("not_found", "loss_case_not_found");
      if (loss.status !== "payment_pending" && loss.status !== "rejected") throw new ApplicationError("conflict", "loss_receipt_not_allowed");
      const now = this.dependencies.now();
      const photoId = this.dependencies.id();
      await assetLosses.insertReceipt({ id: photoId, itemId: loss.itemId, uploadedBy: current.id, bytes: receipt.bytes, width: receipt.width, height: receipt.height, checksum: this.dependencies.checksum(receipt.bytes), now });
      if (loss.receiptPhotoId && !await assetLosses.supersedeReceipt(loss.receiptPhotoId, now)) throw stale();
      if (!await assetLosses.submitReceipt({ caseId, expectedStatus: loss.status, photoId, submittedBy: current.id, now })) throw stale();
      await assetLosses.appendEvent({ id: this.dependencies.id(), caseId, fromStatus: loss.status, toStatus: "accounting_review", actorId: current.id, comment: null });
      return toDto(await requireCase(assetLosses, caseId));
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  async getReceipt(caseId: string, actor: AssetLossActor): Promise<{ bytes: Uint8Array; mediaType: "image/jpeg" }> {
    assertUuid(caseId, "invalid_loss_case_id");
    return this.unitOfWork.transaction(async ({ assetLosses }) => {
      const current = await requireActor(assetLosses, actor, false);
      const receipt = await assetLosses.getReceipt(caseId, current.role === "admin" ? null : current.id);
      if (!receipt || receipt.mediaType !== "image/jpeg") throw new ApplicationError("not_found", "loss_receipt_not_found");
      return { bytes: receipt.bytes, mediaType: "image/jpeg" };
    }, { isolation: "repeatable-read", readOnly: true, maxAttempts: 1 });
  }

  async review(caseId: string, input: { decision: "approved" | "rejected"; comment?: string }, actor: AssetLossActor) {
    assertUuid(caseId, "invalid_loss_case_id");
    const comment = normalizeComment(input.comment);
    if (input.decision === "rejected" && !comment) throw new ApplicationError("validation", "loss_review_comment_required");
    return this.unitOfWork.transaction(async ({ assetLosses }) => {
      const current = await requireActor(assetLosses, actor, true);
      if (current.role !== "admin") throw forbidden();
      const loss = await assetLosses.findReviewSnapshotForUpdate(caseId);
      if (!loss) throw new ApplicationError("not_found", "loss_case_not_found");
      if (loss.status !== "accounting_review") throw new ApplicationError("conflict", "loss_review_not_allowed");
      if (input.decision === "approved" && (!loss.employeeActive || !loss.responsibilityPeriodId || loss.activeResponsibilityPeriodId !== loss.responsibilityPeriodId || loss.responsibleUserId !== loss.employeeId)) throw new ApplicationError("conflict", "loss_responsibility_changed");
      const now = this.dependencies.now();
      if (input.decision === "approved" && !await assetLosses.closeResponsibility({ periodId: loss.responsibilityPeriodId!, itemId: loss.itemId, employeeId: loss.employeeId, endedBy: current.id, now })) throw new ApplicationError("conflict", "loss_responsibility_changed");
      if (!await assetLosses.reviewCase({ caseId, decision: input.decision, reviewedBy: current.id, comment, now })) throw stale();
      await assetLosses.appendEvent({ id: this.dependencies.id(), caseId, fromStatus: loss.status, toStatus: input.decision === "approved" ? "closed" : "rejected", actorId: current.id, comment });
      return toDto(await requireCase(assetLosses, caseId));
    }, { isolation: "serializable", maxAttempts: 3 });
  }
}

async function requireActor(repository: AssetLossRepository, actor: AssetLossActor, lock: boolean) {
  const current = await repository.findActor(actor.userId, lock);
  if (!current || !current.active || current.role !== actor.role || current.version !== actor.sessionVersion) throw forbidden();
  return current;
}

async function requireCase(repository: AssetLossRepository, id: string) {
  const result = await repository.findCase(id);
  if (!result) throw new ApplicationError("not_found", "loss_case_not_found");
  return result;
}

function toDto(row: AssetLossRecord): AssetLossCaseDto {
  return { id: row.id, employeeId: row.employeeId, itemId: row.itemId, itemName: row.itemName, inventoryNumber: row.inventoryNumber, status: row.status, amount: normalizeMoney(row.amount), currency: row.currency, createdAt: row.createdAt.toISOString(), submittedAt: row.submittedAt?.toISOString() ?? null, reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewResult: row.reviewResult, reviewComment: row.reviewComment, closedAt: row.closedAt?.toISOString() ?? null };
}

export function normalizeMoney(value: string): string {
  if (!/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(value)) throw new ApplicationError("validation", "invalid_loss_amount");
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${`${fraction}00`.slice(0, 2)}`;
}

function normalizeComment(value: string | undefined): string | null {
  const comment = value?.trim() ?? "";
  if (comment.length > 1000) throw new ApplicationError("validation", "loss_comment_too_long");
  return comment || null;
}

function encodeCursor(createdAt: Date, id: string) { return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString("base64url"); }
function decodeCursor(cursor: string) {
  try {
    if (cursor.length > 256) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") throw new Error();
    const createdAt = new Date(value[0]); assertUuid(value[1], "invalid_loss_cursor");
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value[0]) throw new Error();
    return { createdAt, id: value[1] };
  } catch { throw new ApplicationError("validation", "invalid_loss_cursor"); }
}

function assertUuid(value: string, code: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApplicationError("validation", code); }
function forbidden() { return new ApplicationError("forbidden", "forbidden"); }
function stale() { return new ApplicationError("conflict", "loss_case_stale"); }
function normalizeConflict(error: unknown): unknown { return error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505" ? new ApplicationError("conflict", "loss_case_already_open", { cause: error }) : error; }
