import "server-only";

import type { QueryResultRow } from "pg";

import type {
  InsertedTmcTransferRequestItemRecord,
  InsertTmcTransferRequestItemRecord,
  InsertTmcTransferRequestRecord,
  TmcOperationRepositories,
  TmcOperationUserRecord,
  TmcTransferCandidateRecord,
  TmcTransferRequestItemRecord,
  TmcTransferRequestRecord,
  TmcTransferRequestRepository,
  TmcTransferUserRecord,
} from "@/lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "@/lib/application/ports/tmc-operation-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const ITEMS = '"yu_inventory"."items"';
const ROOMS = '"yu_inventory"."rooms"';
const BUILDINGS = '"yu_inventory"."buildings"';
const USERS = '"yu_inventory"."users"';
const PHOTOS = '"yu_inventory"."photos"';
const RESPONSIBILITY_PERIODS = '"yu_inventory"."responsibility_periods"';
const LEGACY_TRANSFERS = '"yu_inventory"."transfers"';
const REQUESTS = '"yu_inventory"."tmc_transfer_requests"';
const REQUEST_ITEMS = '"yu_inventory"."tmc_transfer_request_items"';

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
  responsibility_period_id_at_request: string;
  current_responsible_id_at_request: string;
  current_responsible_full_name: string;
  current_responsible_email: string;
  current_responsible_role: TmcOperationUserRecord["role"];
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
  responsibility_period_id_at_request: string;
  current_responsible_id_at_request: string;
  result: InsertedTmcTransferRequestItemRecord["result"];
  invalid_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  version: number | string;
}

export function createPostgresTmcOperationRepositories(
  source: PostgresRepositorySource,
): TmcOperationRepositories {
  return {
    transferRequests: new PostgresTmcTransferRequestRepository(source),
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
        where id = $1`,
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
      const result = await this.source.query<InsertedRequestItemRow>(
        `insert into ${REQUEST_ITEMS}
           (id, request_id, item_id, responsibility_period_id_at_request,
            current_responsible_id_at_request, created_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id, request_id, item_id,
           responsibility_period_id_at_request,
           current_responsible_id_at_request, result, invalid_reason,
           created_at, decided_at, decided_by, version`,
        [
          input.id,
          input.requestId,
          input.itemId,
          input.responsibilityPeriodIdAtRequest,
          input.currentResponsibleIdAtRequest,
          input.createdAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("tmc_transfer_request_item_insert_failed");
      return mapInsertedRequestItem(row);
    } catch (error) {
      const problem = constraintProblem(error);
      if (problem) throw new TmcOperationRepositoryConflictError(problem, error);
      throw error;
    }
  }
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
    responsibleUserProfile: mapUser(
      row.current_responsible_id_at_request,
      row.current_responsible_full_name,
      row.current_responsible_email,
      row.current_responsible_role,
    ),
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
