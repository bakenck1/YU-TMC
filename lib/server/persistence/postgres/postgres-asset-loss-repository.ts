import "server-only";

import type { QueryResultRow } from "pg";

import type {
  AssetLossActorRecord,
  AssetLossRecord,
  AssetLossRepositories,
  AssetLossRepository,
  AssetLossReviewSnapshot,
} from "@/lib/application/ports/asset-loss-repository";
import type { AssetLossStatus } from "@/lib/contracts/asset-loss";
import type { UserRole } from "@/lib/contracts/users";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const TABLES = {
  users: '"yu_inventory"."users"', items: '"yu_inventory"."items"', periods: '"yu_inventory"."responsibility_periods"',
  losses: '"yu_inventory"."asset_loss_cases"', events: '"yu_inventory"."asset_loss_case_events"', photos: '"yu_inventory"."photos"',
} as const;

interface LossRow extends QueryResultRow {
  id: string; employee_id: string; item_id: string; responsibility_period_id: string | null; item_name: string; inventory_number: string;
  status: AssetLossStatus; amount: string; currency: "KZT"; receipt_photo_id: string | null;
  created_at: Date; submitted_at: Date | null; reviewed_at: Date | null;
  review_result: "approved" | "rejected" | null; review_comment: string | null; closed_at: Date | null;
}

export function createPostgresAssetLossRepositories(source: PostgresRepositorySource): AssetLossRepositories {
  return { assetLosses: new PostgresAssetLossRepository(source) };
}

class PostgresAssetLossRepository implements AssetLossRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async findActor(userId: string, lock: boolean): Promise<AssetLossActorRecord | null> {
    const result = await this.source.query<{ id: string; role: UserRole; is_active: boolean; deleted_at: Date | null; version: number | string } & QueryResultRow>(
      `select id, role, is_active, deleted_at, version from ${TABLES.users} where id = $1${lock ? " for update" : ""}`, [userId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, role: row.role, active: row.is_active && !row.deleted_at, version: Number(row.version) } : null;
  }

  async list(input: { employeeId: string | null; before: { createdAt: Date; id: string } | null; limit: number }) {
    const result = await this.source.query<LossRow>(
      `${lossSelect()} where ($1::uuid is null or loss.employee_id = $1)
        and ($2::timestamptz is null or (loss.created_at, loss.id) < ($2, $3::uuid))
        order by loss.created_at desc, loss.id desc limit $4`,
      [input.employeeId, input.before?.createdAt ?? null, input.before?.id ?? null, input.limit],
    );
    return result.rows.map(mapLoss);
  }

  async findAssignableItemForUpdate(itemId: string, employeeId: string) {
    const result = await this.source.query<{ amount: string; responsibility_period_id: string } & QueryResultRow>(
      `select (i.unit_price * i.quantity)::numeric(14,2)::text as amount, rp.id as responsibility_period_id
         from ${TABLES.items} i join ${TABLES.periods} rp on rp.item_id = i.id
        where i.id = $1 and rp.responsible_user_id = $2 and rp.ended_at is null
          and i.status not in ('decommissioned', 'decommissioned_in_use')
        for update of i, rp`, [itemId, employeeId],
    );
    const row = result.rows[0];
    return row ? { amount: row.amount, responsibilityPeriodId: row.responsibility_period_id } : null;
  }

  async insertCase(input: { id: string; employeeId: string; itemId: string; responsibilityPeriodId: string; amount: string }) {
    await this.source.query(`insert into ${TABLES.losses} (id, employee_id, item_id, responsibility_period_id, status, amount, currency) values ($1, $2, $3, $4, 'payment_pending', $5, 'KZT')`, [input.id, input.employeeId, input.itemId, input.responsibilityPeriodId, input.amount]);
  }

  async findCase(id: string) { const result = await this.source.query<LossRow>(`${lossSelect()} where loss.id = $1`, [id]); return result.rows[0] ? mapLoss(result.rows[0]) : null; }
  async findCaseForUpdate(id: string) {
    const result = await this.source.query<LossRow>(`${lossSelect()} where loss.id = $1 for update of loss`, [id]);
    return result.rows[0] ? mapLoss(result.rows[0]) : null;
  }

  async insertReceipt(input: { id: string; itemId: string; uploadedBy: string; bytes: Uint8Array; width: number; height: number; checksum: string; now: Date }) {
    const objectKey = `database://photos/${input.id}`;
    await this.source.query(
      `insert into ${TABLES.photos}
        (id, purpose, status, uploaded_by, original_object_key, preview_object_key, trusted_mime_type,
         byte_size, width, height, checksum_sha256, binary_data, reserved_at, expires_at, attached_at, item_id)
       values ($1, 'asset_loss_receipt', 'attached', $2, $3, $4, 'image/jpeg', $5, $6, $7, $8, $9, $10, $11, $10, $12)`,
      [input.id, input.uploadedBy, objectKey, `${objectKey}/preview.jpg`, input.bytes.byteLength, input.width, input.height, input.checksum, Buffer.from(input.bytes), input.now, new Date(input.now.getTime() + 3_600_000), input.itemId],
    );
  }

  async supersedeReceipt(photoId: string, now: Date) {
    const result = await this.source.query(`update ${TABLES.photos} set status = 'superseded', superseded_at = $2, version = version + 1 where id = $1 and purpose = 'asset_loss_receipt' and status = 'attached'`, [photoId, now]);
    return result.rowCount === 1;
  }

  async submitReceipt(input: { caseId: string; expectedStatus: "payment_pending" | "rejected"; photoId: string; submittedBy: string; now: Date }) {
    const result = await this.source.query(
      `update ${TABLES.losses} set status = 'accounting_review', receipt_photo_id = $3, submitted_by = $4, submitted_at = $5,
        reviewed_by = null, reviewed_at = null, review_result = null, review_comment = null, closed_at = null
       where id = $1 and status = $2`, [input.caseId, input.expectedStatus, input.photoId, input.submittedBy, input.now],
    );
    return result.rowCount === 1;
  }

  async getReceipt(caseId: string, employeeId: string | null) {
    const result = await this.source.query<{ binary_data: Buffer; trusted_mime_type: string } & QueryResultRow>(
      `select photo.binary_data, photo.trusted_mime_type from ${TABLES.losses} loss
       join ${TABLES.photos} photo on photo.id = loss.receipt_photo_id
       where loss.id = $1 and ($2::uuid is null or loss.employee_id = $2)
         and photo.purpose = 'asset_loss_receipt' and photo.status = 'attached' and photo.binary_data is not null`, [caseId, employeeId],
    );
    const row = result.rows[0]; return row ? { bytes: new Uint8Array(row.binary_data), mediaType: row.trusted_mime_type } : null;
  }

  async findReviewSnapshotForUpdate(caseId: string): Promise<AssetLossReviewSnapshot | null> {
    const result = await this.source.query<LossRow & { employee_active: boolean; active_responsibility_period_id: string | null; responsible_user_id: string | null }>(
      `select loss.id, loss.employee_id, loss.item_id, loss.responsibility_period_id, item.name as item_name, item.inventory_number,
        loss.status, loss.amount::text, loss.currency, loss.receipt_photo_id, loss.created_at, loss.submitted_at,
        loss.reviewed_at, loss.review_result, loss.review_comment, loss.closed_at,
        employee.is_active and employee.deleted_at is null as employee_active,
        rp.id as active_responsibility_period_id, rp.responsible_user_id
       from ${TABLES.losses} loss join ${TABLES.items} item on item.id = loss.item_id
       join ${TABLES.users} employee on employee.id = loss.employee_id
       left join lateral (
         select id, responsible_user_id from ${TABLES.periods}
          where item_id = loss.item_id and ended_at is null
          order by id limit 1 for update
       ) rp on true
       where loss.id = $1 for update of loss, item, employee`, [caseId],
    );
    const row = result.rows[0];
    return row ? { ...mapLoss(row), employeeActive: row.employee_active, activeResponsibilityPeriodId: row.active_responsibility_period_id, responsibleUserId: row.responsible_user_id } : null;
  }

  async reviewCase(input: { caseId: string; decision: "approved" | "rejected"; reviewedBy: string; comment: string | null; now: Date }) {
    const next = input.decision === "approved" ? "closed" : "rejected";
    const result = await this.source.query(
      `update ${TABLES.losses} set status = $2::varchar, reviewed_by = $3, reviewed_at = $4::timestamptz, review_result = $5::varchar,
        review_comment = $6, closed_at = case when $5::varchar = 'approved' then $4::timestamptz else null end
       where id = $1 and status = 'accounting_review'`, [input.caseId, next, input.reviewedBy, input.now, input.decision, input.comment],
    );
    return result.rowCount === 1;
  }

  async closeResponsibility(input: { periodId: string; itemId: string; employeeId: string; endedBy: string; now: Date }) {
    const result = await this.source.query(
      `update ${TABLES.periods} set ended_at = $4, ended_by = $5, end_reason = 'Loss payment approved by accounting'
       where id = $1 and item_id = $2 and responsible_user_id = $3 and ended_at is null`,
      [input.periodId, input.itemId, input.employeeId, input.now, input.endedBy],
    );
    return result.rowCount === 1;
  }

  async appendEvent(input: { id: string; caseId: string; fromStatus: AssetLossStatus | null; toStatus: AssetLossStatus; actorId: string; comment: string | null }) {
    await this.source.query(`insert into ${TABLES.events} (id, loss_case_id, from_status, to_status, actor_id, comment) values ($1, $2, $3, $4, $5, $6)`, [input.id, input.caseId, input.fromStatus, input.toStatus, input.actorId, input.comment]);
  }
}

function lossSelect() {
  return `select loss.id, loss.employee_id, loss.item_id, loss.responsibility_period_id, item.name as item_name, item.inventory_number,
    loss.status, loss.amount::text, loss.currency, loss.receipt_photo_id, loss.created_at, loss.submitted_at,
    loss.reviewed_at, loss.review_result, loss.review_comment, loss.closed_at from ${TABLES.losses} loss join ${TABLES.items} item on item.id = loss.item_id`;
}

function mapLoss(row: LossRow): AssetLossRecord {
  return { id: row.id, employeeId: row.employee_id, itemId: row.item_id, responsibilityPeriodId: row.responsibility_period_id, itemName: row.item_name, inventoryNumber: row.inventory_number, status: row.status, amount: row.amount, currency: row.currency, receiptPhotoId: row.receipt_photo_id, createdAt: new Date(row.created_at), submittedAt: row.submitted_at ? new Date(row.submitted_at) : null, reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null, reviewResult: row.review_result, reviewComment: row.review_comment, closedAt: row.closed_at ? new Date(row.closed_at) : null };
}
