import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { items, users } from "@/lib/data";
import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { DatabaseOperationError, readDatabaseConfig } from "@/lib/db/env";
import { assertDatabaseMigrationHistory, readLocalMigrationManifest } from "@/lib/db/migration-manifest";
import { createPostgresPool } from "@/lib/db/pool";
import { assertSchemaContract } from "@/lib/db/schema-contract";
import { parseQrIdentifierInput } from "@/lib/domain/qr-identifier";
import {
  cleanLegacyValue,
  legacyFloor,
  legacyInventoryNumber,
  legacyKey,
  legacyQrKey,
  usableLegacyQr,
} from "@/lib/server/seed/legacy-normalization";

const SCHEMA = '"yu_inventory"';
const SEED_YEAR = 2026;

async function main() {
  const target = parseTargetArgument(process.argv.slice(2));
  if (target === "production") {
    throw new DatabaseOperationError(
      "Refusing to seed production. Seed data is for development and test only.",
    );
  }
  loadTargetEnvironment(target);
  const config = readDatabaseConfig({ purpose: "migration", target });
  const pool = createPostgresPool(config, { max: 1 });
  try {
    const manifest = readLocalMigrationManifest();
    await assertDatabaseMigrationHistory(pool, manifest, { allowPending: false });
    await assertSchemaContract(pool, config, manifest, { allowMissing: false, allowStale: false });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('yu_inventory.seed.v1'))");
      const actor = seedId("user:1");
      await seedUsers(client);
      await seedLocationsAndItems(client, actor);
      await client.query(
        `update ${SCHEMA}."auth_bootstrap"
         set completed_at = coalesce(completed_at, now()), first_admin_user_id = coalesce(first_admin_user_id, $1)
         where singleton = true`, [actor],
      );
      await client.query("commit");
      console.log(`Seeded ${users.length + 1} users and ${items.length} legacy inventory items.`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function seedUsers(client: Pick<PoolClient, "query">) {
  const seededUsers = [...users, {
    id: "seed-owner", code: "USR-SEED-OWNER", fullName: "Seed System Owner",
    email: "seed-owner@inventory.local", phone: "—", role: "owner" as const,
    emailVerified: true, active: true,
  }];
  for (const user of seededUsers) {
    const id = user.id === "seed-owner" ? seedId("user:owner") : seedId(`user:${user.id}`);
    await client.query(
      `insert into ${SCHEMA}."users" (id, code, email, full_name, role, phone, email_verified, is_active, created_at, updated_at)
       values ($1, $2, $3, $4, $5, nullif($6, '—'), $7, true, now(), now())
       on conflict (id) do nothing`,
      [id, user.code, user.email.trim().toLowerCase(), user.fullName, user.role, user.phone, user.emailVerified],
    );
  }
}

async function seedLocationsAndItems(
  client: Pick<PoolClient, "query">,
  actorId: string,
) {
  const rooms = new Map<string, { building: string; room: string; id: string; buildingId: string }>();
  const inventoryKeys = new Set<string>();
  const qrKeys = new Set<string>();
  for (const [index, legacy] of items.entries()) {
    const [buildingRaw, ...roomParts] = legacy.location.split("/").map((part) => part.trim());
    const roomRaw = roomParts.join(" / ");
    const building = buildingRaw || "Не указано";
    const room = roomRaw || "Не указано";
    const locationKey = `${legacyKey(building)}|${legacyKey(room)}`;
    let location = rooms.get(locationKey);
    if (!location) {
      const buildingId = seedId(`building:${legacyKey(building)}`);
      const roomId = seedId(`room:${locationKey}`);
      await client.query(
        `insert into ${SCHEMA}."buildings" (id, name, name_key, address, address_key, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $6)
         on conflict (id) do nothing`,
        [buildingId, limit(building, 120), legacyKey(building), `Legacy location: ${building}`, legacyKey(`Legacy location: ${building}`), actorId],
      );
      await client.query(
        `insert into ${SCHEMA}."rooms" (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $6)
         on conflict (id) do nothing`,
        [roomId, buildingId, limit(room, 80), legacyKey(room), legacyFloor(room), actorId],
      );
      await client.query(
        `insert into ${SCHEMA}."audit_records"
           (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
            subject_revision, action, after_values, metadata)
         values ($1, $2, 'admin', 'building', $3, 1, 'migration.seeded', $4, $5)
         on conflict (id) do nothing`,
        [
          seedId(`audit:building:${legacyKey(building)}`),
          actorId,
          buildingId,
          { name: building, source: "lib/data.ts" },
          { seedVersion: 1 },
        ],
      );
      await client.query(
        `insert into ${SCHEMA}."audit_records"
           (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
            subject_revision, action, after_values, metadata)
         values ($1, $2, 'admin', 'room', $3, 1, 'migration.seeded', $4, $5)
         on conflict (id) do nothing`,
        [
          seedId(`audit:room:${locationKey}`),
          actorId,
          roomId,
          { designation: room, floorNumber: legacyFloor(room) },
          { seedVersion: 1 },
        ],
      );
      location = { building, room, id: roomId, buildingId };
      rooms.set(locationKey, location);
    }
    const normalizedNumber = legacyInventoryNumber(legacy.inventoryNumber, index, inventoryKeys, SEED_YEAR);
    const { kind, value: number } = normalizedNumber;
    inventoryKeys.add(legacyKey(number));
    const itemId = seedId(`item:${legacy.id}`);
    await client.query(
      `insert into ${SCHEMA}."items" (id, name, description, room_id, inventory_number_kind, inventory_number, inventory_number_key, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       on conflict (id) do nothing`,
      [itemId, limit(legacy.name, 160), cleanLegacyValue(legacy.brandModel) || null, location.id, kind, limit(number, 64), legacyKey(number), actorId],
    );
    await client.query(
      `insert into ${SCHEMA}."item_inventory_number_history" (id, item_id, kind, value, comparison_key, assigned_by)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [seedId(`number:${legacy.id}`), itemId, kind, limit(number, 64), legacyKey(number), actorId],
    );
    await client.query(
      `insert into ${SCHEMA}."audit_records" (id, actor_id, actor_role_snapshot, subject_kind, subject_id, subject_revision, action, after_values, metadata)
       values ($1, $2, 'admin', 'item', $3, 1, 'migration.seeded', $4, $5) on conflict (id) do nothing`,
      [seedId(`audit:item:${legacy.id}`), actorId, itemId, { inventoryNumber: number, legacyId: legacy.id }, { source: "lib/data.ts", seedVersion: 1 }],
    );
    const qr = usableLegacyQr(legacy.qrCode);
    if (qr && !qrKeys.has(legacyQrKey(qr))) {
      const parsedQr = parseQrIdentifierInput(qr);
      if (!parsedQr.ok || parsedQr.format === "generated_v1") {
        throw new Error("Usable legacy QR normalization returned invalid data.");
      }
      qrKeys.add(parsedQr.canonicalKey);
      await client.query(
        `insert into ${SCHEMA}."qr_identifiers" (id, original_value, canonical_key, format, target_kind, role, item_id, created_by)
         values ($1, $2, $3, $4, 'item', 'primary', $5, $6) on conflict (id) do nothing`,
        [
          seedId(`qr:${legacy.id}`),
          parsedQr.originalValue,
          parsedQr.canonicalKey,
          parsedQr.format,
          itemId,
          actorId,
        ],
      );
      await client.query(
        `insert into ${SCHEMA}."audit_records"
           (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
            subject_revision, action, after_values, metadata)
         values ($1, $2, 'admin', 'qr_identifier', $3, 1, 'migration.seeded', $4, $5)
         on conflict (id) do nothing`,
        [
          seedId(`audit:qr:${legacy.id}`),
          actorId,
          seedId(`qr:${legacy.id}`),
          { originalValue: qr, targetKind: "item", itemId },
          { seedVersion: 1 },
        ],
      );
    }
  }
}

function limit(value: string, size: number) { return value.slice(0, size); }
function seedId(value: string) { const hash = createHash("sha256").update(`yu-inventory-seed:${value}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`; }

main().catch((error: unknown) => { console.error(formatDatabaseCommandError(error)); process.exitCode = 1; });
