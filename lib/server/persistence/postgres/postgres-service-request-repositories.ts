import "server-only";

import type { QueryResultRow } from "pg";
import { ApplicationError } from "@/lib/domain/application-error";
import type {
  InsertServiceRequestRecord,
  ServiceRequestAuthorizationActor,
  ServiceRequestAuthorizationUser,
  ServiceRequestPhotoRecord,
  ServiceRequestRecord,
  ServiceRequestRepositories,
  ServiceRequestRepository,
} from "@/lib/application/ports/service-request-repositories";
import type { ServiceRequestFilters } from "@/lib/contracts/service-requests";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import {
  assertCollectionSize,
  COLLECTION_LIMITS,
  sqlCollectionLimit,
} from "@/lib/server/persistence/collection-limits";

const REQUESTS = '"yu_inventory"."service_requests"';
const ITEMS = '"yu_inventory"."items"';
const ROOMS = '"yu_inventory"."rooms"';
const BUILDINGS = '"yu_inventory"."buildings"';
const USERS = '"yu_inventory"."users"';
const RESPONSIBILITY = '"yu_inventory"."responsibility_periods"';
const AUDIT = '"yu_inventory"."audit_records"';

interface RequestRow extends QueryResultRow {
  id: string;
  item_id: string;
  item_name: string;
  inventory_number: string;
  room_id: string;
  room_designation: string;
  building_name: string;
  author_id: string;
  author_name: string;
  responsible_id: string | null;
  responsible_name: string | null;
  room_responsible_id: string | null;
  item_responsible_id: string | null;
  type: ServiceRequestRecord["type"];
  description: string;
  status: ServiceRequestRecord["status"];
  created_at: Date;
  updated_at: Date;
  version: number;
}

interface AuthorizationUserRow extends QueryResultRow {
  id: string;
  role: ServiceRequestAuthorizationUser["role"];
  is_active: boolean;
  deleted_at: Date | null;
  version: number;
}

interface ItemContextRow extends QueryResultRow {
  room_id: string;
  room_responsible_id: string | null;
  item_responsible_id: string | null;
}

export function createPostgresServiceRequestRepositories(
  source: PostgresRepositorySource,
): ServiceRequestRepositories {
  return { requests: new PostgresServiceRequestRepository(source) };
}

class PostgresServiceRequestRepository implements ServiceRequestRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async list(
    filters: ServiceRequestFilters,
    actor: ServiceRequestAuthorizationActor,
  ) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace("?", `$${values.length}`));
    };
    values.push(actor.userId, actor.role, actor.sessionVersion);
    const actorIdIndex = values.length - 2;
    const actorRoleIndex = values.length - 1;
    const actorVersionIndex = values.length;
    clauses.push(
      `exists (
         select 1 from ${USERS} authorized_actor
          where authorized_actor.id = $${actorIdIndex}
            and authorized_actor.role = $${actorRoleIndex}
            and authorized_actor.is_active = true
            and authorized_actor.deleted_at is null
            and authorized_actor.version = $${actorVersionIndex}
       )`,
    );
    if (actor.role === "employee") {
      clauses.push(
        `(r.primary_responsible_id = $${actorIdIndex} or period.responsible_user_id = $${actorIdIndex})`,
      );
    }
    if (filters.status) add("request.status = ?", filters.status);
    if (filters.roomId) add("request.room_id = ?", filters.roomId);
    if (filters.employeeId) add("request.author_id = ?", filters.employeeId);
    if (filters.dateFrom) add("request.created_at >= ?", filters.dateFrom);
    if (filters.dateTo) add("request.created_at <= ?", filters.dateTo);
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await this.source.query<RequestRow>(
      `${requestSelect()} ${where}
       order by request.created_at desc, request.id desc
       ${sqlCollectionLimit(COLLECTION_LIMITS.serviceRequests)}`,
      values,
    );
    return assertCollectionSize(result.rows, COLLECTION_LIMITS.serviceRequests).map(mapRequest);
  }

  async findById(id: string) {
    const result = await this.source.query<RequestRow>(
      `${requestSelect()} where request.id = $1 limit 1`,
      [id],
    );
    return result.rows[0] ? mapRequest(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string) {
    const result = await this.source.query<RequestRow>(
      `${requestSelect()} where request.id = $1 limit 1 for update of request`,
      [id],
    );
    return result.rows[0] ? mapRequest(result.rows[0]) : null;
  }

  async findAuthorizationUserForUpdate(userId: string) {
    const result = await this.source.query<AuthorizationUserRow>(
      `select id, role, is_active, deleted_at, version
         from ${USERS}
        where id = $1
          for update`,
      [userId],
    );
    const actor = result.rows[0];
    return actor
      ? {
          id: actor.id,
          role: actor.role,
          active: actor.is_active,
          deletedAt: actor.deleted_at ? new Date(actor.deleted_at) : null,
          version: Number(actor.version),
        }
      : null;
  }

  async findItemContext(itemId: string) {
    const result = await this.source.query<ItemContextRow>(
      `select i.room_id, r.primary_responsible_id as room_responsible_id,
              period.responsible_user_id as item_responsible_id
         from ${ITEMS} i
         join ${ROOMS} r on r.id = i.room_id
         left join lateral (
           select responsible_user_id from ${RESPONSIBILITY}
            where item_id = i.id and ended_at is null
            order by started_at desc limit 1
         ) period on true
        where i.id = $1 and i.archived_at is null`,
      [itemId],
    );
    const row = result.rows[0];
    return row
      ? {
          roomId: row.room_id,
          roomResponsibleId: row.room_responsible_id,
          itemResponsibleId: row.item_responsible_id,
        }
      : null;
  }

  async findCreateAuthorizationForUpdate(itemId: string, actorId: string) {
    const actorResult = await this.source.query<AuthorizationUserRow>(
      `select id, role, is_active, deleted_at, version
         from ${USERS}
        where id = $1
          for update`,
      [actorId],
    );
    const itemResult = await this.source.query<ItemContextRow>(
      `select i.room_id, r.primary_responsible_id as room_responsible_id,
              period.responsible_user_id as item_responsible_id
         from ${ITEMS} i
         join ${ROOMS} r on r.id = i.room_id
         left join lateral (
           select responsible_user_id from ${RESPONSIBILITY}
            where item_id = i.id and ended_at is null
            order by started_at desc limit 1
            for update
         ) period on true
        where i.id = $1 and i.archived_at is null
          for update of i, r`,
      [itemId],
    );
    const actor = actorResult.rows[0];
    const item = itemResult.rows[0];
    return {
      actor: actor
        ? {
            id: actor.id,
            role: actor.role,
            active: actor.is_active,
            deletedAt: actor.deleted_at ? new Date(actor.deleted_at) : null,
            version: Number(actor.version),
          }
        : null,
      item: item
        ? {
            roomId: item.room_id,
            roomResponsibleId: item.room_responsible_id,
            itemResponsibleId: item.item_responsible_id,
          }
        : null,
    };
  }

  async insert(input: InsertServiceRequestRecord) {
    try {
      await this.source.query(
      `insert into ${REQUESTS}
         (id, item_id, room_id, author_id, type, description, status,
          photo_media_type, photo_byte_size, photo_width, photo_height,
          photo_binary_data, created_at, updated_at, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'new', 'image/jpeg', $7, $8, $9,
               $10, $11, $11, $4)`,
      [
        input.id,
        input.itemId,
        input.roomId,
        input.authorId,
        input.type,
        input.description,
        input.photoBytes.byteLength,
        input.photoWidth,
        input.photoHeight,
        input.photoBytes,
        input.occurredAt,
      ],
      );
    } catch (error) {
      const databaseError = error as { code?: string; constraint?: string };
      if (
        databaseError.code === "23505" &&
        databaseError.constraint === "service_requests_open_item_unique"
      ) {
        throw new ApplicationError("conflict", "open_service_request_exists", {
          cause: error,
        });
      }
      if (
        databaseError.code === "23514" &&
        databaseError.constraint === "service_requests_daily_quota"
      ) {
        throw new ApplicationError("rate_limited", "service_request_quota_exceeded", {
          cause: error,
        });
      }
      throw error;
    }
    const created = await this.findById(input.id);
    if (!created) throw new Error("Service request insert did not return a row.");
    return created;
  }

  async updateStatus(input: {
    id: string;
    status: ServiceRequestRecord["status"];
    expectedStatus: ServiceRequestRecord["status"];
    actorId: string;
    actorRole: ServiceRequestAuthorizationUser["role"];
    actorSessionVersion: number;
    expectedVersion: number;
    occurredAt: Date;
  }) {
    const result = await this.source.query(
      `update ${REQUESTS} as request
          set status = $2,
              completed_at = case when $2 = 'completed' then $4 else null end,
              updated_by = $3, updated_at = $4, version = version + 1
        where request.id = $1
          and request.version = $5
          and request.status = $6
          and exists (
            select 1
              from ${USERS} authorized_actor
             where authorized_actor.id = $3
               and authorized_actor.role = $7
               and authorized_actor.role = 'admin'
               and authorized_actor.is_active = true
               and authorized_actor.deleted_at is null
               and authorized_actor.version = $8
          )`,
      [
        input.id,
        input.status,
        input.actorId,
        input.occurredAt,
        input.expectedVersion,
        input.expectedStatus,
        input.actorRole,
        input.actorSessionVersion,
      ],
    );
    if (result.rowCount !== 1) return null;
    return this.findById(input.id);
  }

  async findPhoto(id: string): Promise<ServiceRequestPhotoRecord | null> {
    const result = await this.source.query<{
      photo_binary_data: Uint8Array;
      photo_media_type: string;
    } & QueryResultRow>(
      `select photo_binary_data, photo_media_type from ${REQUESTS} where id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? { bytes: new Uint8Array(row.photo_binary_data), mediaType: "image/jpeg" }
      : null;
  }

  async appendAudit(input: Parameters<ServiceRequestRepository["appendAudit"]>[0]) {
    await this.source.query(
      `insert into ${AUDIT}
         (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
          subject_revision, action, before_values, after_values, occurred_at)
       values ($1, $2, $3, 'service_request', $4, $5, $6, $7, $8, $9)`,
      [input.id, input.actorId, input.actorRole, input.subjectId,
       input.subjectRevision, input.action, input.beforeValues,
       input.afterValues, input.occurredAt],
    );
  }
}

function requestSelect() {
  return `select request.id, request.item_id, i.name as item_name,
                 i.inventory_number, request.room_id,
                 r.designation as room_designation, b.name as building_name,
                 request.author_id, author.full_name as author_name,
                 coalesce(period.responsible_user_id, r.primary_responsible_id) as responsible_id,
                 coalesce(item_responsible.full_name, room_responsible.full_name) as responsible_name,
                 r.primary_responsible_id as room_responsible_id,
                 period.responsible_user_id as item_responsible_id,
                 request.type, request.description, request.status,
                 request.created_at, request.updated_at, request.version
            from ${REQUESTS} request
            join ${ITEMS} i on i.id = request.item_id
            join ${ROOMS} r on r.id = request.room_id
            join ${BUILDINGS} b on b.id = r.building_id
            join ${USERS} author on author.id = request.author_id
            left join lateral (
              select responsible_user_id from ${RESPONSIBILITY}
               where item_id = i.id and ended_at is null
               order by started_at desc limit 1
            ) period on true
            left join ${USERS} item_responsible on item_responsible.id = period.responsible_user_id
            left join ${USERS} room_responsible on room_responsible.id = r.primary_responsible_id`;
}

function mapRequest(row: RequestRow): ServiceRequestRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    inventoryNumber: row.inventory_number,
    roomId: row.room_id,
    roomDesignation: row.room_designation,
    buildingName: row.building_name,
    authorId: row.author_id,
    authorName: row.author_name,
    responsibleId: row.responsible_id,
    responsibleName: row.responsible_name,
    roomResponsibleId: row.room_responsible_id,
    itemResponsibleId: row.item_responsible_id,
    type: row.type,
    description: row.description,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    version: Number(row.version),
  };
}
