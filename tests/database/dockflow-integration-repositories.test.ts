import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { closeDatabase, getDatabasePool } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { AssetLossService } from "@/lib/server/asset-loss-service";
import { DockflowService } from "@/lib/server/dockflow-service";

let migrationConfig: DatabaseConfig;
let adminId: string;
let employeeId: string;
let itemId: string;

const dockflow = new DockflowService();
const losses = new AssetLossService();

describe("Dockflow PostgreSQL integration", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    await seedClearanceFixture();
  });

  afterAll(async () => {
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("stores only the key digest and revokes rotations immediately", async () => {
    const firstKey = `df_live_${"a".repeat(43)}`;
    const first = await dockflow.registerKeyHash(adminId, keyRegistration(firstKey));
    await expect(dockflow.authorize(firstKey)).resolves.toMatchObject({
      apiKeyId: first.id,
    });
    const persisted = await getDatabasePool().query<{
      key_hash: Buffer;
    }>(
      `select key_hash from "yu_inventory"."dockflow_api_keys" where id = $1`,
      [first.id],
    );
    expect(persisted.rows[0]!.key_hash).toHaveLength(32);
    expect(persisted.rows[0]!.key_hash.equals(Buffer.from(firstKey))).toBe(false);

    const secondKey = `df_live_${"b".repeat(43)}`;
    const second = await dockflow.registerKeyHash(adminId, keyRegistration(secondKey));
    await expect(dockflow.authorize(firstKey)).resolves.toBeNull();
    const authorization = await dockflow.authorize(secondKey);
    expect(authorization).toMatchObject({
      apiKeyId: second.id,
    });
    await expect(dockflow.getAuditSettings()).resolves.toEqual({
      retentionDays: 90,
      includeKeyPrefix: true,
    });
    await expect(dockflow.updateAuditSettings(
      { retentionDays: 30, includeKeyPrefix: false },
      adminId,
    )).resolves.toEqual({ retentionDays: 30, includeKeyPrefix: false });
    const expiredRequestId = randomUUID();
    await getDatabasePool().query(
      `insert into "yu_inventory"."dockflow_request_logs"
        (id, request_id, result, http_status, duration_ms, occurred_at)
       values ($1, $2, 'CLEAR', 200, 1, now() - interval '31 days')`,
      [randomUUID(), expiredRequestId],
    );
    const requestId = randomUUID();
    await dockflow.logRequest({
      requestId,
      authorization,
      result: "CLEAR",
      httpStatus: 200,
      durationMs: 5,
    });
    const logs = await getDatabasePool().query<{
      request_id: string;
      key_prefix: string | null;
    }>(
      `select request_id, key_prefix
         from "yu_inventory"."dockflow_request_logs"
        where request_id in ($1, $2)`,
      [expiredRequestId, requestId],
    );
    expect(logs.rows).toEqual([{ request_id: requestId, key_prefix: null }]);
    await expect(dockflow.revokeActiveKey(adminId)).resolves.toBe(true);
    await expect(dockflow.authorize(secondKey)).resolves.toBeNull();
  });

  it("moves clearance from assigned through loss review to clear", async () => {
    const identity = {
      iin: "900101300123",
      fullName: "  Employee   Example ",
      email: "EMPLOYEE@EXAMPLE.TEST",
    };
    await expect(dockflow.checkEmployee(identity)).resolves.toMatchObject({
      canProceed: false,
      clearanceStatus: "ASSETS_ASSIGNED",
      summary: { activeItems: 1, totalAmount: "350000.00" },
      items: [{ status: "ASSIGNED" }],
    });
    await expect(dockflow.checkEmployee({ ...identity, email: "other@example.test" })).resolves.toBeNull();

    const created = await losses.create(
      { itemId },
      { userId: employeeId, role: "employee", sessionVersion: 1 },
    );
    expect(created.status).toBe("payment_pending");
    await expect(dockflow.checkEmployee(identity)).resolves.toMatchObject({
      clearanceStatus: "LOSS_PAYMENT_PENDING",
      canProceed: false,
      items: [{ status: "PAYMENT_PENDING" }],
    });

    const submitted = await losses.submitReceipt(
      created.id,
      { bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1, mediaType: "image/jpeg" },
      { userId: employeeId, role: "employee", sessionVersion: 1 },
    );
    expect(submitted.status).toBe("accounting_review");
    await expect(losses.getReceipt(
      created.id,
      { userId: adminId, role: "admin", sessionVersion: 1 },
    )).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/jpeg",
    });
    await expect(dockflow.checkEmployee(identity)).resolves.toMatchObject({
      clearanceStatus: "ACCOUNTING_REVIEW_PENDING",
      canProceed: false,
      items: [{ status: "RECEIPT_SUBMITTED" }],
    });

    const reviewed = await losses.review(
      created.id,
      { decision: "approved", comment: "Payment verified" },
      { userId: adminId, role: "admin", sessionVersion: 1 },
    );
    expect(reviewed.status).toBe("closed");
    await expect(dockflow.checkEmployee(identity)).resolves.toMatchObject({
      clearanceStatus: "CLEAR",
      canProceed: true,
      items: [],
    });
  });
});

function keyRegistration(key: string) {
  return {
    keyHashSha256: createHash("sha256").update(key, "utf8").digest("hex"),
    keyPrefix: key.slice(0, 16),
  };
}

async function seedClearanceFixture() {
  const pool = getDatabasePool();
  adminId = randomUUID();
  employeeId = randomUUID();
  const buildingId = randomUUID();
  const roomId = randomUUID();
  itemId = randomUUID();
  const periodId = randomUUID();
  const now = new Date("2026-08-27T08:00:00.000Z");
  await pool.query(
    `insert into "yu_inventory"."users"
      (id, code, email, full_name, iin, role, email_verified, is_active, created_at, updated_at)
     values
      ($1, 'USR-ADMIN', 'admin@example.test', 'Admin Example', '800101300123', 'admin', true, true, $3, $3),
      ($2, 'USR-EMPLOYEE', 'employee@example.test', 'Employee Example', '900101300123', 'employee', true, true, $3, $3)`,
    [adminId, employeeId, now],
  );
  await pool.query(
    `insert into "yu_inventory"."buildings"
      (id, name, name_key, address, address_key, created_by, updated_by, created_at, updated_at)
     values ($1, 'Main building', 'main building', '1 University St', '1 university st', $2, $2, $3, $3)`,
    [buildingId, adminId, now],
  );
  await pool.query(
    `insert into "yu_inventory"."rooms"
      (id, building_id, designation, designation_key, floor_number, created_by, updated_by, created_at, updated_at)
     values ($1, $2, '302', '302', 3, $3, $3, $4, $4)`,
    [roomId, buildingId, adminId, now],
  );
  await pool.query(
    `insert into "yu_inventory"."items"
      (id, name, quantity, unit_price, room_id, inventory_number_kind,
       inventory_number, inventory_number_key, created_by, updated_by, created_at, updated_at)
     values ($1, 'Laptop', 1, 350000, $2, 'official', 'INV-000123', 'INV-000123', $3, $3, $4, $4)`,
    [itemId, roomId, adminId, now],
  );
  await pool.query(
    `insert into "yu_inventory"."responsibility_periods"
      (id, item_id, responsible_user_id, source, started_at, started_by)
     values ($1, $2, $3, 'accepted', $4, $3)`,
    [periodId, itemId, employeeId, now],
  );
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await pool.end();
  }
}
