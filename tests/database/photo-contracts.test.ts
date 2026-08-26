import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import sharp from "sharp";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresServiceRequestRepositories } from "@/lib/server/persistence/postgres/postgres-service-request-repositories";

let migrationConfig: DatabaseConfig;
let database: Pool;
let uploadedBy: string;

describe("PostgreSQL photo contracts", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 2 });
    uploadedBy = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, 'PHOTO-OWNER', 'photo-owner@example.com', 'Photo Owner',
               'admin', now(), now())`,
      [uploadedBy],
    );
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("enforces the inspection/dispute photo size and pixel envelope", async () => {
    await expect(
      insertPhoto({ byteSize: 10 * 1024 * 1024 + 1 }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_size_check",
    });
    await expect(
      insertPhoto({ width: 8193, height: 1 }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_dimensions_check",
    });
    await expect(
      insertPhoto({ width: 5000, height: 4001 }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_dimensions_check",
    });

    const validId = await insertPhoto({
      byteSize: 10 * 1024 * 1024,
      width: 8192,
      height: 1,
    });
    await expect(
      database.query(
        `select byte_size, width, height from "yu_inventory"."photos" where id = $1`,
        [validId],
      ),
    ).resolves.toMatchObject({
      rows: [{ byte_size: 10 * 1024 * 1024, width: 8192, height: 1 }],
    });
  });

  it("requires object keys and attached preview metadata", async () => {
    await expect(
      insertPhoto({ originalObjectKey: " " }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_object_keys_check",
    });

    const { itemId } = await seedItem();
    await expect(
      insertPhoto({
        purpose: "item",
        status: "attached",
        itemId,
        previewObjectKey: null,
        byteSize: 1,
        width: 1,
        height: 1,
        checksumSha256: "a".repeat(64),
        binaryData: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_attached_metadata_check",
    });

    const attachedId = await insertPhoto({
      purpose: "item",
      status: "attached",
      itemId,
      byteSize: 1,
      width: 1,
      height: 1,
      checksumSha256: "b".repeat(64),
      binaryData: new Uint8Array([1]),
    });
    await expect(
      database.query(
        `select original_object_key, preview_object_key, binary_data
           from "yu_inventory"."photos" where id = $1`,
        [attachedId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          original_object_key: expect.stringMatching(/^database:\/\//),
          preview_object_key: expect.stringMatching(/^database:\/\//),
          binary_data: expect.anything(),
        },
      ],
    });
  });

  it("enforces attached, superseded, and removed lifecycle transitions", async () => {
    const { itemId } = await seedItem();
    const attachedAt = new Date("2026-08-26T00:10:00.000Z");
    const supersededAt = new Date("2026-08-26T00:20:00.000Z");
    const removedAt = new Date("2026-08-26T00:30:00.000Z");
    const purgedAt = new Date("2026-08-26T00:40:00.000Z");

    const supersededId = await insertPhoto({
      purpose: "item",
      checksumSha256: "d".repeat(64),
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'reserved' where id = $1`,
        [supersededId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'superseded' where id = $1`,
        [supersededId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_transition",
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'attached', item_id = $2, attached_at = $3
          where id = $1`,
        [supersededId, itemId, attachedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'superseded', superseded_at = $2
          where id = $1`,
        [supersededId, supersededAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `select status, attached_at, superseded_at, removed_at
           from "yu_inventory"."photos" where id = $1`,
        [supersededId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "superseded",
          attached_at: attachedAt,
          superseded_at: supersededAt,
          removed_at: null,
        },
      ],
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'attached' where id = $1`,
        [supersededId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_transition",
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'purged', binary_deleted_at = $2
          where id = $1`,
        [supersededId, purgedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    const removedId = await insertPhoto({
      purpose: "item",
      checksumSha256: "e".repeat(64),
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'attached', item_id = $2, attached_at = $3
          where id = $1`,
        [removedId, itemId, attachedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'removed', removed_at = $2
          where id = $1`,
        [removedId, removedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'reserved' where id = $1`,
        [removedId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_transition",
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'purged', binary_deleted_at = $2
          where id = $1`,
        [removedId, purgedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    const expiredId = await insertPhoto({ purpose: "inspection_result" });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'expired' where id = $1`,
        [expiredId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'expired' where id = $1`,
        [expiredId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'purged' where id = $1`,
        [expiredId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_transition",
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'attached', item_id = $2, attached_at = $3
          where id = $1`,
        [expiredId, itemId, attachedAt],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_transition",
    });

    const attachedOnlyId = await insertPhoto({
      purpose: "item",
      checksumSha256: "6".repeat(64),
    });
    await expect(
      database.query(
        `update "yu_inventory"."photos"
            set status = 'attached', item_id = $2, attached_at = $3
          where id = $1`,
        [attachedOnlyId, itemId, attachedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `update "yu_inventory"."photos" set status = 'purged' where id = $1`,
        [attachedOnlyId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_transition",
    });

    await expect(
      insertPhoto({
        purpose: "item",
        status: "attached",
        itemId,
        attachedAt: null,
        byteSize: 1,
        width: 1,
        height: 1,
        checksumSha256: "f".repeat(64),
        binaryData: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "photos_lifecycle_check",
    });
  });

  it("can reapply the lifecycle migration without duplicate triggers", async () => {
    const migration = await readFile(
      "drizzle/20260826120000_photo_lifecycle_guard.sql",
      "utf8",
    );
    await database.query(migration);
    await database.query(migration);

    await expect(
      database.query(
        `select count(*)::int as trigger_count
           from pg_trigger
          where tgrelid = 'yu_inventory.photos'::regclass
            and tgname = 'photos_lifecycle_transition_guard'`,
      ),
    ).resolves.toMatchObject({ rows: [{ trigger_count: 1 }] });
    await expect(
      database.query(
        `select count(*)::int as function_count
           from pg_proc proc
           join pg_namespace ns on ns.oid = proc.pronamespace
          where ns.nspname = 'yu_inventory'
            and proc.proname = 'guard_photo_lifecycle_transition'`,
      ),
    ).resolves.toMatchObject({ rows: [{ function_count: 1 }] });
  });

  it("persists and reads service-request bytea through the PostgreSQL repository", async () => {
    const { itemId, roomId } = await seedItem();
    const requestId = randomUUID();
    // The service normalizer owns decoding and re-encoding; this repository test
    // deliberately supplies a real normalized JPEG and verifies bytea round-trip.
    const bytes = new Uint8Array(
      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 3,
          background: "white",
        },
      })
        .jpeg()
        .toBuffer(),
    );
    const repository = createPostgresServiceRequestRepositories(database).requests;

    await expect(
      repository.insert({
        id: requestId,
        itemId,
        roomId,
        authorId: uploadedBy,
        type: "damaged",
        description: "Repository photo contract",
        photoBytes: bytes,
        photoWidth: 2,
        photoHeight: 2,
        occurredAt: new Date("2026-08-26T01:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ id: requestId });
    await expect(repository.findPhoto(requestId)).resolves.toEqual({
      bytes,
      mediaType: "image/jpeg",
    });
  });
});

async function insertPhoto(input: {
  id?: string;
  purpose?: string;
  status?: string;
  originalObjectKey?: string;
  previewObjectKey?: string | null;
  trustedMimeType?: string | null;
  byteSize?: number | null;
  width?: number | null;
  height?: number | null;
  checksumSha256?: string | null;
  itemId?: string | null;
  binaryData?: Uint8Array | null;
  attachedAt?: Date | null;
}) {
  const id = input.id ?? randomUUID();
  const reservedAt = new Date("2026-08-26T00:00:00.000Z");
  await database.query(
    `insert into "yu_inventory"."photos"
       (id, purpose, status, uploaded_by, original_object_key,
        preview_object_key, trusted_mime_type, byte_size, width, height,
        checksum_sha256, reserved_at, expires_at, attached_at, item_id,
        binary_data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16)`,
    [
      id,
      input.purpose ?? "inspection_result",
      input.status ?? "reserved",
      uploadedBy,
      input.originalObjectKey ?? `database://photos/${id}`,
      input.previewObjectKey === undefined
        ? `database://photos/${id}/preview.jpg`
        : input.previewObjectKey,
      input.trustedMimeType === undefined ? "image/jpeg" : input.trustedMimeType,
      input.byteSize === undefined ? 1 : input.byteSize,
      input.width === undefined ? 1 : input.width,
      input.height === undefined ? 1 : input.height,
      input.checksumSha256 === undefined ? "c".repeat(64) : input.checksumSha256,
      reservedAt,
      new Date(reservedAt.getTime() + 60 * 60 * 1000),
      input.attachedAt === undefined
        ? input.status === "attached"
          ? reservedAt
          : null
        : input.attachedAt,
      input.itemId ?? null,
      input.binaryData === undefined || input.binaryData === null
        ? null
        : Buffer.from(input.binaryData),
    ],
  );
  return id;
}

async function seedItem() {
  const buildingId = randomUUID();
  const roomId = randomUUID();
  const itemId = randomUUID();
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Photo Building', $2, 'Photo Address', $2, $3, $3)`,
    [buildingId, `photo-building-${buildingId}`, uploadedBy],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Photo Room', $3, 1, $4, $4)`,
    [roomId, buildingId, `photo-room-${roomId}`, uploadedBy],
  );
  await database.query(
    `insert into "yu_inventory"."items"
       (id, name, room_id, inventory_number_kind, inventory_number,
        inventory_number_key, created_by, updated_by)
     values ($1, 'Photo Item', $2, 'official', $3, $4, $5, $5)`,
    [itemId, roomId, `PHOTO-${itemId}`, `photo-item-${itemId}`, uploadedBy],
  );
  return { itemId, roomId };
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const resetPool = createPostgresPool(config, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}
