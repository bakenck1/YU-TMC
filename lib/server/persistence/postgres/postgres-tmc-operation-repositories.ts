import "server-only";

import type { QueryResultRow } from "pg";

import type {
  CloseTmcTransferRequestRecord,
  CancelTmcTransferRequestRecord,
  AppendTmcAuditRecord,
  CreateTmcNotificationRecord,
  DecideTmcTransferRequestItemRecord,
  InsertedTmcTransferRequestItemRecord,
  InsertTmcTransferRequestItemRecord,
  InsertTmcTransferRequestRecord,
  TmcOperationRepositories,
  TmcOperationRepositoryConflictProblem,
  TmcOperationUserRecord,
  TmcTransferCandidateRecord,
  TmcTransferRequestItemRecord,
  TmcTransferRequestRecord,
  TmcTransferRequestRepository,
  TmcStageFourRepository,
  TmcTransferHistoryQuery,
  TmcNotificationRecord,
  TmcLocationHistoryRecord,
  TmcTransferUserRecord,
} from "@/lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "@/lib/application/ports/tmc-operation-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { PostgresIdempotencyRequestRepository } from "@/lib/server/persistence/postgres/postgres-inventory-concurrency-repositories";

const ITEMS = '"yu_inventory"."items"';
const ROOMS = '"yu_inventory"."rooms"';
const BUILDINGS = '"yu_inventory"."buildings"';
const USERS = '"yu_inventory"."users"';
const PHOTOS = '"yu_inventory"."photos"';
const RESPONSIBILITY_PERIODS = '"yu_inventory"."responsibility_periods"';
const LEGACY_TRANSFERS = '"yu_inventory"."transfers"';
const REQUESTS = '"yu_inventory"."tmc_transfer_requests"';
const REQUEST_ITEMS = '"yu_inventory"."tmc_transfer_request_items"';
const AUDIT_RECORDS = '"yu_inventory"."audit_records"';
const NOTIFICATION_MAILBOXES = '"yu_inventory"."notification_mailboxes"';
const NOTIFICATION_EVENTS = '"yu_inventory"."notification_events"';
const TMC_NOTIFICATIONS = '"yu_inventory"."tmc_operation_notifications"';
const NOTIFICATION_DELIVERIES = '"yu_inventory"."notification_deliveries"';
const NOTIFICATION_RECEIPTS = '"yu_inventory"."notification_receipts"';
const WEB_PUSH_OUTBOX = '"yu_inventory"."tmc_web_push_outbox"';

interface CandidateRow extends QueryResultRow {
  item_id: string;
  item_version: number | string;
  item_status: TmcTransferCandidateRecord["itemStatus"];
  archived_at: Date | null;
  item_name: string;
  inventory_number: string;
  quantity: number | string;
  unit_price: number | string;
  photo_id: string | null;
  building_id: string;
  building_name: string;
  room_id: string;
  room_designation: string;
  responsibility_period_id: string | null;
  responsible_user_id: string | null;
  responsible_full_name: string | null;
  responsible_email: string | null;
  responsible_role: TmcOperationUserRecord["role"] | null;
  responsible_is_active: boolean | null;
  responsible_deleted_at: Date | null;
  has_active_transfer: boolean;
}

interface TransferUserRow extends QueryResultRow {
  id: string;
  full_name: string;
  email: string;
  role: TmcOperationUserRecord["role"];
  is_active: boolean;
  deleted_at: Date | null;
}

interface RequestRow extends QueryResultRow {
  request_id: string;
  initiator_id: string;
  initiator_full_name: string;
  initiator_email: string;
  initiator_role: TmcOperationUserRecord["role"];
  recipient_id: string;
  recipient_full_name: string;
  recipient_email: string;
  recipient_role: TmcOperationUserRecord["role"];
  request_status: TmcTransferRequestRecord["status"];
  comment: string | null;
  request_created_at: Date;
  expires_at: Date;
  closed_at: Date | null;
  closed_by: string | null;
  closed_by_full_name: string | null;
  closed_by_email: string | null;
  closed_by_role: TmcOperationUserRecord["role"] | null;
  is_administrative_decision: boolean;
  administrative_reason: string | null;
  request_version: number | string;
}

interface RequestItemRow extends QueryResultRow {
  request_item_id: string | null;
  request_id: string;
  item_id: string;
  responsibility_period_id_at_request: string | null;
  current_responsible_id_at_request: string | null;
  current_responsible_full_name: string | null;
  current_responsible_email: string | null;
  current_responsible_role: TmcOperationUserRecord["role"] | null;
  result: TmcTransferRequestItemRecord["result"];
  invalid_reason: string | null;
  request_item_created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  decided_by_full_name: string | null;
  decided_by_email: string | null;
  decided_by_role: TmcOperationUserRecord["role"] | null;
  request_item_version: number | string;
  item_name: string;
  inventory_number: string;
  quantity: number | string;
  unit_price: number | string;
  item_version: number | string;
  photo_id: string | null;
  building_id: string;
  building_name: string;
  room_id: string;
  room_designation: string;
}

interface InsertedRequestItemRow extends QueryResultRow {
  id: string;
  request_id: string;
  item_id: string;
  responsibility_period_id_at_request: string | null;
  current_responsible_id_at_request: string | null;
  result: InsertedTmcTransferRequestItemRecord["result"];
  invalid_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  version: number | string;
}

interface AtomicInsertRequestItemRow extends QueryResultRow {
  id: string | null;
  request_id: string | null;
  item_id: string | null;
  responsibility_period_id_at_request: string | null;
  current_responsible_id_at_request: string | null;
  result: InsertedTmcTransferRequestItemRecord["result"] | null;
  invalid_reason: string | null;
  created_at: Date | null;
  decided_at: Date | null;
  decided_by: string | null;
  version: number | string | null;
  item_exists: boolean;
  item_status: TmcTransferCandidateRecord["itemStatus"] | null;
  archived_at: Date | null;
  item_version: number | string | null;
  expected_period_open: boolean;
}

export function createPostgresTmcOperationRepositories(
  source: PostgresRepositorySource,
): TmcOperationRepositories {
  return {
    idempotency: new PostgresIdempotencyRequestRepository(source),
    transferRequests: new PostgresTmcTransferRequestRepository(source),
    stageFour: new PostgresTmcStageFourRepository(source),
  };
}

class PostgresTmcTransferRequestRepository
  implements TmcTransferRequestRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async findUserById(id: string): Promise<TmcTransferUserRecord | null> {
    const result = await this.source.query<TransferUserRow>(
      `select id, full_name, email, role, is_active, deleted_at
         from ${USERS}
        where id = $1
        for no key update`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          fullName: row.full_name,
          email: row.email,
          role: row.role,
          active: row.is_active,
          deletedAt: optionalDate(row.deleted_at),
        }
      : null;
  }

  async findCandidates(
    itemIds: readonly string[],
  ): Promise<TmcTransferCandidateRecord[]> {
    if (itemIds.length === 0) return [];
    const result = await this.source.query<CandidateRow>(
      candidateSelect(),
      [itemIds],
    );
    return result.rows.map(mapCandidate);
  }

  async findById(id: string): Promise<TmcTransferRequestRecord | null> {
    const result = await this.source.query<RequestRow & RequestItemRow>(
      requestAggregateSelect(),
      [id],
    );
    const firstRow = result.rows[0];
    if (!firstRow) return null;
    if (result.rows.some((row) => row.request_item_id === null)) {
      throw new Error("tmc_transfer_request_without_items");
    }
    return mapRequest(firstRow, result.rows);
  }

  async findByIdForUpdate(id: string): Promise<TmcTransferRequestRecord | null> {
    const locked = await this.source.query<{ id: string } & QueryResultRow>(
      `select id from ${REQUESTS} where id = $1 for update`,
      [id],
    );
    return locked.rows[0] ? this.findById(id) : null;
  }

  async findItemPhoto(requestId: string, itemId: string) {
    const result = await this.source.query<{
      binary_data: Buffer | null;
      trusted_mime_type: string | null;
    } & QueryResultRow>(
      `select photo.binary_data, photo.trusted_mime_type
         from ${REQUEST_ITEMS} request_item
         inner join ${PHOTOS} photo
           on photo.item_id = request_item.item_id
          and photo.purpose = 'item'
          and photo.status = 'attached'
        where request_item.request_id = $1
          and request_item.item_id = $2
        order by photo.attached_at desc nulls last, photo.id
        limit 1`,
      [requestId, itemId],
    );
    const row = result.rows[0];
    return row?.binary_data && row.trusted_mime_type === "image/jpeg"
      ? { bytes: new Uint8Array(row.binary_data), mimeType: "image/jpeg" as const }
      : null;
  }

  async decideItem(
    input: DecideTmcTransferRequestItemRecord,
  ): Promise<"accepted" | "rejected" | "invalidated"> {
    const requestItem = await this.source.query<{
      version: number;
      result: string;
    } & QueryResultRow>(
      `select version, result
         from ${REQUEST_ITEMS}
        where id = $1 and request_id = $2 and item_id = $3
        for update`,
      [input.requestItemId, input.requestId, input.itemId],
    );
    const row = requestItem.rows[0];
    if (!row || row.result !== "pending" || Number(row.version) !== input.expectedVersion) {
      throw new TmcOperationRepositoryConflictError("version_conflict", {
        reason: "request_item_version_conflict",
      });
    }
    const itemResult = await this.source.query<{
      status: string;
      archived_at: Date | null;
    } & QueryResultRow>(
      `select status, archived_at from ${ITEMS} where id = $1 for update`,
      [input.itemId],
    );
    const periodResult = await this.source.query<{
      id: string;
      item_id: string;
      responsible_user_id: string;
      ended_at: Date | null;
    } & QueryResultRow>(
      `select id, item_id, responsible_user_id, ended_at
         from ${RESPONSIBILITY_PERIODS}
        where item_id = $1 and ended_at is null
        for update`,
      [input.itemId],
    );
    const item = itemResult.rows[0];
    const period = periodResult.rows[0];
    const itemActive = item?.status === "active" && item.archived_at === null;
    const responsibilityCurrent = input.responsibilityPeriodIdAtRequest === null
      && input.currentResponsibleIdAtRequest === null
        ? period === undefined
        : period?.id === input.responsibilityPeriodIdAtRequest &&
          period.item_id === input.itemId &&
          period.responsible_user_id === input.currentResponsibleIdAtRequest &&
          period.ended_at === null;
    const result = !itemActive || !responsibilityCurrent
      ? "invalidated" as const
      : input.decision === "accept"
        ? "accepted" as const
        : "rejected" as const;
    const invalidReason = !itemActive
      ? "item_inactive"
      : !responsibilityCurrent
        ? "responsibility_changed"
        : null;
    if (result === "accepted") {
      if (input.responsibilityPeriodIdAtRequest) {
        const closed = await this.source.query(
          `update ${RESPONSIBILITY_PERIODS}
              set ended_at = $2, ended_by = $3,
                  end_reason = 'tmc_transfer_accepted'
            where id = $1 and ended_at is null`,
          [input.responsibilityPeriodIdAtRequest, input.decidedAt, input.decidedBy],
        );
        if ((closed.rowCount ?? 0) !== 1) {
          throw new TmcOperationRepositoryConflictError("responsibility_changed", {
            reason: "responsibility_period_close_conflict",
          });
        }
      }
      await this.source.query(
        `insert into ${RESPONSIBILITY_PERIODS}
           (id, item_id, responsible_user_id, source, started_at, started_by)
         values ($1, $2, $3, $6, $4, $5)`,
        [
          input.newResponsibilityPeriodId,
          input.itemId,
          input.recipientId,
          input.decidedAt,
          input.decidedBy,
          input.responsibilitySource ?? "transfer",
        ],
      );
    }
    const updated = await this.source.query(
      `update ${REQUEST_ITEMS}
          set result = $2,
              invalid_reason = $3,
              decided_at = $4,
              decided_by = $5,
              version = version + 1
        where id = $1 and version = $6 and result = 'pending'`,
      [
        input.requestItemId,
        result,
        invalidReason,
        input.decidedAt,
        input.decidedBy,
        input.expectedVersion,
      ],
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new TmcOperationRepositoryConflictError("version_conflict", {
        reason: "request_item_update_conflict",
      });
    }
    return result;
  }

  async closeRequest(input: CloseTmcTransferRequestRecord): Promise<boolean> {
    const result = await this.source.query(
      `update ${REQUESTS} request
          set status = $3,
              closed_at = $4,
              closed_by = $5,
              is_administrative_decision = $6,
              administrative_reason = $7,
              version = version + 1
        where request.id = $1
          and request.version = $2
          and request.status = 'pending'
          and not exists (
            select 1 from ${REQUEST_ITEMS} item
             where item.request_id = request.id and item.result = 'pending'
          )`,
      [
        input.requestId,
        input.expectedVersion,
        input.status,
        input.closedAt,
        input.closedBy,
        input.isAdministrativeDecision,
        input.administrativeReason,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async cancelRequest(input: CancelTmcTransferRequestRecord): Promise<boolean> {
    await this.source.query(
      `update ${REQUEST_ITEMS}
          set result = 'cancelled', invalid_reason = null,
              decided_at = $2, decided_by = $3, version = version + 1
        where request_id = $1 and result = 'pending'`,
      [input.requestId, input.cancelledAt, input.cancelledBy],
    );
    const result = await this.source.query(
      `update ${REQUESTS}
          set status = 'cancelled', closed_at = $3, closed_by = $4,
              is_administrative_decision = $5,
              administrative_reason = $6, version = version + 1
        where id = $1 and version = $2 and status = 'pending'`,
      [
        input.requestId,
        input.expectedVersion,
        input.cancelledAt,
        input.cancelledBy,
        input.isAdministrativeDecision,
        input.administrativeReason,
      ],
    );
    const cancelled = (result.rowCount ?? 0) === 1;
    if (cancelled) {
      await this.source.query(
        `update ${WEB_PUSH_OUTBOX} outbox
            set processed_at = $2, last_error_code = 'event_no_longer_deliverable',
                locked_by = null, locked_until = null
           from ${NOTIFICATION_EVENTS} event
           join ${TMC_NOTIFICATIONS} notification on notification.notification_event_id = event.id
          where outbox.notification_event_id = event.id
            and notification.request_id = $1
            and event.type = 'tmc_transfer.overdue'
            and outbox.processed_at is null`,
        [input.requestId, input.cancelledAt],
      );
    }
    return cancelled;
  }

  async insertRequest(input: InsertTmcTransferRequestRecord): Promise<void> {
    await this.source.query(
      `insert into ${REQUESTS}
         (id, initiator_id, recipient_id, comment, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.initiatorId,
        input.recipientId,
        input.comment,
        input.createdAt,
        input.expiresAt,
      ],
    );
  }

  async insertRequestItem(
    input: InsertTmcTransferRequestItemRecord,
  ): Promise<InsertedTmcTransferRequestItemRecord> {
    try {
      const result = await this.source.query<AtomicInsertRequestItemRow>(
        `with locked_item as materialized (
           select item.id, item.version, item.status, item.archived_at
             from ${ITEMS} item
            where item.id = $3
            for update
         ), locked_period as materialized (
           select period.id, period.item_id, period.responsible_user_id,
                  period.ended_at
             from ${RESPONSIBILITY_PERIODS} period
            where period.item_id = $3
              and period.ended_at is null
            for update
         ), validation as (
           select item.id is not null as item_exists,
                  item.status as item_status, item.archived_at,
                  item.version as item_version,
                  case
                    when $5::uuid is null and $6::uuid is null
                      then period.id is null
                    else coalesce(
                      period.id = $5
                      and period.item_id = $3
                      and period.responsible_user_id = $6
                      and period.ended_at is null,
                      false
                    )
                  end as expected_period_open
             from (values (1)) probe(marker)
             left join locked_item item on true
             left join locked_period period on true
         ), inserted as (
           insert into ${REQUEST_ITEMS}
             (id, request_id, item_id, responsibility_period_id_at_request,
              current_responsible_id_at_request, created_at)
           select $1, $2, item.id, $5, $6, $7
             from locked_item item
             left join locked_period period on true
            where item.version = $4
              and item.status = 'active'
              and item.archived_at is null
              and (
                ($5::uuid is null and $6::uuid is null and period.id is null)
                or (
                  period.id = $5
                  and period.responsible_user_id = $6
                  and period.ended_at is null
                )
              )
           returning id, request_id, item_id,
             responsibility_period_id_at_request,
             current_responsible_id_at_request, result, invalid_reason,
             created_at, decided_at, decided_by, version
         )
         select inserted.id, inserted.request_id, inserted.item_id,
                inserted.responsibility_period_id_at_request,
                inserted.current_responsible_id_at_request,
                inserted.result, inserted.invalid_reason,
                inserted.created_at, inserted.decided_at,
                inserted.decided_by, inserted.version,
                validation.item_exists, validation.item_status,
                validation.archived_at, validation.item_version,
                validation.expected_period_open
           from validation
           left join inserted on true`,
        [
          input.id,
          input.requestId,
          input.itemId,
          input.expectedItemVersion,
          input.responsibilityPeriodIdAtRequest,
          input.currentResponsibleIdAtRequest,
          input.createdAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("tmc_transfer_request_item_insert_failed");
      if (!row.id) {
        throw new TmcOperationRepositoryConflictError(
          atomicInsertProblem(row, input),
          {
            reason: "atomic_item_check_failed",
          },
        );
      }
      return mapInsertedRequestItem({
        id: row.id,
        request_id: required(row.request_id),
        item_id: required(row.item_id),
        responsibility_period_id_at_request:
          row.responsibility_period_id_at_request,
        current_responsible_id_at_request:
          row.current_responsible_id_at_request,
        result: required(row.result),
        invalid_reason: row.invalid_reason,
        created_at: required(row.created_at),
        decided_at: row.decided_at,
        decided_by: row.decided_by,
        version: required(row.version),
      });
    } catch (error) {
      const problem = constraintProblem(error);
      if (problem) throw new TmcOperationRepositoryConflictError(problem, error);
      throw error;
    }
  }

}

class PostgresTmcStageFourRepository implements TmcStageFourRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async listHistory(input: TmcTransferHistoryQuery) {
    const values: unknown[] = [];
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const actor = input.includeAll ? null : bind(input.actorId);
    const effectiveStatus = input.includeAll
      ? "request.status"
      : `(case
          when request.initiator_id = ${actor}
            or request.recipient_id = ${actor}
            then request.status
          when exists (
            select 1 from ${REQUEST_ITEMS} status_item
             where status_item.request_id = request.id
               and status_item.current_responsible_id_at_request = ${actor}
               and status_item.result = 'pending'
          ) then 'pending'
          when exists (
            select 1 from ${REQUEST_ITEMS} status_item
             where status_item.request_id = request.id
               and status_item.current_responsible_id_at_request = ${actor}
               and status_item.result = 'accepted'
          ) then 'accepted'
          when not exists (
            select 1 from ${REQUEST_ITEMS} status_item
             where status_item.request_id = request.id
               and status_item.current_responsible_id_at_request = ${actor}
               and status_item.result <> 'cancelled'
          ) then 'cancelled'
          else 'rejected'
        end)`;
    const predicates = [
      input.includeAll
        ? "true"
        : `(request.initiator_id = ${actor}
            or request.recipient_id = ${actor}
            or exists (
              select 1 from ${REQUEST_ITEMS} participant_item
              where participant_item.request_id = request.id
                and participant_item.current_responsible_id_at_request = ${actor}
            ))`,
    ];
    if (input.status) predicates.push(`${effectiveStatus} = ${bind(input.status)}`);
    if (input.createdFrom) predicates.push(`request.created_at >= ${bind(input.createdFrom)}`);
    if (input.createdTo) predicates.push(`request.created_at <= ${bind(input.createdTo)}`);
    if (input.initiatorId) predicates.push(`request.initiator_id = ${bind(input.initiatorId)}`);
    if (input.recipientId) predicates.push(`request.recipient_id = ${bind(input.recipientId)}`);
    const itemPredicates: string[] = [];
    if (input.itemId) itemPredicates.push(`request_item.item_id = ${bind(input.itemId)}`);
    if (input.roomId) itemPredicates.push(`item.room_id = ${bind(input.roomId)}`);
    if (input.buildingId) itemPredicates.push(`room.building_id = ${bind(input.buildingId)}`);
    if (itemPredicates.length > 0) {
      if (actor) {
        itemPredicates.push(`(
          request.initiator_id = ${actor}
          or request.recipient_id = ${actor}
          or request_item.current_responsible_id_at_request = ${actor}
        )`);
      }
      predicates.push(`exists (
        select 1 from ${REQUEST_ITEMS} request_item
        join ${ITEMS} item on item.id = request_item.item_id
        join ${ROOMS} room on room.id = item.room_id
        where request_item.request_id = request.id and ${itemPredicates.join(" and ")}
      )`);
    }
    if (input.overdue !== undefined) {
      const overdue = `(${effectiveStatus} = 'pending' and request.expires_at <= ${bind(input.now)})`;
      predicates.push(input.overdue ? overdue : `not ${overdue}`);
    }
    if (input.requestCursorCreatedAt && input.requestCursorId) {
      const at = bind(input.requestCursorCreatedAt);
      const id = bind(input.requestCursorId);
      predicates.push(`(request.created_at, request.id) < (${at}, ${id})`);
    }
    const limit = bind(input.limit);
    const result = await this.source.query<{ id: string } & QueryResultRow>(
      `select request.id from ${REQUESTS} request
        where ${predicates.join(" and ")}
        order by request.created_at desc, request.id desc
        limit ${limit}`,
      values,
    );
    const requests = new PostgresTmcTransferRequestRepository(this.source);
    const records: TmcTransferRequestRecord[] = [];
    for (const row of result.rows) {
      const record = await requests.findById(row.id);
      if (record) records.push(record);
    }
    return records;
  }

  async listLocationHistory(input: TmcTransferHistoryQuery): Promise<TmcLocationHistoryRecord[]> {
    if (input.status || input.initiatorId || input.recipientId || input.overdue !== undefined) {
      return [];
    }
    const values: unknown[] = [];
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const predicates = [
      `audit.subject_kind = 'item'`,
      `audit.action = 'item.location_changed'`,
      input.includeAll
        ? "true"
        : `exists (
            select 1 from ${RESPONSIBILITY_PERIODS} participant_period
             where participant_period.item_id = audit.subject_id
               and participant_period.responsible_user_id = ${bind(input.actorId)}
               and participant_period.started_at <= audit.occurred_at
               and (participant_period.ended_at is null or participant_period.ended_at >= audit.occurred_at)
          )`,
    ];
    if (input.createdFrom) predicates.push(`audit.occurred_at >= ${bind(input.createdFrom)}`);
    if (input.createdTo) predicates.push(`audit.occurred_at <= ${bind(input.createdTo)}`);
    if (input.itemId) predicates.push(`audit.subject_id = ${bind(input.itemId)}`);
    if (input.roomId) {
      const room = bind(input.roomId);
      predicates.push(`(audit.before_values->>'roomId' = ${room}::text or audit.after_values->>'roomId' = ${room}::text)`);
    }
    if (input.buildingId) {
      const building = bind(input.buildingId);
      predicates.push(`exists (
        select 1 from ${ROOMS} history_room
         where history_room.building_id = ${building}
           and history_room.id::text in (audit.before_values->>'roomId', audit.after_values->>'roomId')
      )`);
    }
    if (input.locationCursorOccurredAt && input.locationCursorId) {
      const at = bind(input.locationCursorOccurredAt);
      const id = bind(input.locationCursorId);
      predicates.push(`(audit.occurred_at, audit.id) < (${at}, ${id})`);
    }
    const limit = bind(input.limit);
    const result = await this.source.query<{
      id: string; item_id: string; item_name: string; inventory_number: string;
      actor_id: string | null; actor_name: string | null;
      before_room_id: string; before_location: string;
      after_room_id: string; after_location: string; comment: string | null;
      occurred_at: Date;
    } & QueryResultRow>(
      `select audit.id, audit.subject_id as item_id, item.name as item_name,
              item.inventory_number, audit.actor_id, actor.full_name as actor_name,
              audit.before_values->>'roomId' as before_room_id,
              audit.before_values->>'location' as before_location,
              audit.after_values->>'roomId' as after_room_id,
              audit.after_values->>'location' as after_location,
              audit.after_values->>'comment' as comment, audit.occurred_at
         from ${AUDIT_RECORDS} audit
         join ${ITEMS} item on item.id = audit.subject_id
         left join ${USERS} actor on actor.id = audit.actor_id
        where ${predicates.join(" and ")}
        order by audit.occurred_at desc, audit.id desc
        limit ${limit}`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id, itemId: row.item_id, itemName: row.item_name,
      inventoryNumber: row.inventory_number, actorId: row.actor_id,
      actorName: row.actor_name, beforeRoomId: row.before_room_id,
      beforeLocation: row.before_location, afterRoomId: row.after_room_id,
      afterLocation: row.after_location, comment: row.comment,
      occurredAt: row.occurred_at,
    }));
  }

  async appendAudit(input: AppendTmcAuditRecord): Promise<void> {
    await this.source.query(
      `insert into ${AUDIT_RECORDS}
         (id, domain_event_id, actor_id, actor_role_snapshot, subject_kind,
          subject_id, subject_revision, action, before_values, after_values,
          occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [input.id, input.domainEventId, input.actorId, input.actorRole,
       input.subjectKind, input.subjectId, input.subjectRevision, input.action,
       input.beforeValues, input.afterValues, input.occurredAt],
    );
  }

  async createNotification(input: CreateTmcNotificationRecord): Promise<void> {
    const mailboxId = input.domainEventId;
    const mailbox = input.audience === "direct_user"
      ? await this.source.query<{ sequence: string } & QueryResultRow>(
          `insert into ${NOTIFICATION_MAILBOXES} (id, kind, user_id, next_sequence)
           values ($1, 'direct_user', $2, 2)
           on conflict (user_id) where kind = 'direct_user'
           do update set next_sequence = ${NOTIFICATION_MAILBOXES}.next_sequence + 1
           returning (next_sequence - 1)::text as sequence`,
          [mailboxId, input.recipientId],
        )
      : await this.source.query<{ sequence: string } & QueryResultRow>(
          `insert into ${NOTIFICATION_MAILBOXES} (id, kind, user_id, next_sequence)
           values ($1, 'admin_queue', null, 2)
           on conflict (kind) where kind = 'admin_queue'
           do update set next_sequence = ${NOTIFICATION_MAILBOXES}.next_sequence + 1
           returning (next_sequence - 1)::text as sequence`,
          [mailboxId],
        );
    const sequence = mailbox.rows[0]?.sequence;
    if (!sequence) throw new Error("tmc_notification_mailbox_sequence_missing");
    await this.source.query(
      `insert into ${NOTIFICATION_EVENTS}
         (id, domain_event_id, type, actor_id, subject_kind, subject_id,
          subject_revision, audience_kind, safe_payload, occurred_at,
          admin_queue_sequence)
       values ($1,$2,$3,$4,'tmc_transfer_request',$5,$6,$7,$8,$9,$10)`,
      [input.id, input.domainEventId, input.type, input.actorId, input.requestId,
       input.requestRevision, input.audience, input.safePayload, input.occurredAt,
       input.audience === "admin_queue" ? sequence : null],
    );
    await this.source.query(
      `insert into ${TMC_NOTIFICATIONS}
         (notification_event_id, request_id, item_id, created_at)
       values ($1,$2,$3,$4)`,
      [input.id, input.requestId, input.itemId, input.occurredAt],
    );
    if (input.audience === "direct_user") {
      if (!input.recipientId) throw new Error("tmc_notification_recipient_missing");
      await this.source.query(
        `insert into ${NOTIFICATION_DELIVERIES}
           (event_id, recipient_id, mailbox_sequence, created_at)
         values ($1,$2,$3,$4)`,
        [input.id, input.recipientId, sequence, input.occurredAt],
      );
    }
    await this.source.query(
      `insert into ${WEB_PUSH_OUTBOX}
         (notification_event_id, available_at, created_at)
       values ($1,$2,$3)
       on conflict (notification_event_id) do nothing`,
      [input.id, input.occurredAt, input.occurredAt],
    );
  }

  async listNotifications(input: { actorId: string; includeAdminQueue: boolean; now: Date; limit: number }) {
    const result = await this.source.query<NotificationRow>(notificationFeedSql(""), [
      input.actorId, input.includeAdminQueue, input.now, input.limit,
    ]);
    return result.rows.map(mapNotification);
  }

  async countUnreadNotifications(input: { actorId: string; includeAdminQueue: boolean; now: Date }) {
    const result = await this.source.query<{ count: string } & QueryResultRow>(
      `select count(*)::text as count from (${notificationFeedSql("and feed.read_at is null", false)}) unread`,
      [input.actorId, input.includeAdminQueue, input.now],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async markNotificationRead(input: { notificationId: string; actorId: string; includeAdminQueue: boolean; readAt: Date }) {
    const direct = await this.source.query(
      `update ${NOTIFICATION_DELIVERIES} delivery
          set read_at = coalesce(delivery.read_at, $3)
         from ${NOTIFICATION_EVENTS} event
         join ${TMC_NOTIFICATIONS} tmc on tmc.notification_event_id = event.id
         join ${REQUESTS} request on request.id = tmc.request_id
        where delivery.event_id = $1 and delivery.recipient_id = $2
          and event.id = delivery.event_id and event.occurred_at <= $3
          and (event.type <> 'tmc_transfer.overdue'
               or (request.status = 'pending' and request.expires_at <= $3))`,
      [input.notificationId, input.actorId, input.readAt],
    );
    if ((direct.rowCount ?? 0) > 0) return true;
    if (!input.includeAdminQueue) return false;
    const admin = await this.source.query(
      `insert into ${NOTIFICATION_RECEIPTS} (event_id, user_id, read_at)
       select event.id, $2, $3 from ${NOTIFICATION_EVENTS} event
       join ${TMC_NOTIFICATIONS} tmc on tmc.notification_event_id = event.id
       join ${REQUESTS} request on request.id = tmc.request_id
       where event.id = $1 and event.audience_kind = 'admin_queue'
         and event.occurred_at <= $3
         and (event.type <> 'tmc_transfer.overdue'
              or (request.status = 'pending' and request.expires_at <= $3))
       on conflict (event_id, user_id) do update
         set read_at = ${NOTIFICATION_RECEIPTS}.read_at
       returning event_id`,
      [input.notificationId, input.actorId, input.readAt],
    );
    return (admin.rowCount ?? 0) > 0;
  }
}

interface NotificationRow extends QueryResultRow {
  id: string;
  type: TmcNotificationRecord["type"];
  request_id: string;
  item_id: string | null;
  safe_payload: Record<string, string | number | boolean | null>;
  occurred_at: Date;
  read_at: Date | null;
}

function notificationFeedSql(extraPredicate: string, includeLimit = true) {
  return `select feed.* from (
    select event.id, event.type, tmc.request_id, tmc.item_id,
           event.safe_payload, event.occurred_at, delivery.read_at
      from ${NOTIFICATION_EVENTS} event
      join ${TMC_NOTIFICATIONS} tmc on tmc.notification_event_id = event.id
      join ${NOTIFICATION_DELIVERIES} delivery on delivery.event_id = event.id
      join ${REQUESTS} request on request.id = tmc.request_id
     where delivery.recipient_id = $1 and event.occurred_at <= $3
       and (event.type <> 'tmc_transfer.overdue'
            or (request.status = 'pending' and request.expires_at <= $3))
    union all
    select event.id, event.type, tmc.request_id, tmc.item_id,
           event.safe_payload, event.occurred_at, receipt.read_at
      from ${NOTIFICATION_EVENTS} event
      join ${TMC_NOTIFICATIONS} tmc on tmc.notification_event_id = event.id
      join ${REQUESTS} request on request.id = tmc.request_id
      left join ${NOTIFICATION_RECEIPTS} receipt
        on receipt.event_id = event.id and receipt.user_id = $1
     where $2::boolean and event.audience_kind = 'admin_queue'
       and event.occurred_at <= $3
       and (event.type <> 'tmc_transfer.overdue'
            or (request.status = 'pending' and request.expires_at <= $3))
  ) feed where true ${extraPredicate}
  order by feed.occurred_at desc, feed.id desc
  ${includeLimit ? "limit $4" : ""}`;
}

function mapNotification(row: NotificationRow): TmcNotificationRecord {
  return {
    id: row.id,
    type: row.type,
    requestId: row.request_id,
    itemId: row.item_id,
    safePayload: row.safe_payload,
    occurredAt: new Date(row.occurred_at),
    readAt: optionalDate(row.read_at),
  };
}

function atomicInsertProblem(
  row: AtomicInsertRequestItemRow,
  input: InsertTmcTransferRequestItemRecord,
): TmcOperationRepositoryConflictProblem {
  if (!row.item_exists) return "item_not_found";
  if (row.item_status !== "active" || row.archived_at) return "item_inactive";
  if (Number(row.item_version) !== input.expectedItemVersion) {
    return "version_conflict";
  }
  if (!row.expected_period_open) return "responsibility_changed";
  return "responsibility_changed";
}

function candidateSelect() {
  return `select i.id as item_id, i.version as item_version,
           i.status as item_status, i.archived_at, i.name as item_name,
           i.inventory_number, i.quantity, i.unit_price, photo.id as photo_id,
           building.id as building_id, building.name as building_name,
           room.id as room_id, room.designation as room_designation,
           responsibility.id as responsibility_period_id,
           responsibility.responsible_user_id,
           responsible.full_name as responsible_full_name,
           responsible.email as responsible_email,
           responsible.role as responsible_role,
           responsible.is_active as responsible_is_active,
           responsible.deleted_at as responsible_deleted_at,
           (legacy_transfer.id is not null or request_item.id is not null)
             as has_active_transfer
      from ${ITEMS} i
      join ${ROOMS} room on room.id = i.room_id
      join ${BUILDINGS} building on building.id = room.building_id
      left join lateral (
        select period.id, period.responsible_user_id
          from ${RESPONSIBILITY_PERIODS} period
         where period.item_id = i.id and period.ended_at is null
         order by period.started_at desc, period.id desc
         limit 1
      ) responsibility on true
      left join ${USERS} responsible
        on responsible.id = responsibility.responsible_user_id
      left join lateral (
        select transfer.id
          from ${LEGACY_TRANSFERS} transfer
         where transfer.item_id = i.id
           and transfer.status = 'pending_current_owner'
         limit 1
      ) legacy_transfer on true
      left join lateral (
        select request_item.id
          from ${REQUEST_ITEMS} request_item
         where request_item.item_id = i.id
           and request_item.result = 'pending'
         limit 1
      ) request_item on true
      left join lateral (
        select stored_photo.id
          from ${PHOTOS} stored_photo
         where stored_photo.item_id = i.id and stored_photo.purpose = 'item'
           and stored_photo.status = 'attached'
         order by stored_photo.attached_at desc nulls last, stored_photo.id
         limit 1
      ) photo on true
     where i.id = any($1::uuid[])
     order by i.id`;
}

function requestAggregateSelect() {
  return `select request.id as request_id, request.initiator_id,
           initiator.full_name as initiator_full_name,
           initiator.email as initiator_email,
           initiator.role as initiator_role,
           request.recipient_id,
           recipient.full_name as recipient_full_name,
           recipient.email as recipient_email,
           recipient.role as recipient_role,
           request.status as request_status, request.comment,
           request.created_at as request_created_at,
           request.expires_at, request.closed_at, request.closed_by,
           closer.full_name as closed_by_full_name,
           closer.email as closed_by_email, closer.role as closed_by_role,
           request.is_administrative_decision,
           request.administrative_reason,
           request.version as request_version,
           request_item.id as request_item_id, request_item.item_id,
           request_item.responsibility_period_id_at_request,
           request_item.current_responsible_id_at_request,
           captured.full_name as current_responsible_full_name,
           captured.email as current_responsible_email,
           captured.role as current_responsible_role,
           request_item.result, request_item.invalid_reason,
           request_item.created_at as request_item_created_at,
           request_item.decided_at, request_item.decided_by,
           decider.full_name as decided_by_full_name,
           decider.email as decided_by_email,
           decider.role as decided_by_role,
           request_item.version as request_item_version,
           item.name as item_name, item.inventory_number,
           item.quantity, item.unit_price, item.version as item_version,
           photo.id as photo_id, building.id as building_id,
           building.name as building_name, room.id as room_id,
           room.designation as room_designation
      from ${REQUESTS} request
      join ${USERS} initiator on initiator.id = request.initiator_id
      join ${USERS} recipient on recipient.id = request.recipient_id
      left join ${USERS} closer on closer.id = request.closed_by
      left join ${REQUEST_ITEMS} request_item
        on request_item.request_id = request.id
      left join ${ITEMS} item on item.id = request_item.item_id
      left join ${ROOMS} room on room.id = item.room_id
      left join ${BUILDINGS} building on building.id = room.building_id
      left join ${USERS} captured
        on captured.id = request_item.current_responsible_id_at_request
      left join ${USERS} decider on decider.id = request_item.decided_by
      left join lateral (
        select stored_photo.id
          from ${PHOTOS} stored_photo
         where stored_photo.item_id = item.id
           and stored_photo.purpose = 'item'
           and stored_photo.status = 'attached'
         order by stored_photo.attached_at desc nulls last, stored_photo.id
         limit 1
      ) photo on true
     where request.id = $1
     order by request_item.created_at nulls last, request_item.id`;
}

function mapCandidate(row: CandidateRow): TmcTransferCandidateRecord {
  return {
    itemId: row.item_id,
    itemVersion: Number(row.item_version),
    itemStatus: row.item_status,
    archivedAt: optionalDate(row.archived_at),
    name: row.item_name,
    inventoryNumber: row.inventory_number,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    photoUrl: photoUrl(row.item_id, row.item_version, row.photo_id),
    buildingId: row.building_id,
    buildingName: row.building_name,
    roomId: row.room_id,
    roomDesignation: row.room_designation,
    responsibilityPeriodId: row.responsibility_period_id,
    responsibleUser: row.responsible_user_id
      ? {
          id: row.responsible_user_id,
          fullName: required(row.responsible_full_name),
          email: required(row.responsible_email),
          role: required(row.responsible_role),
          active: required(row.responsible_is_active),
          deletedAt: optionalDate(row.responsible_deleted_at),
        }
      : null,
    hasActiveTransfer: row.has_active_transfer,
  };
}

function mapRequest(
  row: RequestRow,
  items: RequestItemRow[],
): TmcTransferRequestRecord {
  return {
    id: row.request_id,
    initiator: mapUser(
      row.initiator_id,
      row.initiator_full_name,
      row.initiator_email,
      row.initiator_role,
    ),
    recipient: mapUser(
      row.recipient_id,
      row.recipient_full_name,
      row.recipient_email,
      row.recipient_role,
    ),
    status: row.request_status,
    comment: row.comment,
    createdAt: new Date(row.request_created_at),
    expiresAt: new Date(row.expires_at),
    closedAt: optionalDate(row.closed_at),
    closedBy: row.closed_by
      ? mapUser(
          row.closed_by,
          required(row.closed_by_full_name),
          required(row.closed_by_email),
          required(row.closed_by_role),
        )
      : null,
    isAdministrativeDecision: row.is_administrative_decision,
    administrativeReason: row.administrative_reason,
    version: Number(row.request_version),
    items: items.map(mapRequestItem),
  };
}

function mapRequestItem(row: RequestItemRow): TmcTransferRequestItemRecord {
  return {
    id: required(row.request_item_id),
    requestId: row.request_id,
    itemId: row.item_id,
    item: {
      id: row.item_id,
      version: Number(row.item_version),
      name: row.item_name,
      inventoryNumber: row.inventory_number,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      photoUrl: photoUrl(row.item_id, row.item_version, row.photo_id),
      buildingId: row.building_id,
      buildingName: row.building_name,
      roomId: row.room_id,
      roomDesignation: row.room_designation,
    },
    responsibilityPeriodIdAtRequest:
      row.responsibility_period_id_at_request,
    currentResponsibleIdAtRequest:
      row.current_responsible_id_at_request,
    responsibleUserProfile: row.current_responsible_id_at_request
      ? mapUser(
          row.current_responsible_id_at_request,
          required(row.current_responsible_full_name),
          required(row.current_responsible_email),
          required(row.current_responsible_role),
        )
      : null,
    result: row.result,
    invalidReason: row.invalid_reason,
    createdAt: new Date(row.request_item_created_at),
    decidedAt: optionalDate(row.decided_at),
    decidedBy: row.decided_by
      ? mapUser(
          row.decided_by,
          required(row.decided_by_full_name),
          required(row.decided_by_email),
          required(row.decided_by_role),
        )
      : null,
    version: Number(row.request_item_version),
  };
}

function mapInsertedRequestItem(
  row: InsertedRequestItemRow,
): InsertedTmcTransferRequestItemRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    itemId: row.item_id,
    responsibilityPeriodIdAtRequest:
      row.responsibility_period_id_at_request,
    currentResponsibleIdAtRequest:
      row.current_responsible_id_at_request,
    result: row.result,
    invalidReason: row.invalid_reason,
    createdAt: new Date(row.created_at),
    decidedAt: optionalDate(row.decided_at),
    decidedBy: row.decided_by,
    version: Number(row.version),
  };
}

function mapUser(
  id: string,
  fullName: string,
  email: string,
  role: TmcOperationUserRecord["role"],
): TmcOperationUserRecord {
  return { id, fullName, email, role };
}

function photoUrl(
  itemId: string,
  itemVersion: number | string,
  photoId: string | null,
) {
  return photoId
    ? `/api/inventory/items/${itemId}/photo?v=${Number(itemVersion)}`
    : null;
}

function optionalDate(value: Date | null) {
  return value ? new Date(value) : null;
}

function required<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) {
    throw new Error("tmc_repository_projection_incomplete");
  }
  return value;
}

function constraintProblem(error: unknown) {
  if (!isPostgresConstraintError(error)) return null;
  switch (error.constraint) {
    case "tmc_transfer_request_items_pending_item_unique":
    case "tmc_active_item_transfer_unique":
      return "active_transfer_exists" as const;
    case "tmc_transfer_request_items_period_snapshot_fk":
      return "responsibility_changed" as const;
    case "tmc_transfer_request_items_request_item_unique":
      return "duplicate_item" as const;
    default:
      return null;
  }
}

function isPostgresConstraintError(
  error: unknown,
): error is { code: "23503" | "23505"; constraint: string } {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    (candidate.code === "23503" || candidate.code === "23505") &&
    typeof candidate.constraint === "string"
  );
}
