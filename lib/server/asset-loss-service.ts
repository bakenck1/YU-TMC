import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import type { AssetLossCaseDto, AssetLossStatus } from "@/lib/contracts/asset-loss";
import type { UserRole } from "@/lib/contracts/users";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";

const TABLES = {
  users: '"yu_inventory"."users"',
  items: '"yu_inventory"."items"',
  periods: '"yu_inventory"."responsibility_periods"',
  losses: '"yu_inventory"."asset_loss_cases"',
  events: '"yu_inventory"."asset_loss_case_events"',
  photos: '"yu_inventory"."photos"',
} as const;

interface Actor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

interface LossRow extends QueryResultRow {
  id: string;
  employee_id: string;
  item_id: string;
  item_name: string;
  inventory_number: string;
  status: AssetLossStatus;
  amount: string;
  currency: "KZT";
  created_at: Date;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  review_result: "approved" | "rejected" | null;
  review_comment: string | null;
  closed_at: Date | null;
}

export interface NormalizedLossReceipt {
  bytes: Uint8Array;
  width: number;
  height: number;
  mediaType: "image/jpeg";
}

export class AssetLossService {
  async list(actor: Actor): Promise<AssetLossCaseDto[]> {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const current = await requireActor(client, actor);
      const result = await client.query<LossRow>(
        `${lossSelect()}
          where ($1::boolean or loss.employee_id = $2)
          order by loss.created_at desc
          limit 200`,
        [current.role === "admin", current.id],
      );
      await client.query("COMMIT");
      return result.rows.map(toDto);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async create(input: { itemId: string; employeeId?: string; amount?: string }, actor: Actor) {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const current = await requireActor(client, actor);
      const employeeId = current.role === "admin" && input.employeeId
        ? input.employeeId
        : current.id;
      if (current.role !== "admin" && input.employeeId && input.employeeId !== current.id) {
        throw forbidden();
      }
      const item = await client.query<
        { id: string; amount: string } & QueryResultRow
      >(
        `select i.id, (i.unit_price * i.quantity)::numeric(14,2)::text as amount
           from ${TABLES.items} i
           join ${TABLES.periods} rp on rp.item_id = i.id
          where i.id = $1 and rp.responsible_user_id = $2
            and rp.ended_at is null and i.status <> 'decommissioned'
          for update of i, rp`,
        [input.itemId, employeeId],
      );
      if (!item.rows[0]) throw new ApplicationError("not_found", "loss_item_not_found");
      const amount = normalizeMoney(input.amount ?? item.rows[0].amount);
      const id = randomUUID();
      await client.query(
        `insert into ${TABLES.losses}
          (id, employee_id, item_id, status, amount, currency)
         values ($1, $2, $3, 'payment_pending', $4, 'KZT')`,
        [id, employeeId, input.itemId, amount],
      );
      await appendEvent(client, id, null, "payment_pending", current.id, null);
      const result = await findLoss(client, id);
      await client.query("COMMIT");
      return toDto(result);
    } catch (error) {
      await rollbackQuietly(client);
      throw normalizeConflict(error);
    } finally {
      client.release();
    }
  }

  async submitReceipt(lossCaseId: string, receipt: NormalizedLossReceipt, actor: Actor) {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN");
      const current = await requireActor(client, actor);
      const loss = await lockLoss(client, lossCaseId);
      if (current.role !== "admin" && loss.employee_id !== current.id) throw forbidden();
      if (loss.status !== "payment_pending" && loss.status !== "rejected") {
        throw new ApplicationError("conflict", "loss_receipt_not_allowed");
      }
      const photoId = randomUUID();
      const now = new Date();
      const objectKey = `database://photos/${photoId}`;
      const checksum = createHash("sha256").update(receipt.bytes).digest("hex");
      await client.query(
        `insert into ${TABLES.photos}
          (id, purpose, status, uploaded_by, original_object_key, preview_object_key,
           trusted_mime_type, byte_size, width, height, checksum_sha256,
           binary_data, reserved_at, expires_at, attached_at, item_id)
         values ($1, 'asset_loss_receipt', 'attached', $2, $3, $4, $5, $6, $7, $8,
                 $9, $10, $11, $12, $11, $13)`,
        [
          photoId,
          current.id,
          objectKey,
          `${objectKey}/preview.jpg`,
          receipt.mediaType,
          receipt.bytes.byteLength,
          receipt.width,
          receipt.height,
          checksum,
          Buffer.from(receipt.bytes),
          now,
          new Date(now.getTime() + 60 * 60 * 1000),
          loss.item_id,
        ],
      );
      await client.query(
        `update ${TABLES.losses}
            set status = 'accounting_review', receipt_photo_id = $2,
                submitted_by = $3, submitted_at = $4,
                reviewed_by = null, reviewed_at = null, review_result = null,
                review_comment = null, closed_at = null
          where id = $1`,
        [lossCaseId, photoId, current.id, now],
      );
      await appendEvent(client, lossCaseId, loss.status, "accounting_review", current.id, null);
      const result = await findLoss(client, lossCaseId);
      await client.query("COMMIT");
      return toDto(result);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getReceipt(
    lossCaseId: string,
    actor: Actor,
  ): Promise<{ bytes: Uint8Array; mediaType: "image/jpeg" }> {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const current = await requireActor(client, actor);
      const result = await client.query<
        { binary_data: Buffer; trusted_mime_type: string } & QueryResultRow
      >(
        `select photo.binary_data, photo.trusted_mime_type
           from ${TABLES.losses} loss
           join ${TABLES.photos} photo on photo.id = loss.receipt_photo_id
          where loss.id = $1
            and ($2::boolean or loss.employee_id = $3)
            and photo.purpose = 'asset_loss_receipt'
            and photo.status = 'attached'
            and photo.binary_data is not null`,
        [lossCaseId, current.role === "admin", current.id],
      );
      const receipt = result.rows[0];
      if (!receipt || receipt.trusted_mime_type !== "image/jpeg") {
        throw new ApplicationError("not_found", "loss_receipt_not_found");
      }
      await client.query("COMMIT");
      return {
        bytes: new Uint8Array(receipt.binary_data),
        mediaType: "image/jpeg",
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async review(
    lossCaseId: string,
    input: { decision: "approved" | "rejected"; comment?: string },
    actor: Actor,
  ) {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN");
      const current = await requireActor(client, actor);
      if (current.role !== "admin") throw forbidden();
      const loss = await lockLoss(client, lossCaseId);
      if (loss.status !== "accounting_review") {
        throw new ApplicationError("conflict", "loss_review_not_allowed");
      }
      const comment = normalizeComment(input.comment);
      if (input.decision === "rejected" && !comment) {
        throw new ApplicationError("validation", "loss_review_comment_required");
      }
      const now = new Date();
      const nextStatus = input.decision === "approved" ? "closed" : "rejected";
      await client.query(
        `update ${TABLES.losses}
            set status = $2::varchar, reviewed_by = $3, reviewed_at = $4::timestamptz,
                review_result = $5::varchar, review_comment = $6,
                closed_at = case when $5::varchar = 'approved' then $4::timestamptz else null end
          where id = $1`,
        [lossCaseId, nextStatus, current.id, now, input.decision, comment],
      );
      if (input.decision === "approved") {
        await client.query(
          `update ${TABLES.periods}
              set ended_at = $2, ended_by = $3,
                  end_reason = 'Loss payment approved by accounting'
            where item_id = $1 and responsible_user_id = $4 and ended_at is null`,
          [loss.item_id, now, current.id, loss.employee_id],
        );
      }
      await appendEvent(client, lossCaseId, loss.status, nextStatus, current.id, comment);
      const result = await findLoss(client, lossCaseId);
      await client.query("COMMIT");
      return toDto(result);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function lossSelect() {
  return `select loss.id, loss.employee_id, loss.item_id,
                 item.name as item_name, item.inventory_number,
                 loss.status, loss.amount::text, loss.currency,
                 loss.created_at, loss.submitted_at, loss.reviewed_at,
                 loss.review_result, loss.review_comment, loss.closed_at
            from ${TABLES.losses} loss
            join ${TABLES.items} item on item.id = loss.item_id`;
}

async function requireActor(client: PoolClient, actor: Actor) {
  const result = await client.query<
    { id: string; role: UserRole; version: number } & QueryResultRow
  >(
    `select id, role, version from ${TABLES.users}
      where id = $1 and is_active = true and deleted_at is null`,
    [actor.userId],
  );
  const current = result.rows[0];
  if (!current || current.role !== actor.role || current.version !== actor.sessionVersion) {
    throw forbidden();
  }
  return current;
}

async function lockLoss(client: PoolClient, id: string) {
  const result = await client.query<
    { id: string; employee_id: string; item_id: string; status: AssetLossStatus } & QueryResultRow
  >(`select id, employee_id, item_id, status from ${TABLES.losses} where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new ApplicationError("not_found", "loss_case_not_found");
  return result.rows[0];
}

async function findLoss(client: PoolClient, id: string): Promise<LossRow> {
  const result = await client.query<LossRow>(`${lossSelect()} where loss.id = $1`, [id]);
  if (!result.rows[0]) throw new ApplicationError("not_found", "loss_case_not_found");
  return result.rows[0];
}

async function appendEvent(
  client: PoolClient,
  lossCaseId: string,
  fromStatus: AssetLossStatus | null,
  toStatus: AssetLossStatus,
  actorId: string,
  comment: string | null,
) {
  await client.query(
    `insert into ${TABLES.events}
      (id, loss_case_id, from_status, to_status, actor_id, comment)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), lossCaseId, fromStatus, toStatus, actorId, comment],
  );
}

function toDto(row: LossRow): AssetLossCaseDto {
  return {
    id: row.id,
    employeeId: row.employee_id,
    itemId: row.item_id,
    itemName: row.item_name,
    inventoryNumber: row.inventory_number,
    status: row.status,
    amount: normalizeMoney(row.amount),
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewResult: row.review_result,
    reviewComment: row.review_comment,
    closedAt: row.closed_at?.toISOString() ?? null,
  };
}

function normalizeMoney(value: string): string {
  if (!/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(value)) {
    throw new ApplicationError("validation", "invalid_loss_amount");
  }
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${`${fraction}00`.slice(0, 2)}`;
}

function normalizeComment(value: string | undefined): string | null {
  const comment = value?.trim() ?? "";
  if (comment.length > 1000) throw new ApplicationError("validation", "loss_comment_too_long");
  return comment || null;
}

function normalizeConflict(error: unknown): unknown {
  if (
    error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505"
  ) {
    return new ApplicationError("conflict", "loss_case_already_open", { cause: error });
  }
  return error;
}

function forbidden() {
  return new ApplicationError("forbidden", "forbidden");
}

async function rollbackQuietly(client: PoolClient) {
  try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
}
