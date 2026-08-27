import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import {
  dockflowStatusMessage,
  highestDockflowStatus,
  isValidDockflowEmail,
  isValidDockflowIin,
  normalizeDockflowEmail,
  normalizeDockflowFullName,
  type DockflowApiKeyMetadata,
  type DockflowAuditSettings,
  type DockflowClearanceStatus,
  type DockflowEmployeeClearance,
  type DockflowEmployeeItem,
  type DockflowItemStatus,
} from "@/lib/contracts/dockflow";
import { getDatabasePool } from "@/lib/db/client";

const TABLES = {
  users: '"yu_inventory"."users"',
  keys: '"yu_inventory"."dockflow_api_keys"',
  keyEvents: '"yu_inventory"."dockflow_api_key_events"',
  logs: '"yu_inventory"."dockflow_request_logs"',
  periods: '"yu_inventory"."responsibility_periods"',
  items: '"yu_inventory"."items"',
  rooms: '"yu_inventory"."rooms"',
  buildings: '"yu_inventory"."buildings"',
  transfers: '"yu_inventory"."tmc_transfer_requests"',
  transferItems: '"yu_inventory"."tmc_transfer_request_items"',
  losses: '"yu_inventory"."asset_loss_cases"',
  settings: '"yu_inventory"."dockflow_integration_settings"',
} as const;

interface ApiKeyRow extends QueryResultRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: Buffer;
  status: "active" | "revoked";
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface EmployeeRow extends QueryResultRow {
  id: string;
  iin: string;
  full_name: string;
  email: string;
}

interface ItemRow extends QueryResultRow {
  id: string;
  name: string;
  inventory_number: string;
  quantity: number;
  condition: string;
  unit_price: string;
  assigned_at: Date;
  building: string;
  room: string;
  loss_status: string | null;
  handover_pending: boolean;
  return_pending: boolean;
}

interface AuditSettingsRow extends QueryResultRow {
  retention_days: number;
  include_key_prefix: boolean;
}

export interface DockflowAuthorization {
  apiKeyId: string | null;
  keyPrefix: string;
}

export class DockflowService {
  async authorize(rawKey: string | null): Promise<DockflowAuthorization | null> {
    if (!rawKey || !rawKey.startsWith("df_live_") || rawKey.length > 256) {
      return null;
    }
    const candidateHash = hashKey(rawKey);
    const result = await getDatabasePool().query<ApiKeyRow>(
      `select id, name, key_prefix, key_hash, status, created_at, last_used_at, revoked_at
         from ${TABLES.keys}
        where status = 'active'
        limit 1`,
    );
    const record = result.rows[0];
    if (record && safeEqual(candidateHash, record.key_hash)) {
      await getDatabasePool().query(
        `update ${TABLES.keys} set last_used_at = now() where id = $1 and status = 'active'`,
        [record.id],
      );
      return { apiKeyId: record.id, keyPrefix: record.key_prefix };
    }

    const environmentKey = process.env.DOCKFLOW_API_KEY?.trim();
    const hasManagedKey = environmentKey
      ? (await getDatabasePool().query(`select 1 from ${TABLES.keys} limit 1`)).rowCount !== 0
      : false;
    if (
      environmentKey &&
      !hasManagedKey &&
      safeEqual(candidateHash, hashKey(environmentKey))
    ) {
      return { apiKeyId: null, keyPrefix: displayPrefix(environmentKey) };
    }
    return null;
  }

  async checkEmployee(input: {
    iin: string;
    fullName: string;
    email: string;
  }): Promise<DockflowEmployeeClearance | null> {
    if (!isValidDockflowIin(input.iin) || !isValidDockflowEmail(input.email)) {
      throw new DockflowValidationError();
    }
    const normalizedName = normalizeDockflowFullName(input.fullName);
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      throw new DockflowValidationError();
    }
    const email = normalizeDockflowEmail(input.email);
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const employeeResult = await client.query<EmployeeRow>(
        `select id, iin, full_name, email
           from ${TABLES.users}
          where iin = $1 and deleted_at is null and is_active = true
          limit 1`,
        [input.iin],
      );
      const employee = employeeResult.rows[0];
      if (
        !employee ||
        normalizeDockflowFullName(employee.full_name) !== normalizedName ||
        normalizeDockflowEmail(employee.email) !== email
      ) {
        await client.query("COMMIT");
        return null;
      }

      const clearance = await readClearanceSnapshot(client, employee);
      await client.query("COMMIT");
      return clearance;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original database error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listKeys(): Promise<DockflowApiKeyMetadata[]> {
    const result = await getDatabasePool().query<ApiKeyRow>(
      `select id, name, key_prefix, key_hash, status, created_at, last_used_at, revoked_at
         from ${TABLES.keys}
        order by created_at desc
        limit 50`,
    );
    return result.rows.map(toKeyMetadata);
  }

  async getAuditSettings(): Promise<DockflowAuditSettings> {
    const result = await getDatabasePool().query<AuditSettingsRow>(
      `select retention_days, include_key_prefix
         from ${TABLES.settings}
        where singleton = true`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dockflow integration settings are missing.");
    return {
      retentionDays: row.retention_days,
      includeKeyPrefix: row.include_key_prefix,
    };
  }

  async updateAuditSettings(
    input: DockflowAuditSettings,
    actorId: string,
  ): Promise<DockflowAuditSettings> {
    if (
      !Number.isInteger(input.retentionDays) ||
      input.retentionDays < 1 ||
      input.retentionDays > 3650 ||
      typeof input.includeKeyPrefix !== "boolean"
    ) {
      throw new DockflowValidationError();
    }
    const result = await getDatabasePool().query<AuditSettingsRow>(
      `update ${TABLES.settings}
          set retention_days = $1, include_key_prefix = $2,
              updated_at = now(), updated_by = $3
        where singleton = true
        returning retention_days, include_key_prefix`,
      [input.retentionDays, input.includeKeyPrefix, actorId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dockflow integration settings are missing.");
    return {
      retentionDays: row.retention_days,
      includeKeyPrefix: row.include_key_prefix,
    };
  }

  async createKey(actorId: string): Promise<{ key: string; metadata: DockflowApiKeyMetadata }> {
    return this.replaceKey(actorId, false);
  }

  async rotateKey(actorId: string): Promise<{ key: string; metadata: DockflowApiKeyMetadata }> {
    return this.replaceKey(actorId, true);
  }

  async revokeActiveKey(actorId: string): Promise<boolean> {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN");
      const active = await client.query<ApiKeyRow>(
        `select id, name, key_prefix, key_hash, status, created_at, last_used_at, revoked_at
           from ${TABLES.keys} where status = 'active' for update`,
      );
      const record = active.rows[0];
      if (!record) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `update ${TABLES.keys}
            set status = 'revoked', revoked_at = now(), revoked_by = $2
          where id = $1`,
        [record.id, actorId],
      );
      await client.query(
        `insert into ${TABLES.keyEvents} (id, api_key_id, action, actor_id)
         values ($1, $2, 'revoked', $3)`,
        [randomUUID(), record.id, actorId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async logRequest(input: {
    requestId: string;
    authorization: DockflowAuthorization | null;
    result: string;
    httpStatus: number;
    durationMs: number;
  }): Promise<void> {
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN");
      const settingsResult = await client.query<AuditSettingsRow>(
        `select retention_days, include_key_prefix
           from ${TABLES.settings}
          where singleton = true`,
      );
      const settings = settingsResult.rows[0];
      if (!settings) throw new Error("Dockflow integration settings are missing.");
      const keyPrefix = input.authorization?.apiKeyId && !settings.include_key_prefix
        ? null
        : input.authorization?.keyPrefix ?? null;
      await client.query(
        `insert into ${TABLES.logs}
          (id, request_id, api_key_id, key_prefix, result, http_status, duration_ms)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.requestId,
          input.authorization?.apiKeyId ?? null,
          keyPrefix,
          input.result,
          input.httpStatus,
          Math.max(0, Math.round(input.durationMs)),
        ],
      );
      await client.query(
        `delete from ${TABLES.logs}
          where occurred_at < now() - make_interval(days => $1::integer)`,
        [settings.retention_days],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async replaceKey(
    actorId: string,
    rotate: boolean,
  ): Promise<{ key: string; metadata: DockflowApiKeyMetadata }> {
    const key = `df_live_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN");
      const active = await client.query<ApiKeyRow>(
        `select id, name, key_prefix, key_hash, status, created_at, last_used_at, revoked_at
           from ${TABLES.keys} where status = 'active' for update`,
      );
      if (!rotate && active.rows[0]) throw new DockflowKeyConflictError();
      if (rotate && active.rows[0]) {
        await client.query(
          `update ${TABLES.keys}
              set status = 'revoked', revoked_at = now(), revoked_by = $2
            where id = $1`,
          [active.rows[0].id, actorId],
        );
      }
      const inserted = await client.query<ApiKeyRow>(
        `insert into ${TABLES.keys}
          (id, name, key_prefix, key_hash, status, created_by)
         values ($1, 'Dockflow', $2, $3, 'active', $4)
         returning id, name, key_prefix, key_hash, status, created_at, last_used_at, revoked_at`,
        [id, displayPrefix(key), hashKey(key), actorId],
      );
      await client.query(
        `insert into ${TABLES.keyEvents} (id, api_key_id, action, actor_id)
         values ($1, $2, $3, $4)`,
        [randomUUID(), id, rotate ? "rotated" : "created", actorId],
      );
      await client.query("COMMIT");
      return { key, metadata: toKeyMetadata(inserted.rows[0]!) };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class DockflowValidationError extends Error {}
export class DockflowKeyConflictError extends Error {}

async function readClearanceSnapshot(
  client: PoolClient,
  employee: EmployeeRow,
): Promise<DockflowEmployeeClearance> {
  const itemResult = await client.query<ItemRow>(
    `select i.id, i.name, i.inventory_number, i.quantity, i.condition,
            i.unit_price::text, rp.started_at as assigned_at,
            b.name as building, r.designation as room,
            loss.status as loss_status,
            exists (
              select 1
                from ${TABLES.transferItems} tri
                join ${TABLES.transfers} tr on tr.id = tri.request_id
                join ${TABLES.users} recipient on recipient.id = tr.recipient_id
               where tri.item_id = i.id
                 and tr.status = 'pending'
                 and tri.result = 'pending'
                 and recipient.role <> 'warehouse'
            ) as handover_pending
            , exists (
              select 1
                from ${TABLES.transferItems} tri
                join ${TABLES.transfers} tr on tr.id = tri.request_id
                join ${TABLES.users} recipient on recipient.id = tr.recipient_id
               where tri.item_id = i.id
                 and tr.status = 'pending'
                 and tri.result = 'pending'
                 and recipient.role = 'warehouse'
            ) as return_pending
       from ${TABLES.periods} rp
       join ${TABLES.items} i on i.id = rp.item_id
       join ${TABLES.rooms} r on r.id = i.room_id
       join ${TABLES.buildings} b on b.id = r.building_id
       left join ${TABLES.losses} loss
         on loss.item_id = i.id and loss.status <> 'closed'
      where rp.responsible_user_id = $1
        and rp.ended_at is null
        and i.status <> 'decommissioned'
      order by rp.started_at, i.id`,
    [employee.id],
  );
  const lossOnlyResult = await client.query<ItemRow>(
    `select i.id, i.name, i.inventory_number, i.quantity, i.condition,
            i.unit_price::text, loss.created_at as assigned_at,
            b.name as building, r.designation as room,
            loss.status as loss_status,
            false as handover_pending,
            false as return_pending
       from ${TABLES.losses} loss
       join ${TABLES.items} i on i.id = loss.item_id
       join ${TABLES.rooms} r on r.id = i.room_id
       join ${TABLES.buildings} b on b.id = r.building_id
      where loss.employee_id = $1
        and loss.status <> 'closed'
        and not exists (
          select 1 from ${TABLES.periods} rp
           where rp.item_id = loss.item_id
             and rp.responsible_user_id = $1
             and rp.ended_at is null
        )
      order by loss.created_at, i.id`,
    [employee.id],
  );

  const activeRows = [...itemResult.rows, ...lossOnlyResult.rows];
  const items = activeRows.map(toClearanceItem);
  const statuses = items.map((item) => clearanceStatusForItem(item.status));
  const clearanceStatus = highestDockflowStatus(statuses);
  const pendingTransfers = items.filter((item) => item.status === "TRANSFER_PENDING").length;
  const pendingReturns = items.filter((item) => item.status === "RETURN_PENDING").length;
  const lostItems = items.filter((item) =>
    item.status === "LOST" || item.status === "PAYMENT_PENDING" || item.status === "RECEIPT_SUBMITTED",
  ).length;
  const pendingAccountingReviews = items.filter(
    (item) => item.status === "RECEIPT_SUBMITTED",
  ).length;
  const totalCents = activeRows.reduce(
    (sum, row) => sum + moneyToCents(row.unit_price) * BigInt(row.quantity),
    BigInt(0),
  );

  return {
    employee: {
      id: employee.id,
      iin: employee.iin,
      fullName: employee.full_name,
      email: employee.email,
    },
    canProceed: clearanceStatus === "CLEAR",
    clearanceStatus,
    message: dockflowStatusMessage(clearanceStatus),
    summary: {
      activeItems: items.length,
      pendingTransfers,
      pendingReturns,
      lostItems,
      pendingAccountingReviews,
      totalAmount: centsToMoney(totalCents),
      currency: "KZT",
    },
    items,
  };
}

function toClearanceItem(row: ItemRow): DockflowEmployeeItem {
  const status = row.loss_status === "accounting_review"
    ? "RECEIPT_SUBMITTED"
    : row.loss_status === "payment_pending" || row.loss_status === "rejected"
      ? "PAYMENT_PENDING"
      : row.return_pending
        ? "RETURN_PENDING"
      : row.handover_pending
        ? "TRANSFER_PENDING"
        : "ASSIGNED";
  return {
    id: row.id,
    name: row.name,
    inventoryNumber: row.inventory_number,
    quantity: row.quantity,
    condition: row.condition,
    unitPrice: centsToMoney(moneyToCents(row.unit_price)),
    assignedAt: row.assigned_at.toISOString(),
    status,
    location: { building: row.building, room: row.room },
  };
}

function clearanceStatusForItem(status: DockflowItemStatus): DockflowClearanceStatus {
  return {
    ASSIGNED: "ASSETS_ASSIGNED",
    TRANSFER_PENDING: "HANDOVER_IN_PROGRESS",
    RETURN_PENDING: "RETURN_IN_PROGRESS",
    LOST: "LOSS_PAYMENT_PENDING",
    PAYMENT_PENDING: "LOSS_PAYMENT_PENDING",
    RECEIPT_SUBMITTED: "ACCOUNTING_REVIEW_PENDING",
    ACCOUNTING_VERIFIED: "CLEAR",
  }[status] as DockflowClearanceStatus;
}

function hashKey(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeEqual(first: Uint8Array, second: Uint8Array): boolean {
  return first.byteLength === second.byteLength && timingSafeEqual(first, second);
}

function displayPrefix(key: string): string {
  return key.slice(0, 16);
}

function moneyToCents(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(`${fraction}00`.slice(0, 2));
}

function centsToMoney(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

function toKeyMetadata(row: ApiKeyRow): DockflowApiKeyMetadata {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original transaction error is more useful to the caller.
  }
}
