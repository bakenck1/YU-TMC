import "server-only";

import type { QueryResultRow } from "pg";
import type {
  AppendResponsibilityAuditRecord,
  CancelTransferRecord,
  CloseResponsibilityRecord,
  DecideTransferRecord,
  InsertResponsibilityRecord,
  InsertTransferRecord,
  InventoryResponsibilityAuthorizationUser,
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
  ItemResponsibilityState,
  OverrideTransferRecord,
  ResponsibilityTimelineRecord,
  TransferRecord,
} from "@/lib/application/ports/inventory-responsibility-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import {
  assertCollectionSize,
  COLLECTION_LIMITS,
  sqlCollectionLimit,
} from "@/lib/server/persistence/collection-limits";

const ITEMS = '"yu_inventory"."items"';
const RESPONSIBILITY = '"yu_inventory"."responsibility_periods"';
const TRANSFERS = '"yu_inventory"."transfers"';
const TRANSFER_OVERRIDE_OUTCOME =
  '"yu_inventory"."transfer_override_outcome"';
const USERS = '"yu_inventory"."users"';
const AUDIT = '"yu_inventory"."audit_records"';

interface StateRow extends QueryResultRow {
  item_id: string;
  responsibility_period_id: string | null;
  item_status: ItemResponsibilityState["itemStatus"];
  responsible_user_id: string | null;
  responsible_name: string | null;
}

interface TransferRow extends QueryResultRow {
  id: string;
  item_id: string;
  item_name: string | null;
  item_inventory_number: string | null;
  requested_by: string;
  requested_by_name: string;
  proposed_responsible_id: string;
  current_responsible_id_at_request: string;
  current_responsible_name: string;
  status: TransferRecord["status"];
  requested_at: Date;
  closed_at: Date | null;
  decision_comment: string | null;
  version: number;
}

interface TimelineRow extends QueryResultRow {
  id: string;
  kind: ResponsibilityTimelineRecord["kind"];
  occurred_at: Date;
  actor_name: string | null;
  responsible_name: string | null;
  status: string;
  detail: string | null;
  closed_at: Date | null;
}

interface AuthorizationUserRow extends QueryResultRow {
  id: string;
  role: InventoryResponsibilityAuthorizationUser["role"];
  is_active: boolean;
  deleted_at: Date | null;
  version: number | string;
}

export function createPostgresInventoryResponsibilityRepositories(
  source: PostgresRepositorySource,
): InventoryResponsibilityRepositories {
  return {
    responsibility: new PostgresInventoryResponsibilityRepository(source),
  };
}

class PostgresInventoryResponsibilityRepository
  implements InventoryResponsibilityRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async findItemState(itemId: string): Promise<ItemResponsibilityState | null> {
    const result = await this.source.query<StateRow>(
      `select i.id as item_id, i.status as item_status,
              rp.id as responsibility_period_id,
              rp.responsible_user_id,
              u.full_name as responsible_name
         from ${ITEMS} i
         left join lateral (
           select id, responsible_user_id
             from ${RESPONSIBILITY}
            where item_id = i.id and ended_at is null
            limit 1
         ) rp on true
         left join ${USERS} u on u.id = rp.responsible_user_id
        where i.id = $1`,
      [itemId],
    );
    const row = result.rows[0];
    return row
      ? {
          itemId: row.item_id,
          responsibilityPeriodId: row.responsibility_period_id,
          responsibleUserId: row.responsible_user_id,
          responsibleName: row.responsible_name,
          itemStatus: row.item_status,
        }
      : null;
  }

  async findItemStateForUpdate(
    itemId: string,
  ): Promise<ItemResponsibilityState | null> {
    const result = await this.source.query<StateRow>(
      `select i.id as item_id, i.status as item_status,
              current_period.id as responsibility_period_id,
              current_period.responsible_user_id,
              current_period.responsible_name
         from ${ITEMS} i
         left join lateral (
           select rp.id, rp.responsible_user_id, u.full_name as responsible_name
             from ${RESPONSIBILITY} rp
             left join ${USERS} u on u.id = rp.responsible_user_id
            where rp.item_id = i.id and rp.ended_at is null
            order by rp.id
            limit 1
              for update of rp
         ) current_period on true
        where i.id = $1
          for update of i`,
      [itemId],
    );
    return mapItemState(result.rows[0]);
  }

  async findAuthorizationUserForUpdate(
    userId: string,
  ): Promise<InventoryResponsibilityAuthorizationUser | null> {
    const result = await this.source.query<AuthorizationUserRow>(
      `select id, role, is_active, deleted_at, version
         from ${USERS}
        where id = $1
          for update`,
      [userId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          role: row.role,
          active: row.is_active,
          deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
          version: Number(row.version),
        }
      : null;
  }

  async isUserActiveForUpdate(userId: string): Promise<boolean> {
    const result = await this.source.query(
      `select 1
         from ${USERS}
        where id = $1 and is_active = true and deleted_at is null
        for update`,
      [userId],
    );
    return result.rowCount === 1;
  }

  async findPendingTransfer(itemId: string): Promise<TransferRecord | null> {
    const result = await this.source.query<TransferRow>(
      transferSelect("where t.item_id = $1 and t.status = 'pending_current_owner'"),
      [itemId],
    );
    return result.rows[0] ? mapTransfer(result.rows[0]) : null;
  }

  async findTransfer(id: string): Promise<TransferRecord | null> {
    const result = await this.source.query<TransferRow>(
      transferSelect("where t.id = $1"),
      [id],
    );
    return result.rows[0] ? mapTransfer(result.rows[0]) : null;
  }

  async findTransferForDecision(
    id: string,
    currentResponsibleId: string,
  ): Promise<TransferRecord | null> {
    const result = await this.source.query<TransferRow>(
      transferSelect(
        "where t.id = $1 and t.current_responsible_id_at_request = $2",
        "for update of t",
      ),
      [id, currentResponsibleId],
    );
    return result.rows[0] ? mapTransfer(result.rows[0]) : null;
  }

  async findTransferForCancellation(
    id: string,
    requestedBy: string,
  ): Promise<TransferRecord | null> {
    const result = await this.source.query<TransferRow>(
      transferSelect(
        "where t.id = $1 and t.requested_by = $2",
        "for update of t",
      ),
      [id, requestedBy],
    );
    return result.rows[0] ? mapTransfer(result.rows[0]) : null;
  }

  async findTransferForOverride(id: string): Promise<TransferRecord | null> {
    const result = await this.source.query<TransferRow>(
      transferSelect("where t.id = $1", "for update of t"),
      [id],
    );
    return result.rows[0] ? mapTransfer(result.rows[0]) : null;
  }

  async listTransfersForUser(userId: string): Promise<TransferRecord[]> {
    const result = await this.source.query<TransferRow>(
      transferSelect(
        "where t.requested_by = $1 or t.current_responsible_id_at_request = $1",
        "",
        sqlCollectionLimit(COLLECTION_LIMITS.responsibilityTransfers),
      ),
      [userId],
    );
    return assertCollectionSize(
      result.rows,
      COLLECTION_LIMITS.responsibilityTransfers,
    ).map(mapTransfer);
  }

  async listTransfersForAuthorizedUser(
    input: {
      userId: string;
      role: InventoryResponsibilityAuthorizationUser["role"];
      sessionVersion: number;
    },
  ): Promise<TransferRecord[]> {
    const result = await this.source.query<TransferRow>(
      transferSelect(
        `where (
           t.requested_by = $1
           or t.current_responsible_id_at_request = $1
         )
         and exists (
           select 1
             from ${USERS} authorized_actor
            where authorized_actor.id = $1
              and authorized_actor.role = $2
              and authorized_actor.is_active = true
              and authorized_actor.deleted_at is null
              and authorized_actor.version = $3
         )`,
        "",
        sqlCollectionLimit(COLLECTION_LIMITS.responsibilityTransfers),
      ),
      [input.userId, input.role, input.sessionVersion],
    );
    return assertCollectionSize(
      result.rows,
      COLLECTION_LIMITS.responsibilityTransfers,
    ).map(mapTransfer);
  }

  async listTimeline(itemId: string): Promise<ResponsibilityTimelineRecord[]> {
    const result = await this.source.query<TimelineRow>(
      `select rp.id, 'responsibility'::text as kind, rp.started_at as occurred_at,
              starter.full_name as actor_name,
              responsible.full_name as responsible_name,
              rp.source::text as status, rp.end_reason as detail,
              rp.ended_at as closed_at
         from ${RESPONSIBILITY} rp
         left join ${USERS} starter on starter.id = rp.started_by
         join ${USERS} responsible on responsible.id = rp.responsible_user_id
        where rp.item_id = $1
       union all
       select t.id, 'transfer'::text as kind, t.requested_at as occurred_at,
              requester.full_name as actor_name,
              proposed.full_name as responsible_name,
              t.status::text as status,
              coalesce(t.decision_comment, t.administrative_reason) as detail,
              t.closed_at as closed_at
         from ${TRANSFERS} t
         join ${USERS} requester on requester.id = t.requested_by
         join ${USERS} proposed on proposed.id = t.proposed_responsible_id
        where t.item_id = $1
       order by occurred_at desc, id desc
       ${sqlCollectionLimit(COLLECTION_LIMITS.responsibilityTimeline)}`,
      [itemId],
    );
    return assertCollectionSize(
      result.rows,
      COLLECTION_LIMITS.responsibilityTimeline,
    ).map(mapTimeline);
  }

  async insertResponsibility(input: InsertResponsibilityRecord): Promise<void> {
    await this.source.query(
      `insert into ${RESPONSIBILITY}
         (id, item_id, responsible_user_id, source, started_at, started_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.itemId,
        input.responsibleUserId,
        input.source,
        input.startedAt,
        input.startedBy,
      ],
    );
  }

  async closeResponsibility(input: CloseResponsibilityRecord): Promise<boolean> {
    const result = await this.source.query(
      `update ${RESPONSIBILITY}
          set ended_at = $4, ended_by = $5, end_reason = $6
        where id = $1 and item_id = $2 and responsible_user_id = $3
          and ended_at is null`,
      [
        input.expectedResponsibilityPeriodId,
        input.itemId,
        input.expectedResponsibleUserId,
        input.endedAt,
        input.endedBy,
        input.endReason,
      ],
    );
    return result.rowCount === 1;
  }

  async insertTransfer(input: InsertTransferRecord): Promise<TransferRecord> {
    await this.source.query(
      `insert into ${TRANSFERS}
         (id, item_id, requested_by, proposed_responsible_id,
          current_responsible_id_at_request, requested_at)
       values ($1, $2, $3, $3, $4, $5)`,
      [
        input.id,
        input.itemId,
        input.requestedBy,
        input.currentResponsibleIdAtRequest,
        input.requestedAt,
      ],
    );
    const transfer = await this.findTransfer(input.id);
    if (!transfer) throw new Error("transfer_insert_failed");
    return transfer;
  }

  async decideTransfer(
    input: DecideTransferRecord,
  ): Promise<TransferRecord | null> {
    const result = await this.source.query(
      `update ${TRANSFERS}
          set status = $2, closed_at = $3, closed_by = $4,
              decision_comment = $5, version = version + 1
        where id = $1 and version = $6 and status = 'pending_current_owner'
          and current_responsible_id_at_request = $7`,
      [
        input.id,
        input.status,
        input.closedAt,
        input.closedBy,
        input.decisionComment,
        input.version,
        input.currentResponsibleIdAtRequest,
      ],
    );
    if (result.rowCount !== 1) return null;
    return this.findTransfer(input.id);
  }

  async cancelTransfer(
    input: CancelTransferRecord,
  ): Promise<TransferRecord | null> {
    const result = await this.source.query(
      `update ${TRANSFERS}
          set status = 'cancelled', closed_at = $2, closed_by = $3,
              version = version + 1
        where id = $1 and version = $4 and status = 'pending_current_owner'
          and requested_by = $5`,
      [
        input.id,
        input.closedAt,
        input.closedBy,
        input.version,
        input.requestedBy,
      ],
    );
    if (result.rowCount !== 1) return null;
    return this.findTransfer(input.id);
  }

  async overrideTransfer(
    input: OverrideTransferRecord,
  ): Promise<TransferRecord | null> {
    const result = await this.source.query(
      `update ${TRANSFERS}
          set status = 'overridden', closed_at = $2, closed_by = $3,
              administrative_reason = $4,
              override_outcome = $5::${TRANSFER_OVERRIDE_OUTCOME},
              override_responsible_id = $6::uuid, version = version + 1
        where id = $1 and version = $7 and status = 'pending_current_owner'
          and item_id = $8
          and current_responsible_id_at_request = $10
          and exists (
            select 1
              from ${RESPONSIBILITY} current_period
             where current_period.id = $9
               and current_period.item_id = $8
               and current_period.responsible_user_id = $10
               and current_period.ended_at is null
          )
          and exists (
            select 1
              from ${USERS} administrator
             where administrator.id = $3
               and administrator.role = 'admin'
               and administrator.is_active = true
               and administrator.deleted_at is null
               and administrator.version = $11
          )
          and (
            ($5::${TRANSFER_OVERRIDE_OUTCOME} = 'released' and $6::uuid is null)
            or (
              $5::${TRANSFER_OVERRIDE_OUTCOME} = 'assigned'
              and $6::uuid is not null
              and $6::uuid <> $10
              and exists (
                select 1
                  from ${USERS} target
                 where target.id = $6::uuid
                   and target.role = 'employee'
                   and target.is_active = true
                   and target.deleted_at is null
              )
            )
          )`,
      [
        input.id,
        input.closedAt,
        input.administratorId,
        input.administrativeReason,
        input.overrideOutcome,
        input.overrideResponsibleId,
        input.version,
        input.expectedItemId,
        input.expectedResponsibilityPeriodId,
        input.expectedCurrentResponsibleId,
        input.administratorSessionVersion,
      ],
    );
    if (result.rowCount !== 1) return null;
    return this.findTransfer(input.id);
  }

  async appendAudit(input: AppendResponsibilityAuditRecord): Promise<void> {
    await this.source.query(
      `insert into ${AUDIT}
         (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
          subject_revision, action, before_values, after_values, reason,
          is_administrative_exception, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.id,
        input.actorId,
        input.actorRole,
        input.subjectKind,
        input.subjectId,
        input.subjectRevision ?? 1,
        input.action,
        input.beforeValues,
        input.afterValues,
        input.reason ?? null,
        input.isAdministrativeException ?? false,
        input.occurredAt,
      ],
    );
  }
}

function transferSelect(where: string, lock = "", limit = "") {
  return `
    select t.id, t.item_id, i.name as item_name,
           i.inventory_number as item_inventory_number, t.requested_by,
           requester.full_name as requested_by_name,
           t.proposed_responsible_id,
           t.current_responsible_id_at_request,
           current_owner.full_name as current_responsible_name,
           t.status, t.requested_at, t.closed_at,
           t.decision_comment, t.version
      from ${TRANSFERS} t
      join ${ITEMS} i on i.id = t.item_id
      join ${USERS} requester on requester.id = t.requested_by
      join ${USERS} current_owner
        on current_owner.id = t.current_responsible_id_at_request
     ${where}
     order by t.requested_at desc, t.id
     ${limit}
     ${lock}`;
}

function mapItemState(row: StateRow | undefined): ItemResponsibilityState | null {
  return row
    ? {
        itemId: row.item_id,
        responsibilityPeriodId: row.responsibility_period_id,
        responsibleUserId: row.responsible_user_id,
        responsibleName: row.responsible_name,
        itemStatus: row.item_status,
      }
    : null;
}

function mapTransfer(row: TransferRow): TransferRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    itemInventoryNumber: row.item_inventory_number,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    proposedResponsibleId: row.proposed_responsible_id,
    currentResponsibleIdAtRequest: row.current_responsible_id_at_request,
    currentResponsibleName: row.current_responsible_name,
    status: row.status,
    requestedAt: new Date(row.requested_at),
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    decisionComment: row.decision_comment,
    version: Number(row.version),
  };
}

function mapTimeline(row: TimelineRow): ResponsibilityTimelineRecord {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: new Date(row.occurred_at),
    actorName: row.actor_name,
    responsibleName: row.responsible_name,
    status: row.status,
    detail: row.detail,
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
  };
}
