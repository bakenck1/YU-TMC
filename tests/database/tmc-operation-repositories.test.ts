import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TmcOperationRepositoryConflictError } from "@/lib/application/ports/tmc-operation-repositories";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresTmcOperationRepositories } from "@/lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import { createPostgresWebPushRepositories } from "@/lib/server/persistence/postgres/postgres-web-push-repositories";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL TMC operation repositories", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 3 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("persists, projects, detects conflicts, and rolls back through real SQL", async () => {
    const initiatorId = randomUUID();
    const recipientId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const itemIds = [randomUUID(), randomUUID(), randomUUID()];
    const periodIds = [randomUUID(), randomUUID(), randomUUID()];
    const requestId = randomUUID();
    const conflictRequestId = randomUUID();
    const createdAt = new Date("2026-08-09T12:00:00.000Z");
    const repositories = createPostgresTmcOperationRepositories(database);
    const requests = repositories.transferRequests;

    await seedUsers(initiatorId, recipientId);
    await seedLocation(buildingId, roomId, initiatorId);
    for (let index = 0; index < itemIds.length; index += 1) {
      await seedItemAndResponsibility({
        itemId: itemIds[index]!,
        periodId: periodIds[index]!,
        roomId,
        responsibleId: initiatorId,
        ordinal: index + 1,
      });
    }
    await seedAttachedPhoto(itemIds[0]!, initiatorId);

    await database.query(
      `insert into "yu_inventory"."transfers"
         (id, item_id, requested_by, proposed_responsible_id,
          current_responsible_id_at_request)
       values ($1, $2, $3, $3, $4)`,
      [randomUUID(), itemIds[1], recipientId, initiatorId],
    );

    expect(await requests.findUserById(recipientId)).toMatchObject({
      id: recipientId,
      active: true,
      deletedAt: null,
    });
    expect(await requests.findUserById(randomUUID())).toBeNull();

    await requests.insertRequest({
      id: requestId,
      initiatorId,
      recipientId,
      comment: "Передача оборудования",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
    });
    const insertedItem = await requests.insertRequestItem({
      id: randomUUID(),
      requestId,
      itemId: itemIds[0]!,
      expectedItemVersion: 1,
      responsibilityPeriodIdAtRequest: periodIds[0]!,
      currentResponsibleIdAtRequest: initiatorId,
      createdAt,
    });
    expect(insertedItem).toMatchObject({
      requestId,
      itemId: itemIds[0],
      result: "pending",
      version: 1,
    });

    const candidates = await requests.findCandidates(itemIds);
    expect(candidates).toHaveLength(3);
    const candidatesById = new Map(
      candidates.map((candidate) => [candidate.itemId, candidate]),
    );
    expect(candidatesById.get(itemIds[0]!)?.hasActiveTransfer).toBe(true);
    expect(candidatesById.get(itemIds[1]!)?.hasActiveTransfer).toBe(true);
    expect(candidatesById.get(itemIds[2]!)?.hasActiveTransfer).toBe(false);
    expect(candidatesById.get(itemIds[0]!)).toMatchObject({
      itemId: itemIds[0],
      quantity: 2,
      unitPrice: 125000.5,
      responsibilityPeriodId: periodIds[0],
      responsibleUser: { id: initiatorId, active: true },
      photoUrl: `/api/inventory/items/${itemIds[0]}/photo?v=1`,
    });

    const initialAggregate = await requests.findById(requestId);
    expect(initialAggregate).toMatchObject({
      id: requestId,
      status: "pending",
      comment: "Передача оборудования",
      items: [{
        id: insertedItem.id,
        itemId: itemIds[0],
        responsibilityPeriodIdAtRequest: periodIds[0],
        currentResponsibleIdAtRequest: initiatorId,
        responsibleUserProfile: { fullName: "Repository Initiator" },
        item: { name: "Repository Item 1", roomId },
      }],
    });

    await database.query(
      `update "yu_inventory"."users"
          set full_name = 'Renamed Initiator', updated_at = now()
        where id = $1`,
      [initiatorId],
    );
    await database.query(
      `update "yu_inventory"."items"
          set name = 'Renamed Item', version = version + 1, updated_at = now()
        where id = $1`,
      [itemIds[0]],
    );
    const refreshedAggregate = await requests.findById(requestId);
    expect(refreshedAggregate?.items[0]).toMatchObject({
      responsibilityPeriodIdAtRequest: periodIds[0],
      currentResponsibleIdAtRequest: initiatorId,
      responsibleUserProfile: { fullName: "Renamed Initiator" },
      item: { name: "Renamed Item", version: 2 },
    });

    await requests.insertRequest({
      id: conflictRequestId,
      initiatorId,
      recipientId,
      comment: null,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
    });
    await expectRepositoryProblem(
      requests.insertRequestItem({
        id: randomUUID(),
        requestId: conflictRequestId,
        itemId: itemIds[0]!,
        expectedItemVersion: 2,
        responsibilityPeriodIdAtRequest: periodIds[0]!,
        currentResponsibleIdAtRequest: initiatorId,
        createdAt,
      }),
      "active_transfer_exists",
    );
    await expectRepositoryProblem(
      requests.insertRequestItem({
        id: randomUUID(),
        requestId: conflictRequestId,
        itemId: itemIds[1]!,
        expectedItemVersion: 1,
        responsibilityPeriodIdAtRequest: periodIds[1]!,
        currentResponsibleIdAtRequest: initiatorId,
        createdAt,
      }),
      "active_transfer_exists",
    );
    await expectRepositoryProblem(
      requests.insertRequestItem({
        id: randomUUID(),
        requestId: conflictRequestId,
        itemId: itemIds[2]!,
        expectedItemVersion: 1,
        responsibilityPeriodIdAtRequest: periodIds[2]!,
        currentResponsibleIdAtRequest: recipientId,
        createdAt,
      }),
      "responsibility_changed",
    );

    const rolledBackRequestId = randomUUID();
    const client = await database.connect();
    try {
      await client.query("begin");
      const transactionalRequests = createPostgresTmcOperationRepositories(client)
        .transferRequests;
      await transactionalRequests.insertRequest({
        id: rolledBackRequestId,
        initiatorId,
        recipientId,
        comment: null,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 86_400_000),
      });
      await transactionalRequests.insertRequestItem({
        id: randomUUID(),
        requestId: rolledBackRequestId,
        itemId: itemIds[2]!,
        expectedItemVersion: 1,
        responsibilityPeriodIdAtRequest: periodIds[2]!,
        currentResponsibleIdAtRequest: initiatorId,
        createdAt,
      });
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(await requests.findById(rolledBackRequestId)).toBeNull();
  });

  it("atomically accepts and rejects a mixed decision with one responsibility handoff", async () => {
    const initiatorId = randomUUID();
    const recipientId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const itemIds = [randomUUID(), randomUUID()];
    const periodIds = [randomUUID(), randomUUID()];
    const requestId = randomUUID();
    const requestItemIds = [randomUUID(), randomUUID()];
    const decidedAt = new Date("2026-08-10T12:00:00.000Z");
    await seedUsers(initiatorId, recipientId);
    await seedLocation(buildingId, roomId, initiatorId);
    for (let index = 0; index < itemIds.length; index += 1) {
      await seedItemAndResponsibility({ itemId: itemIds[index]!, periodId: periodIds[index]!, roomId, responsibleId: initiatorId, ordinal: index + 10 });
    }
    const requests = createPostgresTmcOperationRepositories(database).transferRequests;
    await requests.insertRequest({ id: requestId, initiatorId, recipientId, comment: null, createdAt: decidedAt, expiresAt: new Date(decidedAt.getTime() + 86_400_000) });
    for (let index = 0; index < itemIds.length; index += 1) {
      await requests.insertRequestItem({ id: requestItemIds[index]!, requestId, itemId: itemIds[index]!, expectedItemVersion: 1, responsibilityPeriodIdAtRequest: periodIds[index]!, currentResponsibleIdAtRequest: initiatorId, createdAt: decidedAt });
    }

    const client = await database.connect();
    try {
      await client.query("begin");
      const tx = createPostgresTmcOperationRepositories(client).transferRequests;
      expect((await tx.findByIdForUpdate(requestId))?.status).toBe("pending");
      expect(await tx.decideItem({ requestId, requestItemId: requestItemIds[0]!, itemId: itemIds[0]!, responsibilityPeriodIdAtRequest: periodIds[0]!, currentResponsibleIdAtRequest: initiatorId, expectedVersion: 1, decision: "accept", recipientId, decidedBy: recipientId, decidedAt, newResponsibilityPeriodId: randomUUID() })).toBe("accepted");
      expect(await tx.decideItem({ requestId, requestItemId: requestItemIds[1]!, itemId: itemIds[1]!, responsibilityPeriodIdAtRequest: periodIds[1]!, currentResponsibleIdAtRequest: initiatorId, expectedVersion: 1, decision: "reject", recipientId, decidedBy: recipientId, decidedAt, newResponsibilityPeriodId: randomUUID() })).toBe("rejected");
      expect(await tx.closeRequest({ requestId, expectedVersion: 1, status: "accepted", closedBy: recipientId, closedAt: decidedAt, isAdministrativeDecision: false, administrativeReason: null })).toBe(true);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const aggregate = await requests.findById(requestId);
    expect(aggregate).toMatchObject({ status: "accepted", version: 2 });
    expect(new Map(aggregate?.items.map((item) => [item.itemId, { result: item.result, version: item.version }]))).toEqual(new Map([[itemIds[0]!, { result: "accepted", version: 2 }], [itemIds[1]!, { result: "rejected", version: 2 }]]));
    const owners = await database.query<{ item_id: string; responsible_user_id: string }>(`select item_id, responsible_user_id from "yu_inventory"."responsibility_periods" where item_id = any($1::uuid[]) and ended_at is null order by item_id`, [itemIds]);
    expect(new Map(owners.rows.map((row) => [row.item_id, row.responsible_user_id]))).toEqual(new Map([[itemIds[0]!, recipientId], [itemIds[1]!, initiatorId]]));
  });

  it("persists participant history, immutable audit, unread delivery, and read receipt", async () => {
    const initiatorId = randomUUID();
    const recipientId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const nextRoomId = randomUUID();
    const itemId = randomUUID();
    const periodId = randomUUID();
    const requestId = randomUUID();
    const createdAt = new Date("2026-08-10T12:00:00.000Z");
    await seedUsers(initiatorId, recipientId);
    await seedLocation(buildingId, roomId, initiatorId);
    await database.query(
      `insert into "yu_inventory"."rooms"
         (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
       values ($1, $2, 'Repository Room 2', $3, 2, $4, $4)`,
      [nextRoomId, buildingId, `repository-${nextRoomId}`, initiatorId],
    );
    await seedItemAndResponsibility({ itemId, periodId, roomId, responsibleId: initiatorId, ordinal: 40 });
    const repositories = createPostgresTmcOperationRepositories(database);
    await repositories.transferRequests.insertRequest({ id: requestId, initiatorId, recipientId, comment: null, createdAt, expiresAt: new Date(createdAt.getTime() + 86_400_000) });
    await repositories.transferRequests.insertRequestItem({ id: randomUUID(), requestId, itemId, expectedItemVersion: 1, responsibilityPeriodIdAtRequest: periodId, currentResponsibleIdAtRequest: initiatorId, createdAt });

    const domainEventId = randomUUID();
    await repositories.stageFour.appendAudit({
      id: randomUUID(), domainEventId, actorId: initiatorId, actorRole: "employee",
      subjectKind: "tmc_transfer_request", subjectId: requestId, subjectRevision: 1,
      action: "tmc_transfer.requested", beforeValues: null, afterValues: { status: "pending" }, occurredAt: createdAt,
    });
    const notificationId = randomUUID();
    const subscriptionId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."web_push_subscriptions"
         (id, user_id, endpoint, p256dh, auth, language, created_at, updated_at)
       values ($1, $2, $3, 'p256dh', 'auth', 'en', $4, $4)`,
      [subscriptionId, recipientId, `https://fcm.googleapis.com/fcm/send/${subscriptionId}`, createdAt],
    );
    await repositories.stageFour.createNotification({
      id: notificationId, domainEventId, type: "tmc_transfer.requested", actorId: initiatorId,
      requestId, itemId: null, requestRevision: 1, recipientId, audience: "direct_user",
      safePayload: { itemCount: 1 }, occurredAt: createdAt,
    });
    await database.query(
      `insert into "yu_inventory"."audit_records"
         (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
          subject_revision, action, before_values, after_values, occurred_at)
       values ($1, $2, 'employee', 'item', $3, 2, 'item.location_changed', $4, $5, $6)`,
      [randomUUID(), initiatorId, itemId,
       { roomId, location: "Repository Building / Repository Room" },
       { roomId: nextRoomId, location: "Repository Building / Repository Room 2", comment: "move" },
       createdAt],
    );

    expect(await repositories.stageFour.listHistory({ actorId: recipientId, includeAll: false, itemId, overdue: false, now: createdAt, limit: 10 })).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ actorId: initiatorId, includeAll: false, itemId, now: createdAt, limit: 10 })).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ actorId: randomUUID(), includeAll: false, itemId, now: createdAt, limit: 10 })).toHaveLength(0);
    const locationHistory = await repositories.stageFour.listLocationHistory({ actorId: initiatorId, includeAll: false, itemId, now: createdAt, limit: 10 });
    expect(locationHistory).toHaveLength(1);
    expect(locationHistory[0]).toMatchObject({ itemId, beforeRoomId: roomId, afterRoomId: nextRoomId, comment: "move" });
    expect(await repositories.stageFour.listLocationHistory({ actorId: randomUUID(), includeAll: false, itemId, now: createdAt, limit: 10 })).toHaveLength(0);
    expect(await repositories.stageFour.countUnreadNotifications({ actorId: recipientId, includeAdminQueue: false, now: createdAt })).toBe(1);
    expect(await repositories.stageFour.markNotificationRead({ notificationId, actorId: recipientId, includeAdminQueue: false, readAt: createdAt })).toBe(true);
    expect(await repositories.stageFour.countUnreadNotifications({ actorId: recipientId, includeAdminQueue: false, now: createdAt })).toBe(0);
    const audit = await database.query(`select action from "yu_inventory"."audit_records" where domain_event_id = $1`, [domainEventId]);
    expect(audit.rows).toEqual([{ action: "tmc_transfer.requested" }]);
    const outbox = createPostgresWebPushRepositories(database).tmcPushOutbox!;
    const workerId = randomUUID();
    const claimed = await outbox.claim({ workerId, now: createdAt, lockedUntil: new Date(createdAt.getTime() + 60_000), limit: 10 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ eventId: notificationId, requestId, recipientIds: [recipientId] });
    expect(await outbox.reserveDelivery({
      eventId: notificationId, subscriptionId, subscriptionUpdatedAt: createdAt,
      workerId, now: createdAt, lockedUntil: new Date(createdAt.getTime() + 60_000),
    })).toBe("reserved");
    await outbox.completeDelivery({ eventId: notificationId, subscriptionId, workerId, completedAt: createdAt });
    expect(await outbox.reserveDelivery({
      eventId: notificationId, subscriptionId, subscriptionUpdatedAt: createdAt,
      workerId: randomUUID(), now: createdAt, lockedUntil: new Date(createdAt.getTime() + 60_000),
    })).toBe("delivered");
    await outbox.complete({ eventId: notificationId, workerId, completedAt: createdAt });
  });

  it("does not let a snapshot participant filter a multi-owner request through a sibling item or location", async () => {
    const initiatorId = randomUUID();
    const recipientId = randomUUID();
    const ownerAId = randomUUID();
    const ownerBId = randomUUID();
    const buildingAId = randomUUID();
    const buildingBId = randomUUID();
    const roomAId = randomUUID();
    const roomBId = randomUUID();
    const itemAId = randomUUID();
    const itemBId = randomUUID();
    const periodAId = randomUUID();
    const periodBId = randomUUID();
    const requestId = randomUUID();
    const requestItemAId = randomUUID();
    const requestItemBId = randomUUID();
    const createdAt = new Date("2026-08-10T13:00:00.000Z");

    await seedUsers(initiatorId, recipientId);
    await seedUsers(ownerAId, ownerBId);
    await seedLocation(buildingAId, roomAId, initiatorId);
    await seedLocation(buildingBId, roomBId, initiatorId);
    await seedItemAndResponsibility({ itemId: itemAId, periodId: periodAId, roomId: roomAId, responsibleId: ownerAId, ordinal: 50 });
    await seedItemAndResponsibility({ itemId: itemBId, periodId: periodBId, roomId: roomBId, responsibleId: ownerBId, ordinal: 51 });

    const repositories = createPostgresTmcOperationRepositories(database);
    await repositories.transferRequests.insertRequest({
      id: requestId,
      initiatorId,
      recipientId,
      comment: null,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
    });
    await repositories.transferRequests.insertRequestItem({
      id: requestItemAId, requestId, itemId: itemAId, expectedItemVersion: 1,
      responsibilityPeriodIdAtRequest: periodAId,
      currentResponsibleIdAtRequest: ownerAId, createdAt,
    });
    await repositories.transferRequests.insertRequestItem({
      id: requestItemBId, requestId, itemId: itemBId, expectedItemVersion: 1,
      responsibilityPeriodIdAtRequest: periodBId,
      currentResponsibleIdAtRequest: ownerBId, createdAt,
    });

    const query = { actorId: ownerAId, includeAll: false, now: createdAt, limit: 10 };
    expect(await repositories.stageFour.listHistory(query)).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ ...query, itemId: itemAId })).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ ...query, itemId: itemBId })).toHaveLength(0);
    expect(await repositories.stageFour.listHistory({ ...query, roomId: roomBId })).toHaveLength(0);
    expect(await repositories.stageFour.listHistory({ ...query, buildingId: buildingBId })).toHaveLength(0);
    expect(await repositories.stageFour.listHistory({ ...query, actorId: recipientId, itemId: itemBId })).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ ...query, actorId: randomUUID(), includeAll: true, itemId: itemBId })).toHaveLength(1);

    expect(await repositories.transferRequests.decideItem({
      requestId, requestItemId: requestItemAId, itemId: itemAId,
      responsibilityPeriodIdAtRequest: periodAId,
      currentResponsibleIdAtRequest: ownerAId,
      expectedVersion: 1, decision: "reject", recipientId,
      decidedBy: recipientId, decidedAt: createdAt,
      newResponsibilityPeriodId: randomUUID(),
    })).toBe("rejected");
    expect(await repositories.transferRequests.decideItem({
      requestId, requestItemId: requestItemBId, itemId: itemBId,
      responsibilityPeriodIdAtRequest: periodBId,
      currentResponsibleIdAtRequest: ownerBId,
      expectedVersion: 1, decision: "accept", recipientId,
      decidedBy: recipientId, decidedAt: createdAt,
      newResponsibilityPeriodId: randomUUID(),
    })).toBe("accepted");
    expect(await repositories.transferRequests.closeRequest({
      requestId, expectedVersion: 1, status: "accepted", closedBy: recipientId,
      closedAt: createdAt, isAdministrativeDecision: false,
      administrativeReason: null,
    })).toBe(true);

    expect(await repositories.stageFour.listHistory({ ...query, status: "rejected" })).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ ...query, status: "accepted" })).toHaveLength(0);
    expect(await repositories.stageFour.listHistory({ ...query, actorId: recipientId, status: "accepted" })).toHaveLength(1);
    expect(await repositories.stageFour.listHistory({ ...query, actorId: randomUUID(), includeAll: true, status: "accepted", itemId: itemBId })).toHaveLength(1);
  });

  it("suppresses closed overdue notifications from feed, unread count, and push outbox", async () => {
    const initiatorId = randomUUID();
    const recipientId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const itemId = randomUUID();
    const periodId = randomUUID();
    const requestId = randomUUID();
    const createdAt = new Date("2026-08-10T12:00:00.000Z");
    const expiresAt = new Date(createdAt.getTime() + 86_400_000);
    const afterExpiry = new Date(expiresAt.getTime() + 1);
    await seedUsers(initiatorId, recipientId);
    await seedLocation(buildingId, roomId, initiatorId);
    await seedItemAndResponsibility({ itemId, periodId, roomId, responsibleId: initiatorId, ordinal: 41 });
    const repositories = createPostgresTmcOperationRepositories(database);
    await repositories.transferRequests.insertRequest({ id: requestId, initiatorId, recipientId, comment: null, createdAt, expiresAt });
    await repositories.transferRequests.insertRequestItem({ id: randomUUID(), requestId, itemId, expectedItemVersion: 1, responsibilityPeriodIdAtRequest: periodId, currentResponsibleIdAtRequest: initiatorId, createdAt });
    const notificationId = randomUUID();
    await repositories.stageFour.createNotification({
      id: notificationId, domainEventId: randomUUID(), type: "tmc_transfer.overdue",
      actorId: initiatorId, requestId, itemId: null, requestRevision: 1,
      audience: "admin_queue", safePayload: { itemCount: 1 }, occurredAt: expiresAt,
    });
    expect(await repositories.transferRequests.cancelRequest({
      requestId, expectedVersion: 1, cancelledBy: initiatorId, cancelledAt: afterExpiry,
      isAdministrativeDecision: false, administrativeReason: null,
    })).toBe(true);
    expect(await repositories.stageFour.listNotifications({ actorId: initiatorId, includeAdminQueue: true, now: afterExpiry, limit: 10 })).toEqual([]);
    expect(await repositories.stageFour.countUnreadNotifications({ actorId: initiatorId, includeAdminQueue: true, now: afterExpiry })).toBe(0);
    const outbox = createPostgresWebPushRepositories(database).tmcPushOutbox!;
    expect(await outbox.claim({ workerId: randomUUID(), now: afterExpiry, lockedUntil: new Date(afterExpiry.getTime() + 60_000), limit: 10 })).toEqual([]);
    const state = await database.query<{ processed_at: Date | null; last_error_code: string | null }>(
      `select processed_at, last_error_code from "yu_inventory"."tmc_web_push_outbox" where notification_event_id = $1`,
      [notificationId],
    );
    expect(state.rows[0]).toMatchObject({ last_error_code: "event_no_longer_deliverable" });
    expect(state.rows[0]?.processed_at).not.toBeNull();
  });
});

async function seedUsers(initiatorId: string, recipientId: string) {
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values
       ($1, $3, $4,
        'Repository Initiator', 'employee', now(), now()),
       ($2, $5, $6,
        'Repository Recipient', 'employee', now(), now())`,
    [initiatorId, recipientId, `RI-${initiatorId.slice(0, 8)}`, `${initiatorId}@example.com`, `RR-${recipientId.slice(0, 8)}`, `${recipientId}@example.com`],
  );
}

async function seedLocation(
  buildingId: string,
  roomId: string,
  actorId: string,
) {
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Repository Building', $2,
             'Repository Address', $2, $3, $3)`,
    [buildingId, `repository-${buildingId}`, actorId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Repository Room', $3, 1, $4, $4)`,
    [roomId, buildingId, `repository-${roomId}`, actorId],
  );
}

async function seedItemAndResponsibility(input: {
  itemId: string;
  periodId: string;
  roomId: string;
  responsibleId: string;
  ordinal: number;
}) {
  await database.query(
    `insert into "yu_inventory"."items"
       (id, name, quantity, unit_price, room_id, inventory_number_kind,
        inventory_number, inventory_number_key, created_by, updated_by)
     values ($1, $2, 2, 125000.50, $3, 'official', $4, $5, $6, $6)`,
    [
      input.itemId,
      `Repository Item ${input.ordinal}`,
      input.roomId,
      `REPO-${input.ordinal}-${input.itemId}`,
      `repo-${input.itemId}`,
      input.responsibleId,
    ],
  );
  await database.query(
    `insert into "yu_inventory"."responsibility_periods"
       (id, item_id, responsible_user_id, source, started_by)
     values ($1, $2, $3, 'transfer', $3)`,
    [input.periodId, input.itemId, input.responsibleId],
  );
}

async function seedAttachedPhoto(itemId: string, uploadedBy: string) {
  await database.query(
    `insert into "yu_inventory"."photos"
       (id, purpose, status, uploaded_by, original_object_key,
        preview_object_key, trusted_mime_type, byte_size, width, height,
        checksum_sha256, reserved_at, expires_at, attached_at, item_id)
     values ($1, 'item', 'attached', $2, $3, $4, 'image/jpeg',
             1, 1, 1, $5, now(), now() + interval '1 hour', now(), $6)`,
    [
      randomUUID(),
      uploadedBy,
      `repository/original/${itemId}`,
      `repository/preview/${itemId}`,
      "0".repeat(64),
      itemId,
    ],
  );
}

async function expectRepositoryProblem(
  promise: Promise<unknown>,
  problem: TmcOperationRepositoryConflictError["problem"],
) {
  try {
    await promise;
    throw new Error(`Expected repository problem: ${problem}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TmcOperationRepositoryConflictError);
    expect(error).toMatchObject({ problem });
  }
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
