import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { InventoryLocationService } from "@/lib/application/services/inventory-location-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { ApplicationError } from "@/lib/domain/application-error";
import { createPostgresInventoryLocationRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-location-repositories";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

let migrationConfig: DatabaseConfig;
let database: Pool;
let runtimeDatabase: Pool;
const actor = { userId: randomUUID(), role: "admin" as const };

describe("PostgreSQL room duplicate prevention", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 2 });
    runtimeDatabase = createPostgresPool({
      ...migrationConfig,
      connectionString: migrationConfig.runtimeConnectionString,
      purpose: "runtime",
    }, { max: 4 });
    await database.query(
      `insert into yu_inventory.users (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Room Admin', 'admin', now(), now())`,
      [actor.userId, `RD-${actor.userId.slice(0, 8)}`, `${actor.userId}@example.test`],
    );
  });

  afterAll(async () => {
    await runtimeDatabase?.end();
    await database?.end();
    await closeDatabase();
    if (migrationConfig) await resetSchemas(migrationConfig);
  });

  it("atomically creates one apartment collection when two first apartments arrive together", async () => {
    const service = createService();
    const results = await Promise.all([1,2].map(number => service.createApartment({
      apartment: { microdistrict: "32", house: "12", entrance: "1", number: String(number) }, floorNumber: 0,
    }, actor)));
    expect(new Set(results.map(r=>r.building.id)).size).toBe(1);
    expect(results[0].room.apartment?.microdistrict).toBe("32");
    const rooms = await service.listRooms(results[0].building.id, actor);
    expect(rooms).toHaveLength(2);
    expect(rooms.every(room=>room.floorNumber===0 && room.qrCode && room.apartment)).toBe(true);
    expect((await database.query("select count(*)::int as count from yu_inventory.buildings where name='Квартиры' and status='active'")).rows[0].count).toBe(1);
  });

  it("rejects apartment duplicates across entrance and floor changes, permits different houses, and persists edits", async () => {
    const service = createService();
    const apartment = { microdistrict: "032", house: "012", entrance: "2", number: "01" };
    await expect(service.createApartment({ apartment, floorNumber: 3 }, actor)).rejects.toMatchObject({ publicCode: "room_already_exists" });
    const created = await service.createApartment({ apartment: { ...apartment, house: "13" }, floorNumber: 4 }, actor);
    expect(created.room.apartment).toEqual({ microdistrict: "32", house: "13", entrance: "2", number: "1" });
    const updated = await service.updateRoom(created.room.id, { designation: "ignored", apartment: { ...created.room.apartment!, microdistrict: "11" }, floorNumber: 5, version: created.room.version }, actor);
    expect((await service.findRoom(updated.id, actor)).apartment?.microdistrict).toBe("11");
    expect(updated.designation).toBe("мкр 11, дом 13, кв. 1");
    await expect(service.updateRoom(updated.id, { designation: "ignored", apartment: created.room.apartment, floorNumber: 4, version: 1 }, actor)).rejects.toMatchObject({ publicCode: "version_conflict" });
    await service.archiveRoom(updated.id, updated.version, actor);
    expect((await service.listRooms(created.building.id, actor)).some(r=>r.id===updated.id)).toBe(false);
    await service.createApartment({ apartment: updated.apartment!, floorNumber: 5 }, actor);
  });

  it("rolls back a newly created collection when creating its apartment fails", async () => {
    const service = createService();
    const existing = (await service.listBuildings(actor)).find(b=>b.name==="Квартиры")!;
    // Hide the existing collection only within this transaction to exercise first creation.
    const uow = new PostgresUnitOfWork(() => runtimeDatabase, source => {
      const repositories = createPostgresInventoryLocationRepositories(source);
      const originalList = repositories.locations.listBuildings.bind(repositories.locations);
      repositories.locations.listBuildings = async () => (await originalList()).filter(b=>b.id!==existing.id);
      repositories.locations.insertRoom = async () => { throw new Error("simulated_room_write_failure"); };
      return repositories;
    });
    const failing = new InventoryLocationService(uow, { now: () => new Date() }, { create: randomUUID }, { create: () => randomBytes(16) });
    await expect(failing.createApartment({ apartment: { microdistrict: "1", house: "1", entrance: "1", number: "1" }, floorNumber: 1 }, actor)).rejects.toThrow("simulated_room_write_failure");
    expect((await database.query("select count(*)::int as count from yu_inventory.buildings where name='Квартиры'")).rows[0].count).toBe(1);
  });

  it("serializes duplicate apartment submissions and rejects apartment data on campus buildings", async () => {
    const service = createService();
    const input = { apartment: { microdistrict: "10", house: "9", entrance: "1", number: "9" }, floorNumber: 1 };
    expectOneSuccessAndOneDuplicate(await Promise.allSettled([
      service.createApartment(input, actor), service.createApartment(input, actor),
    ]));
    const campus = await service.createBuilding({ name: randomUUID(), address: "Campus" }, actor);
    await expect(service.createRoom(campus.id, { ...input, designation: "ignored" }, actor)).rejects.toMatchObject({ publicCode: "invalid_apartment_address" });
    const apartments = (await service.listBuildings(actor)).find(b=>b.name==="Квартиры")!;
    await expect(service.createRoom(apartments.id, { designation: "101", floorNumber: 1 }, actor)).rejects.toMatchObject({ publicCode: "invalid_apartment_address" });
  });

  it("rejects malformed apartments and unauthorized actors before writing", async () => {
    const service = createService();
    const input = { apartment: { microdistrict: "32", house: "12", entrance: "", number: "4" }, floorNumber: 1 };
    await expect(service.createApartment(input, actor)).rejects.toMatchObject({ publicCode: "invalid_apartment_address" });
    await expect(service.createApartment({ ...input, apartment: { ...input.apartment, entrance: "1" }, floorNumber: 201 }, actor)).rejects.toMatchObject({ publicCode: "invalid_room_floor" });
    await expect(service.createApartment(input, { ...actor, role: "employee" })).rejects.toMatchObject({ publicCode: "forbidden" });
  });

  it("recognizes an existing cabinet even with an old designation key", async () => {
    const service = createService();
    const building = await service.createBuilding({ name: randomUUID(), address: "Campus" }, actor);
    await database.query(
      `insert into yu_inventory.rooms
         (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
       values ($1, $2, '201 к', 'old-room-key', 2, $3, $3)`,
      [randomUUID(), building.id, actor.userId],
    );
    for (const designation of ["К 201", "K201", "201-K", "  к   201  "]) {
      await expect(service.createRoom(building.id, { designation, floorNumber: 2 }, actor))
        .rejects.toMatchObject({ publicCode: "room_already_exists" });
    }
    const ownRoom = await service.createRoom(building.id, { designation: "К202", floorNumber: 2 }, actor);
    await expect(service.updateRoom(ownRoom.id, {
      designation: "K201", floorNumber: 2, version: ownRoom.version,
    }, actor)).rejects.toMatchObject({ publicCode: "room_already_exists" });
    const updated = await service.updateRoom(ownRoom.id, {
      designation: "202 к", floorNumber: 2, version: ownRoom.version,
    }, actor);
    expect(updated.designation).toBe("202 к");
  });

  it("creates one cabinet when two administrators submit equivalent names together", async () => {
    const building = await createService().createBuilding({ name: randomUUID(), address: "Campus" }, actor);
    const service = createService(twoRequestBarrier());
    const results = await Promise.allSettled([
      service.createRoom(building.id, { designation: "201 К", floorNumber: 2 }, actor),
      service.createRoom(building.id, { designation: "k 201", floorNumber: 2 }, actor),
    ]);
    expectOneSuccessAndOneDuplicate(results);
    const counts = await database.query(
      `select
         (select count(*)::int from yu_inventory.rooms where building_id = $1) as rooms,
         (select count(*)::int from yu_inventory.qr_identifiers where room_id in
           (select id from yu_inventory.rooms where building_id = $1)) as qr,
         (select count(*)::int from yu_inventory.audit_records
           where action = 'room.created' and after_values->>'buildingId' = $1::text) as audits`,
      [building.id],
    );
    expect(counts.rows[0]).toEqual({ rooms: 1, qr: 1, audits: 1 });
  });

  it("serializes a room creation against a rename to the same cabinet", async () => {
    const setupService = createService();
    const building = await setupService.createBuilding({ name: randomUUID(), address: "Campus" }, actor);
    const ownRoom = await setupService.createRoom(building.id, { designation: "K202", floorNumber: 2 }, actor);
    const service = createService(twoRequestBarrier());
    const results = await Promise.allSettled([
      service.createRoom(building.id, { designation: "201 К", floorNumber: 2 }, actor),
      service.updateRoom(ownRoom.id, { designation: "k 201", floorNumber: 2, version: ownRoom.version }, actor),
    ]);
    expectOneSuccessAndOneDuplicate(results);
    const rooms = await database.query(
      `select id from yu_inventory.rooms
       where building_id = $1 and designation_key = '201k' and status = 'active'`,
      [building.id],
    );
    expect(rooms.rows).toHaveLength(1);
  });
});

function createService(beforeBuildingLock?: () => Promise<void>) {
  const unitOfWork = new PostgresUnitOfWork(() => runtimeDatabase, (source) => {
    const repositories = createPostgresInventoryLocationRepositories(source);
    if (beforeBuildingLock) {
      const lock = repositories.locations.findBuildingByIdForUpdate.bind(repositories.locations);
      repositories.locations.findBuildingByIdForUpdate = async (id) => {
        await beforeBuildingLock();
        return lock(id);
      };
    }
    return repositories;
  });
  return new InventoryLocationService(
    unitOfWork,
    { now: () => new Date() },
    { create: randomUUID },
    { create: () => randomBytes(16) },
  );
}

function twoRequestBarrier() {
  let arrived = 0;
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === 2) release();
    await ready;
  };
}

function expectOneSuccessAndOneDuplicate(results: PromiseSettledResult<unknown>[]) {
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const failures = results.filter((result) => result.status === "rejected");
  expect(failures).toHaveLength(1);
  expect(failures[0]?.reason).toBeInstanceOf(ApplicationError);
  expect(failures[0]?.reason.publicCode).toBe("room_already_exists");
}

async function resetSchemas(config: DatabaseConfig) {
  if (config.target !== "test" || !config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database outside the test environment.");
  }
  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await pool.end();
  }
}
