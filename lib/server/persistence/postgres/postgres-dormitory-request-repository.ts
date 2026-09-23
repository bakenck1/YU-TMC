import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type {
  CreateDormitoryRequestInput,
  DormitoryRequestRepository,
  DormitoryRequestResult,
} from "@/lib/contracts/dormitory-requests";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import { DORMITORY_NAMES } from "@/lib/server/persistence/postgres/postgres-dormitory-asset-repository";

interface RequestRow {
  id: string;
  external_request_id: string;
  external_request_hash: string;
  item_id: string;
  item_name: string;
  inventory_number: string;
  requested_action: CreateDormitoryRequestInput["action"];
  status: "new";
  created_at: Date;
}

export function createPostgresDormitoryRequestRepository(
  pool: Pool = getDatabasePool(),
): DormitoryRequestRepository {
  return {
    async create(input, requestHash) {
      const client = await pool.connect();
      try {
        await client.query("begin isolation level serializable");
        const existing = await findByExternalId(client, input.externalRequestId, true);
        if (existing) {
          if (existing.external_request_hash !== requestHash) {
            throw new ApplicationError("conflict", "dormitory_request_id_reused");
          }
          await client.query("commit");
          return mapRequest(existing, true);
        }

        const itemResult = await client.query<{
          id: string;
          name: string;
          inventory_number: string;
          room_id: string;
          status: string;
          condition: string;
          version: number;
        }>(`
          select i.id, i.name, i.inventory_number, i.room_id,
                 i.status::text, i.condition::text, i.version
            from "yu_inventory"."items" i
            join "yu_inventory"."rooms" r on r.id = i.room_id
            join "yu_inventory"."buildings" b on b.id = r.building_id
           where i.id = $1 and b.name = any($2::text[])
             and i.status::text not in ('decommissioned', 'decommissioned_in_use')
           for update of i`,
          [input.itemId, DORMITORY_NAMES],
        );
        const item = itemResult.rows[0];
        if (!item) throw new ApplicationError("not_found", "dormitory_item_not_found");

        const id = randomUUID();
        const occurredAt = new Date();
        const type = input.action === "damaged" ? "damaged"
          : input.action === "missing" ? "missing" : "not_working";
        await client.query(`
          insert into "yu_inventory"."service_requests"
            (id, item_id, room_id, author_id, source, external_request_id,
             external_request_hash, reporter_name, requested_action, type,
             description, status, photo_media_type, photo_byte_size,
             photo_width, photo_height, photo_binary_data, created_at,
             updated_at, updated_by)
          values ($1, $2, $3, null, 'dormitory', $4, $5, $6, $7, $8,
                  $9, 'new', null, null, null, null, null, $10, $10, null)`,
          [id, item.id, item.room_id, input.externalRequestId, requestHash,
           input.reporterName, input.action, type, input.description, occurredAt],
        );

        const nextCondition = input.action === "damaged" || input.action === "missing"
          ? "damaged" : item.condition === "good" ? "needs_attention" : item.condition;
        const updatedItem = await client.query<{ version: number }>(`
          update "yu_inventory"."items"
             set status = 'maintenance', condition = $2::"yu_inventory"."item_condition",
                 updated_at = $3, version = version + 1
           where id = $1
           returning version`,
          [item.id, nextCondition, occurredAt],
        );
        const itemVersion = Number(updatedItem.rows[0]?.version ?? item.version + 1);

        await client.query(`
          insert into "yu_inventory"."audit_records"
            (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
             subject_revision, action, before_values, after_values, metadata,
             occurred_at)
          values
            ($1, null, null, 'service_request', $2, 1,
             'service_request.created_from_dormitory', null, $3::jsonb,
             $4::jsonb, $5),
            ($6, null, null, 'item', $7, $8,
             'item.dormitory_maintenance_requested', $9::jsonb, $10::jsonb,
             $4::jsonb, $5)`,
          [randomUUID(), id,
           JSON.stringify({ itemId: item.id, action: input.action, status: "new" }),
           JSON.stringify({ source: "dormitory", externalRequestId: input.externalRequestId }),
           occurredAt, randomUUID(), item.id, itemVersion,
           JSON.stringify({ status: item.status, condition: item.condition }),
           JSON.stringify({ status: "maintenance", condition: nextCondition })],
        );

        const created = await findByExternalId(client, input.externalRequestId, false);
        if (!created) throw new Error("dormitory_request_insert_missing");
        await client.query("commit");
        return mapRequest(created, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        if (isUniqueViolation(error)) {
          const existing = await findByExternalId(pool, input.externalRequestId, false);
          if (existing?.external_request_hash === requestHash) return mapRequest(existing, true);
          throw new ApplicationError("conflict", "dormitory_request_id_reused", { cause: error });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function findByExternalId(
  source: Pick<Pool, "query">,
  externalRequestId: string,
  lock: boolean,
) {
  const result = await source.query<RequestRow>(`
    select request.id, request.external_request_id, request.external_request_hash,
           request.item_id, item.name as item_name, item.inventory_number,
           request.requested_action, request.status, request.created_at
      from "yu_inventory"."service_requests" request
      join "yu_inventory"."items" item on item.id = request.item_id
     where request.source = 'dormitory' and request.external_request_id = $1
     limit 1${lock ? " for update of request" : ""}`,
    [externalRequestId],
  );
  return result.rows[0] ?? null;
}

function mapRequest(row: RequestRow, replayed: boolean): DormitoryRequestResult {
  return {
    id: row.id,
    externalRequestId: row.external_request_id,
    item: { id: row.item_id, name: row.item_name, inventoryNumber: row.inventory_number },
    action: row.requested_action,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    replayed,
  };
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}
