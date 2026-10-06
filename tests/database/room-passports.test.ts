import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RoomPassportService, type PassportActor } from "@/lib/application/services/room-passport-service";
import { RoomWorkspaceService } from "@/lib/application/services/room-workspace-service";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { createPostgresPassportRepositories } from "@/lib/server/persistence/postgres/postgres-room-passport-repository";
import { createPostgresRoomWorkspaceRepositories } from "@/lib/server/persistence/postgres/postgres-room-workspace-repositories";
import { createPostgresTmcOperationRepositories } from "@/lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import { passportPdf } from "../support/passport-pdf";
import { ApplicationError } from "@/lib/domain/application-error";
import { validatePassportPdf } from "@/lib/server/pdf/validate-passport";

let config: DatabaseConfig;
let database: Pool;
let runtime: Pool;
const roles = ["admin", "passport_author", "passport_author", "passport_reviewer", "passport_reviewer", "employee", "warehouse", "typography"] as const;
const actors: PassportActor[] = roles.map(role => ({ userId: randomUUID(), role, sessionVersion: 1 }));
const [admin, author, colleague, reviewer, otherReviewer, employee, warehouse, typography] = actors;

describe("room passports in PostgreSQL", () => {
  beforeAll(async () => {
    config = readDatabaseConfig({ purpose: "migration", target: "test" });
    await reset(); await migrateDatabase(config);
    database = createPostgresPool(config, { max: 3 });
    runtime = createPostgresPool({ ...config, connectionString: config.runtimeConnectionString, purpose: "runtime" }, { max: 8 });
    for (const actor of actors) await database.query(`insert into yu_inventory.users (id,code,email,full_name,role,created_at,updated_at) values ($1,$2,$3,$4,$5,now(),now())`, [actor.userId, actor.userId.slice(0, 32), `${actor.userId}@example.test`, actor.role, actor.role]);
    const inactiveId = randomUUID();
    await database.query(`insert into yu_inventory.users (id,code,email,full_name,role,is_active,deactivated_at,created_at,updated_at) values ($1,$2,$3,'Inactive reviewer','passport_reviewer',false,now(),now(),now())`, [inactiveId, inactiveId.slice(0, 32), `${inactiveId}@example.test`]);
  });
  afterAll(async () => { await runtime?.end(); await database?.end(); if (config) await reset(); });

  it("includes empty rooms for passport roles and keeps employee room restrictions", async () => {
    const roomId = await room("closed");
    for (const actor of [author, reviewer, admin]) expect((await service().list(actor)).find(row => row.roomId === roomId)).toMatchObject({ status: "not_started", version: 0, file: null });
    for (const actor of [employee, warehouse, typography]) await expect(service().list(actor)).rejects.toMatchObject({ kind: "forbidden" });
    const workspace = new RoomWorkspaceService(new PostgresUnitOfWork(() => runtime, createPostgresRoomWorkspaceRepositories));
    expect(await workspace.findById(roomId, author)).toEqual({ access: "denied", items: [] });
  });

  it("publishes only approval and immediately revokes published and replaced URLs", async () => {
    const roomId = await room(); const app = service();
    let state = await app.mutate(roomId, { action: "start", version: 0 }, author);
    state = await upload(app, roomId, state.version, author);
    const oldId = state.file!.id;
    await expect(app.file(roomId, oldId, employee, true)).rejects.toMatchObject({ kind: "not_found" });
    state = await app.mutate(roomId, { action: "submit", version: state.version }, colleague);
    await expect(app.mutate(roomId, { action: "approve", version: state.version }, author)).rejects.toMatchObject({ kind: "forbidden" });
    state = await app.mutate(roomId, { action: "approve", version: state.version }, reviewer);
    const workspace = new RoomWorkspaceService(new PostgresUnitOfWork(() => runtime, createPostgresRoomWorkspaceRepositories));
    expect(await workspace.findById(roomId, employee)).toMatchObject({ passport: { id: oldId } });
    expect((await app.file(roomId, oldId, employee, true)).bytes).toEqual(Buffer.from(passportPdf()));
    await expect(app.mutate(roomId, { action: "return", version: state.version }, colleague)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(app.mutate(roomId, { action: "return", version: state.version }, author)).rejects.toMatchObject({ publicCode: "passport_rejection_required" });
    expect(await app.find(roomId, author)).toEqual(state);
    state = await app.mutate(roomId, { action: "return", version: state.version, reason: "other", comment: "Sent by mistake" }, author);
    expect(await app.find(roomId, author)).toMatchObject({ status: "in_progress", file: { id: oldId }, rejectionReason: "other", rejectionComment: "Sent by mistake" });
    await expect(app.file(roomId, oldId, reviewer, true)).rejects.toMatchObject({ kind: "not_found" });
    expect(await workspace.findById(roomId, employee)).toMatchObject({ passport: null });
    expect((await app.file(roomId, oldId, reviewer, false)).name).toBe("room.pdf");
    state = await upload(app, roomId, state.version, colleague);
    await expect(app.file(roomId, oldId, reviewer, false)).rejects.toMatchObject({ kind: "not_found" });
    state = await app.mutate(roomId, { action: "submit", version: state.version }, reviewer);
    state = await app.mutate(roomId, { action: "approve", version: state.version }, reviewer);
    const currentId = state.file!.id;
    state = await app.mutate(roomId, { action: "delete", version: state.version }, colleague);
    expect(state).toMatchObject({ status: "not_started", file: null, uploadedBy: null });
    await expect(app.file(roomId, currentId, employee, true)).rejects.toMatchObject({ kind: "not_found" });
    await expect(app.file(roomId, currentId, reviewer, false)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("notifies active reviewers and the current sender, with no duplicates on retries", async () => {
    const roomId = await room(); const app = service();
    let state = await app.mutate(roomId, { action: "start", version: 0 }, author);
    state = await upload(app, roomId, state.version, author);
    const submittedVersion = state.version;
    state = await app.mutate(roomId, { action: "submit", version: submittedVersion }, colleague);
    await expect(app.mutate(roomId, { action: "submit", version: submittedVersion }, colleague)).rejects.toMatchObject({ publicCode: "passport_conflict" });
    state = await app.mutate(roomId, { action: "reject", version: state.version, reason: "other", comment: "Fix room number" }, reviewer);
    const rejectedVersion = state.version;
    await expect(app.mutate(roomId, { action: "submit", version: rejectedVersion }, colleague)).rejects.toMatchObject({ kind: "forbidden" });
    const events = await database.query(`select e.type, d.recipient_id, e.safe_payload from yu_inventory.notification_events e join yu_inventory.notification_deliveries d on d.event_id=e.id where e.subject_id=$1 order by e.type, d.recipient_id`, [roomId]);
    expect(events.rows.filter(event => event.type === "passport.submitted").map(event => event.recipient_id).sort()).toEqual([reviewer.userId, otherReviewer.userId].sort());
    expect(events.rows.filter(event => event.type === "passport.rejected")).toMatchObject([{ recipient_id: colleague.userId, safe_payload: { reason: "other", comment: "Fix room number" } }]);
    const feed = createPostgresTmcOperationRepositories(runtime).stageFour;
    const input = { actorId: colleague.userId, includeAdminQueue: false, now: new Date(Date.now() + 1000), limit: 50 };
    const notifications = await feed.listNotifications(input);
    const rejection = notifications.find(event => event.roomId === roomId)!;
    expect(rejection).toMatchObject({ type: "passport.rejected", requestId: null });
    expect(await feed.markNotificationRead({ notificationId: rejection.id, actorId: author.userId, includeAdminQueue: false, readAt: input.now })).toBe(false);
    expect(await feed.markNotificationRead({ notificationId: rejection.id, actorId: colleague.userId, includeAdminQueue: false, readAt: input.now })).toBe(true);
    await feed.markAllNotificationsRead({ actorId: reviewer.userId, includeAdminQueue: false, readAt: input.now });
    expect(await feed.countUnreadNotifications({ ...input, actorId: reviewer.userId })).toBe(0);
    state = await upload(app, roomId, rejectedVersion, author);
    expect(state.rejectionComment).toBe("Fix room number");
    state = await app.mutate(roomId, { action: "submit", version: state.version }, author);
    await app.mutate(roomId, { action: "approve", version: state.version }, reviewer);
    const approved = await database.query(`select d.recipient_id from yu_inventory.notification_events e join yu_inventory.notification_deliveries d on d.event_id=e.id where e.subject_id=$1 and e.type='passport.approved'`, [roomId]);
    expect(approved.rows).toEqual([{ recipient_id: author.userId }]);
    expect((await app.find(roomId, author)).rejectionComment).toBeNull();
    expect((await database.query(`select count(*)::int as count from yu_inventory.tmc_web_push_outbox o join yu_inventory.notification_events e on e.id=o.notification_event_id where e.subject_id=$1`, [roomId])).rows[0].count).toBe(0);
  });

  it("denies closed room PDF to unassigned staff and allows limited access", async () => {
    const roomId = await room("closed"); const app = service();
    let state = await app.mutate(roomId, { action: "start", version: 0 }, reviewer);
    state = await upload(app, roomId, state.version, reviewer);
    state = await app.mutate(roomId, { action: "submit", version: state.version }, reviewer);
    state = await app.mutate(roomId, { action: "approve", version: state.version }, reviewer);
    await expect(app.file(roomId, state.file!.id, author, true)).rejects.toMatchObject({ kind: "not_found" });
    const itemId = randomUUID();
    await database.query(`insert into yu_inventory.items (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by) values ($1,'Chair',1,10,$2,'official',$3::text,$3::text,$4,$4)`, [itemId, roomId, itemId, admin.userId]);
    await database.query(`insert into yu_inventory.responsibility_periods (id,item_id,responsible_user_id,source,started_at,started_by) values ($1,$2,$3,'transfer',now(),$4)`, [randomUUID(), itemId, author.userId, admin.userId]);
    const workspace = new RoomWorkspaceService(new PostgresUnitOfWork(() => runtime, createPostgresRoomWorkspaceRepositories));
    expect(await workspace.findById(roomId, author)).toMatchObject({ access: "limited", passport: { id: state.file!.id } });
    expect((await app.file(roomId, state.file!.id, author, true)).bytes.byteLength).toBeGreaterThan(0);
  });

  it("serializes first starts, concurrent changes and stale reviews", async () => {
    const roomId = await room(); const app = service();
    const starts = await Promise.allSettled([app.mutate(roomId, { action: "start", version: 0 }, author), app.mutate(roomId, { action: "start", version: 0 }, colleague)]);
    expect(starts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(starts.find(result => result.status === "rejected")).toMatchObject({ reason: { publicCode: "passport_conflict" } });
    let state = await upload(app, roomId, 1, author);
    state = await app.mutate(roomId, { action: "submit", version: state.version }, author);
    const decisions = await Promise.allSettled([app.mutate(roomId, { action: "approve", version: state.version }, reviewer), app.mutate(roomId, { action: "return", version: state.version, reason: "incorrect" }, colleague)]);
    expect(decisions.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(decisions.find(result => result.status === "rejected")).toMatchObject({ reason: { publicCode: "passport_conflict" } });
    const count = await database.query(`select count(*)::int as count from yu_inventory.room_passports where room_id=$1`, [roomId]);
    expect(count.rows[0].count).toBe(1);
  });

  it("preserves the current file on parser failure, DB failure and session revocation", async () => {
    const roomId = await room(); const app = service();
    let state = await app.mutate(roomId, { action: "start", version: 0 }, author);
    state = await upload(app, roomId, state.version, author);
    const failure = new RoomPassportService(new PostgresUnitOfWork(() => runtime, createPostgresPassportRepositories), { create: randomUUID }, { validate: async () => { throw new ApplicationError("validation", "passport_invalid_pdf"); } });
    await expect(upload(failure, roomId, state.version, author)).rejects.toMatchObject({ publicCode: "passport_invalid_pdf" });
    expect(await app.find(roomId, author)).toEqual(state);
    await database.query(`create function yu_inventory.reject_passport_update() returns trigger language plpgsql as $$ begin raise exception 'test save failure'; end $$`);
    await database.query(`create trigger reject_passport_update before update on yu_inventory.room_passports for each row execute function yu_inventory.reject_passport_update()`);
    try { await expect(upload(app, roomId, state.version, author)).rejects.toThrow(); } finally {
      await database.query(`drop trigger reject_passport_update on yu_inventory.room_passports`);
      await database.query(`drop function yu_inventory.reject_passport_update()`);
    }
    expect(await app.find(roomId, author)).toEqual(state);
    await database.query(`update yu_inventory.users set version=version+1 where id=$1`, [colleague.userId]);
    await expect(app.mutate(roomId, { action: "submit", version: state.version }, colleague)).rejects.toMatchObject({ publicCode: "unauthorized" });
  });

  it("allows one concurrent replacement and prevents a parsed upload from restoring a deleted file", async () => {
    const roomId = await room(); const app = service();
    let state = await app.mutate(roomId, { action: "start", version: 0 }, author);
    state = await upload(app, roomId, state.version, author);
    const oldFileId = state.file!.id;
    const replacements = validationBarrier(2);
    const pending = Promise.allSettled([
      upload(replacements.service, roomId, state.version, author),
      upload(replacements.service, roomId, state.version, reviewer),
    ]);
    await replacements.started;
    replacements.release();
    const results = await pending;
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { publicCode: "passport_conflict" } });
    state = await app.find(roomId, author);
    expect(state.version).toBe(3);
    await expect(app.file(roomId, oldFileId, reviewer, false)).rejects.toMatchObject({ kind: "not_found" });

    const deletion = validationBarrier(1);
    const delayedUpload = Promise.allSettled([upload(deletion.service, roomId, state.version, author)]);
    await deletion.started;
    const deleted = await app.mutate(roomId, { action: "delete", version: state.version }, author);
    deletion.release();
    expect(await delayedUpload).toMatchObject([{ status: "rejected", reason: { publicCode: "passport_conflict" } }]);
    expect(await app.find(roomId, author)).toEqual(deleted);
    expect(deleted.file).toBeNull();
  });

  it("rejects a stale review after withdrawal, replacement and resubmission", async () => {
    const roomId = await room(); const app = service();
    let state = await app.mutate(roomId, { action: "start", version: 0 }, reviewer);
    state = await upload(app, roomId, state.version, author);
    state = await app.mutate(roomId, { action: "submit", version: state.version }, author);
    const staleVersion = state.version;
    state = await app.mutate(roomId, { action: "return", version: state.version, reason: "incorrect" }, reviewer);
    state = await upload(app, roomId, state.version, author);
    state = await app.mutate(roomId, { action: "submit", version: state.version }, reviewer);
    await expect(app.mutate(roomId, { action: "approve", version: staleVersion }, reviewer)).rejects.toMatchObject({ publicCode: "passport_conflict" });
    expect(await app.find(roomId, reviewer)).toEqual(state);
    expect(state.status).toBe("in_review");
  });

  it("stores a real parsed PDF and preserves it when a later page is damaged", async () => {
    const roomId = await room();
    const app = new RoomPassportService(new PostgresUnitOfWork(() => runtime, createPostgresPassportRepositories), { create: randomUUID }, { validate: validatePassportPdf });
    let state = await app.mutate(roomId, { action: "start", version: 0 }, author);
    const bytes = passportPdf({ pages: 3 });
    state = await app.mutate(roomId, { action: "upload", version: state.version }, author, { bytes, name: "three-pages.pdf" });
    await expect(app.mutate(roomId, { action: "upload", version: state.version }, author, { bytes: passportPdf({ pages: 3, damagedPage: 3 }), name: "damaged.pdf" })).rejects.toMatchObject({ publicCode: "passport_invalid_pdf" });
    expect(await app.find(roomId, author)).toEqual(state);
    expect((await app.file(roomId, state.file!.id, reviewer, false)).bytes).toEqual(Buffer.from(bytes));
  });
});

function validationBarrier(expected: number) {
  let signalStarted!: () => void;
  let release!: () => void;
  let calls = 0;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const app = new RoomPassportService(new PostgresUnitOfWork(() => runtime, createPostgresPassportRepositories), { create: randomUUID }, {
    validate: async () => { if (++calls === expected) signalStarted(); await released; },
  });
  return { service: app, started, release };
}

function service() { return new RoomPassportService(new PostgresUnitOfWork(() => runtime, createPostgresPassportRepositories), { create: randomUUID }, { validate: async () => {} }); }
function upload(app: RoomPassportService, roomId: string, version: number, actor: PassportActor) { return app.mutate(roomId, { action: "upload", version }, actor, { bytes: passportPdf(), name: "room.pdf" }); }
async function room(accessMode = "open") {
  const buildingId = randomUUID(); const roomId = randomUUID();
  await database.query(`insert into yu_inventory.buildings (id,name,name_key,address,address_key,created_by,updated_by) values ($1::uuid,'Main',$1::text,'Campus',$1::text,$2,$2)`, [buildingId, admin.userId]);
  await database.query(`insert into yu_inventory.rooms (id,building_id,designation,designation_key,floor_number,access_mode,created_by,updated_by) values ($1::uuid,$2,'101',$1::text,1,$3,$4,$4)`, [roomId, buildingId, accessMode, admin.userId]);
  return roomId;
}
async function reset() {
  if (config.target !== "test" || !config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a non-test database");
  const pool = createPostgresPool(config, { max: 1 });
  try { await pool.query('drop schema if exists "yu_migrations" cascade'); await pool.query('drop schema if exists "yu_inventory" cascade'); } finally { await pool.end(); }
}
