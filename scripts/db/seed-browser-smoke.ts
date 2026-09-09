import { randomBytes, scrypt } from "node:crypto";

import pg from "pg";

import { loadTargetEnvironment } from "@/lib/db/cli";
import { readDatabaseConfig } from "@/lib/db/env";

const PASSWORD = "Browser-smoke-Only-42!";

const fixture = {
  adminId: "10000000-0000-4000-8000-000000000001",
  ownerId: "10000000-0000-4000-8000-000000000002",
  recipientId: "10000000-0000-4000-8000-000000000003",
  buildingId: "10000000-0000-4000-8000-000000000004",
  roomId: "10000000-0000-4000-8000-000000000005",
  itemId: "10000000-0000-4000-8000-000000000006",
  periodId: "10000000-0000-4000-8000-000000000007",
  adminEmail: "browser-smoke-admin@example.invalid",
  ownerEmail: "browser-smoke-owner@example.invalid",
  recipientEmail: "browser-smoke-recipient@example.invalid",
  inventoryNumber: "E2E-SMOKE-001",
} as const;

async function main() {
  loadTargetEnvironment("test");
  const config = readDatabaseConfig({ purpose: "migration", target: "test" });
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to seed a non-test browser-smoke database.");
  }

  const client = new pg.Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query("begin");
    const users = [
      [fixture.adminId, "E2E-ADMIN", fixture.adminEmail, "Browser Smoke Administrator", "admin"],
      [fixture.ownerId, "E2E-OWNER", fixture.ownerEmail, "Browser Smoke Owner", "employee"],
      [fixture.recipientId, "E2E-RECIPIENT", fixture.recipientEmail, "Browser Smoke Recipient", "employee"],
    ] as const;
    for (const [id, code, email, name, role] of users) {
      await client.query(
        `insert into "yu_inventory"."users"
           (id, code, email, full_name, role, email_verified, is_active, version, created_at, updated_at)
         values ($1, $2, $3, $4, $5, true, true, 1, now(), now())`,
        [id, code, email, name, role],
      );
      const credential = await passwordCredential(PASSWORD);
      await client.query(
        `insert into "yu_inventory"."user_password_credentials"
           (user_id, salt, hash, scrypt_n, scrypt_r, scrypt_p, key_length, updated_at)
         values ($1, $2, $3, 16384, 8, 5, 64, now())`,
        [id, credential.salt, credential.hash],
      );
    }
    await client.query(
      `update "yu_inventory"."auth_bootstrap"
       set completed_at = now(), first_admin_user_id = $1
       where singleton = true`,
      [fixture.adminId],
    );
    await client.query(
      `insert into "yu_inventory"."buildings"
         (id, name, name_key, address, address_key, created_by, updated_by)
       values ($1, 'Browser Smoke Building', 'browser smoke building',
         'Browser Smoke Address', 'browser smoke address', $2, $2)`,
      [fixture.buildingId, fixture.adminId],
    );
    await client.query(
      `insert into "yu_inventory"."rooms"
         (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
       values ($1, $2, 'E2E-101', 'e2e-101', 1, $3, $3)`,
      [fixture.roomId, fixture.buildingId, fixture.adminId],
    );
    await client.query(
      `insert into "yu_inventory"."items"
         (id, name, item_type, quantity, unit_price, room_id, inventory_number_kind,
          inventory_number, inventory_number_key, status, condition, connection_status,
          created_by, updated_by)
       values ($1, 'Browser Smoke Laptop', 'electronics', 1, 1000, $2, 'official',
         $3, $4, 'active', 'good', 'not_applicable', $5, $5)`,
      [
        fixture.itemId,
        fixture.roomId,
        fixture.inventoryNumber,
        fixture.inventoryNumber.toLocaleLowerCase("ru-RU"),
        fixture.adminId,
      ],
    );
    await client.query(
      `insert into "yu_inventory"."responsibility_periods"
         (id, item_id, responsible_user_id, source, started_by)
       values ($1, $2, $3, 'migration', $4)`,
      [fixture.periodId, fixture.itemId, fixture.ownerId, fixture.adminId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    adminEmail: fixture.adminEmail,
    ownerEmail: fixture.ownerEmail,
    recipientEmail: fixture.recipientEmail,
    inventoryNumber: fixture.inventoryNumber,
  }));
}

async function passwordCredential(password: string) {
  const rawSalt = randomBytes(24).toString("hex");
  const salt = `scrypt$16384$8$5$${rawSalt}`;
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, rawSalt, 64, {
      N: 16_384,
      r: 8,
      p: 5,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return { salt, hash: hash.toString("hex") };
}

main().catch((error: unknown) => {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.error(`Browser-smoke fixture failed (code: ${code}).`);
  process.exitCode = 1;
});
