import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryConfig, QueryResultRow } from "pg";
import { OneCMaterialsImportError, type OneCMaterialsRepository } from "@/lib/application/ports/one-c-materials-repository";
import { materialIdentityKey, materialWarehouseKey, materialResponsibleKey, type OneCMaterialsImportMetadata, type OneCMaterialsSnapshot } from "@/lib/contracts/one-c-materials";
import { getDatabasePool } from "@/lib/db/client";

type ImportTimeouts = { statementTimeoutMs: number; transactionTimeoutMs: number };
const DEFAULT_TIMEOUTS: ImportTimeouts = { statementTimeoutMs: 120_000, transactionTimeoutMs: 150_000 };
const IMPORT_LOCK_KEY = "yu-inventory:one-c-materials:v1";
const CLIENT_TIMEOUT_GRACE_MS = 1_000;
const INCOMING_ROWS = `select row.* from jsonb_to_recordset($1::jsonb) as row(
  row_key text, material_code text, warehouse_key text, payload_hash varchar(64),
  identity_version integer, account_key text, responsible_key text,
  payload jsonb, quantity numeric(18,3), unit_price numeric(18,2)
)`;

export class PostgresOneCMaterialsRepository implements OneCMaterialsRepository {
  constructor(
    private readonly pool: Pick<Pool, "connect"> = getDatabasePool(),
    private readonly timeouts: ImportTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  async saveSnapshot(snapshot: OneCMaterialsSnapshot, metadata: OneCMaterialsImportMetadata) {
    let client: PoolClient | undefined;
    let inTransaction = false;
    let destroyClient = false;
    const deadline = Date.now() + this.timeouts.transactionTimeoutMs;
    try {
      if (new Set(snapshot.materials.map(material => material.balanceSchemaVersion ?? 1)).size > 1) {
        throw new OneCMaterialsImportError("snapshot_conflict");
      }
      const keys = new Set<string>();
      const rows = snapshot.materials.map(material => {
        if (material.balanceSchemaVersion === 2 && (!material.accountCode || (material.responsibleName && !material.responsibleCode && !material.responsibleExternalId))) {
          throw new OneCMaterialsImportError("snapshot_conflict");
        }
        const rowKey = materialIdentityKey(material);
        if (keys.has(rowKey)) throw new OneCMaterialsImportError("snapshot_conflict");
        keys.add(rowKey);
        return {
          row_key: rowKey,
          material_code: material.code,
          warehouse_key: materialWarehouseKey(material),
          identity_version: material.balanceSchemaVersion ?? 1,
          account_key: material.balanceSchemaVersion === 2 ? `code:${material.accountCode}` : "unspecified",
          responsible_key: materialResponsibleKey(material),
          payload_hash: createHash("sha256").update(JSON.stringify(material)).digest("hex"),
          payload: material,
          quantity: material.quantity,
          unit_price: material.unitPrice,
        };
      });
      const serializedRows = JSON.stringify(rows);
      client = await this.pool.connect();
      await runQuery(client, "begin", [], Math.min(this.timeouts.statementTimeoutMs, this.timeouts.transactionTimeoutMs) + CLIENT_TIMEOUT_GRACE_MS);
      inTransaction = true;
      const query = async <T extends QueryResultRow = QueryResultRow>(sql: string, parameters: unknown[] = []) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new OneCMaterialsImportError("import_timeout");
        const statementTimeout = Math.min(this.timeouts.statementTimeoutMs, remaining);
        const clientTimeout = statementTimeout + CLIENT_TIMEOUT_GRACE_MS;
        // The pool's ordinary 30s query timeout must not cancel a supported bulk import first.
        await runQuery(client!, "select set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true)",
          [`${statementTimeout}ms`, `${remaining + CLIENT_TIMEOUT_GRACE_MS}ms`], clientTimeout);
        return runQuery<T>(client!, sql, parameters, clientTimeout);
      };
      const lock = await query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(hashtextextended($1, 731005)) as acquired", [IMPORT_LOCK_KEY],
      );
      if (!lock.rows[0]?.acquired) throw new OneCMaterialsImportError("import_in_progress");

      const previous = await query<{ id: string; compatible: boolean }>(
        `with incoming as (${INCOMING_ROWS})
         select b.id, b.source_snapshot_at = $3::timestamptz and b.received_count = $4::int
           and not exists (
             select 1 from incoming i full join
               (select r.* from "yu_inventory"."one_c_material_import_batch_rows" r where r.batch_id = b.id) r
               on r.row_key = i.row_key
             where i.row_key is null or r.row_key is null or i.payload_hash is distinct from r.payload_hash
           ) as compatible
         from "yu_inventory"."one_c_material_import_batches" b where b.source_sha256 = $2`,
        [serializedRows, metadata.sourceSha256, snapshot.snapshotAt, rows.length],
      );
      if (previous.rows.length) {
        if (!previous.rows[0].compatible) throw new OneCMaterialsImportError("snapshot_conflict");
        await query("commit");
        inTransaction = false;
        return { created: 0, updated: 0, unchanged: rows.length, batchId: previous.rows[0].id, replayed: true };
      }

      // Code is the stable identity. A conflicting GUID must not silently overwrite that identity.
      const identity = await query<{ conflict: boolean }>(
        `with incoming as (${INCOMING_ROWS}),
         materials as (select distinct material_code, payload->>'externalId' as guid from incoming),
         warehouses as (select distinct warehouse_key, payload->>'warehouseExternalId' as guid from incoming),
         current_warehouses as (select distinct warehouse_key, warehouse_external_id::text as guid from "yu_inventory"."one_c_material_inbox"),
         responsibles as (select distinct responsible_key, payload->>'responsibleExternalId' as guid from incoming where identity_version = 2),
         current_responsibles as (select distinct responsible_key, responsible_external_id::text as guid from "yu_inventory"."one_c_material_inbox" where identity_version = 2)
         select exists (
           select 1 from materials group by material_code having count(distinct guid) > 1
         ) or exists (
           select 1 from warehouses group by warehouse_key having count(distinct guid) > 1
         ) or exists (
           select 1 from materials where guid is not null group by guid having count(distinct material_code) > 1
         ) or exists (
           select 1 from warehouses where guid is not null group by guid having count(distinct warehouse_key) > 1
         ) or exists (
           select 1 from materials i join "yu_inventory"."one_c_material_inbox" current
             on current.material_code = i.material_code
           where i.guid is not null and current.material_external_id is not null
             and i.guid <> current.material_external_id::text
         ) or exists (
           select 1 from materials i join "yu_inventory"."one_c_material_inbox" current
             on current.material_external_id = i.guid::uuid
           where current.material_code <> i.material_code
         ) or exists (
           select 1 from warehouses i join current_warehouses current using (warehouse_key)
           where i.guid is not null and current.guid is not null and i.guid <> current.guid
         ) or exists (
           select 1 from warehouses i join current_warehouses current on current.guid = i.guid
           where current.warehouse_key <> i.warehouse_key
         ) or exists (
           select 1 from responsibles group by responsible_key having count(distinct guid) > 1
         ) or exists (
           select 1 from responsibles where guid is not null group by guid having count(distinct responsible_key) > 1
         ) or exists (
           select 1 from responsibles i join current_responsibles current using (responsible_key)
           where i.guid is not null and current.guid is not null and i.guid <> current.guid
         ) or exists (
           select 1 from responsibles i join current_responsibles current on current.guid = i.guid
           where current.responsible_key <> i.responsible_key
         ) as conflict`,
        [serializedRows],
      );
      if (identity.rows[0]?.conflict) throw new OneCMaterialsImportError("snapshot_conflict");
      // A legacy aggregate must never be restored over balances already split by account/MOL.
      const transition = await query<{ conflict: boolean }>(
        `with incoming as (${INCOMING_ROWS})
         select exists (
           select 1 from incoming i join "yu_inventory"."one_c_material_inbox" current
             on current.material_code = i.material_code and current.warehouse_key = i.warehouse_key
           where (i.identity_version = 1 and current.identity_version = 2)
              or (i.identity_version = 2 and current.identity_version = 1
                  and current.superseded_at is null
                  and (not $3::boolean or current.source_snapshot_at >= $2::timestamptz))
         ) as conflict`, [serializedRows, snapshot.snapshotAt, snapshot.replaceLegacyBalances === true],
      );
      if (transition.rows[0]?.conflict) throw new OneCMaterialsImportError("snapshot_conflict");
      const timestamps = await query<{ stale: boolean; conflict: boolean }>(
        `with incoming as (${INCOMING_ROWS})
         select exists (select 1 from "yu_inventory"."one_c_material_import_batches" b where b.source_snapshot_at > $2::timestamptz)
           or coalesce(bool_or(current.source_snapshot_at > $2::timestamptz), false) as stale,
           coalesce(bool_or(current.source_snapshot_at = $2::timestamptz
                           and current.payload_hash <> i.payload_hash), false) as conflict
         from incoming i join "yu_inventory"."one_c_material_inbox" current using (row_key)`,
        [serializedRows, snapshot.snapshotAt],
      );
      if (timestamps.rows[0]?.stale) throw new OneCMaterialsImportError("stale_snapshot");
      if (timestamps.rows[0]?.conflict) throw new OneCMaterialsImportError("snapshot_conflict");

      const counters = await query<{ created: number; updated: number; unchanged: number }>(
        `with incoming as (${INCOMING_ROWS})
         select count(*) filter (where current.row_key is null)::int as created,
           count(*) filter (where current.row_key is not null and current.payload_hash <> i.payload_hash)::int as updated,
           count(*) filter (where current.payload_hash = i.payload_hash)::int as unchanged
         from incoming i left join "yu_inventory"."one_c_material_inbox" current using (row_key)`,
        [serializedRows],
      );
      const counts = counters.rows[0];
      if (!counts) throw new Error("materials_counters_missing");
      const batchId = randomUUID();
      await query(
        `insert into "yu_inventory"."one_c_material_import_batches"
          (id,request_id,source_filename,source_sha256,source_snapshot_at,received_count,created_count,updated_count,unchanged_count)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [batchId, metadata.requestId, metadata.sourceFilename, metadata.sourceSha256, snapshot.snapshotAt,
          rows.length, counts.created, counts.updated, counts.unchanged],
      );
      await query(
        `with incoming as (${INCOMING_ROWS})
         insert into "yu_inventory"."one_c_material_import_batch_rows" (batch_id,row_key,payload_hash,payload)
           select $2::uuid,row_key,payload_hash,payload from incoming`,
        [serializedRows, batchId],
      );
      await query(
        `with incoming as (${INCOMING_ROWS})
         insert into "yu_inventory"."one_c_material_inbox" as current
           (row_key,material_code,warehouse_key,identity_version,account_key,responsible_key,responsible_code,responsible_external_id,material_external_id,warehouse_external_id,payload_hash,payload,quantity,unit_price,source_snapshot_at,last_batch_id,last_request_id)
           select row_key,material_code,warehouse_key,identity_version,account_key,responsible_key,payload->>'responsibleCode',
             case when identity_version = 2 then (payload->>'responsibleExternalId')::uuid else null end,
             (payload->>'externalId')::uuid,(payload->>'warehouseExternalId')::uuid,payload_hash,payload,quantity,unit_price,$2::timestamptz,$3::uuid,$4::uuid from incoming
         on conflict (row_key) do update set
           payload_hash=excluded.payload_hash,payload=excluded.payload,
           material_external_id=coalesce(excluded.material_external_id,current.material_external_id),
           warehouse_external_id=coalesce(excluded.warehouse_external_id,current.warehouse_external_id),
           responsible_code=excluded.responsible_code,
           responsible_external_id=coalesce(excluded.responsible_external_id,current.responsible_external_id),
           quantity=excluded.quantity,unit_price=excluded.unit_price,
           source_snapshot_at=excluded.source_snapshot_at,last_batch_id=excluded.last_batch_id,
           last_request_id=excluded.last_request_id,last_seen_at=transaction_timestamp(),
           updated_at=case when current.payload_hash <> excluded.payload_hash then transaction_timestamp() else current.updated_at end`,
        [serializedRows, snapshot.snapshotAt, batchId, metadata.requestId],
      );
      await query(
        `with incoming as (${INCOMING_ROWS})
         update "yu_inventory"."one_c_material_inbox" current set superseded_at = transaction_timestamp()
         where $2::boolean and current.identity_version = 1 and current.superseded_at is null and exists (
           select 1 from incoming i where i.identity_version = 2 and i.material_code = current.material_code
             and i.warehouse_key = current.warehouse_key
         )`, [serializedRows, snapshot.replaceLegacyBalances === true],
      );
      await query("commit");
      inTransaction = false;
      return { ...counts, batchId, replayed: false };
    } catch (error) {
      const readTimeout = error instanceof Error && error.message === "Query read timeout";
      // A client read timeout does not guarantee backend cancellation. Destroy that connection.
      if (readTimeout) destroyClient = true;
      if (inTransaction && client && !readTimeout) {
        try { await runQuery(client, "rollback", [], 5_000); }
        catch { destroyClient = true; }
      }
      if (error instanceof OneCMaterialsImportError) throw error;
      const timeout = readTimeout || (typeof error === "object" && error !== null && "code" in error && error.code === "57014");
      throw new OneCMaterialsImportError(timeout ? "import_timeout" : "store_unavailable", { cause: error });
    } finally {
      client?.release(destroyClient);
    }
  }
}

function runQuery<T extends QueryResultRow = QueryResultRow>(client: PoolClient, text: string, values: unknown[], timeoutMs: number) {
  const options: QueryConfig & { query_timeout: number } = { text, values, query_timeout: timeoutMs };
  return client.query<T>(options);
}
