import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  IdempotencyRequestRepository,
  IdempotencyResponse,
} from "@/lib/application/ports/inventory-concurrency-repositories";
import type {
  InsertTmcTransferRequestItemRecord,
  TmcOperationRepositories,
  TmcTransferRequestRepository,
} from "@/lib/application/ports/tmc-operation-repositories";
import { TmcTransferRequestService } from "@/lib/application/services/tmc-transfer-request-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresTmcOperationRepositories } from "@/lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import {
  PostgresUnitOfWork,
  type PostgresRepositorySource,
} from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("TMC transfer request transactions", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 8 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("isolates late item conflicts and rolls back an empty parent", async () => {
    const fixture = await seedFixture(9);
    const actor = { userId: fixture.initiatorId, role: "employee" as const };
    const activeConflictId = fixture.itemIds[1]!;
    const activeConflictService = createService(async (source, input) => {
      if (input.itemId !== activeConflictId) return;
      await source.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [randomUUID(), input.itemId, fixture.recipientIds[0], fixture.initiatorId],
      );
    });

    const partial = await activeConflictService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: fixture.itemIds.slice(0, 3),
    }, actor);
    expect(partial.included).toBe(2);
    expect(partial.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome)).toEqual([
      "included",
      "active_transfer_exists",
      "included",
    ]);
    expect(partial.request?.items).toHaveLength(2);
    await expectPersistedRequest(partial.request!.id, 2);
    const rolledBackLegacy = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."transfers"
        where item_id = $1`,
      [activeConflictId],
    );
    expect(rolledBackLegacy.rows[0]?.count).toBe(0);

    const requestsBefore = await requestCount();
    const allConflictId = fixture.itemIds[3]!;
    const allConflictService = createService(async (source, input) => {
      if (input.itemId !== allConflictId) return;
      await source.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [randomUUID(), input.itemId, fixture.recipientIds[0], fixture.initiatorId],
      );
    });
    const rejected = await allConflictService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [allConflictId],
    }, actor);
    expect(rejected).toMatchObject({ request: null, included: 0, problems: 1 });
    expect(rejected.items[0]).toMatchObject({ problem: "active_transfer_exists" });
    expect(await requestCount()).toBe(requestsBefore);

    const versionConflictId = fixture.itemIds[4]!;
    const versionConflictService = createService(async (source, input) => {
      if (input.itemId !== versionConflictId) return;
      await source.query(
        `update "yu_inventory"."items"
            set version = version + 1, updated_at = now()
          where id = $1`,
        [input.itemId],
      );
    });
    const versionResult = await versionConflictService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [versionConflictId, fixture.itemIds[5]!],
    }, actor);
    expect(versionResult.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome)).toEqual([
      "version_conflict",
      "included",
    ]);
    const unchangedVersion = await database.query<{ version: number }>(
      `select version from "yu_inventory"."items" where id = $1`,
      [versionConflictId],
    );
    expect(unchangedVersion.rows[0]?.version).toBe(1);

    const concurrentItemId = fixture.itemIds[6]!;
    const concurrent = await Promise.all([
      createService().create({
        recipientId: fixture.recipientIds[0]!,
        itemIds: [concurrentItemId],
      }, actor),
      createService().create({
        recipientId: fixture.recipientIds[1]!,
        itemIds: [concurrentItemId],
      }, actor),
    ]);
    expect(concurrent.filter(({ included }) => included === 1)).toHaveLength(1);
    expect(concurrent.filter(({ included }) => included === 0)).toHaveLength(1);
    expect(
      concurrent.flatMap(({ items }) => items).some(
        (item) => item.outcome === "problem" && item.problem === "active_transfer_exists",
      ),
    ).toBe(true);
    const activeRows = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."tmc_transfer_request_items"
        where item_id = $1 and result = 'pending'`,
      [concurrentItemId],
    );
    expect(activeRows.rows[0]?.count).toBe(1);

    const externallyChangedVersionId = fixture.itemIds[7]!;
    const observedVersions: number[] = [];
    let versionChanged = false;
    const externallyChangedVersionService = createService(
      async (_source, input) => {
        if (input.itemId !== externallyChangedVersionId) return;
        observedVersions.push(input.expectedItemVersion);
        if (versionChanged) return;
        versionChanged = true;
        await database.query(
          `update "yu_inventory"."items"
              set version = version + 1, updated_at = now()
            where id = $1`,
          [input.itemId],
        );
      },
    );
    const retriedVersion = await externallyChangedVersionService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [externallyChangedVersionId],
    }, actor);
    expect(observedVersions).toEqual([1, 2]);
    expect(retriedVersion).toMatchObject({ included: 1, problems: 0 });
    await expectPersistedRequest(retriedVersion.request!.id, 1);

    const externallyClosedPeriodItemId = fixture.itemIds[8]!;
    const externallyClosedPeriodId = fixture.periodIds[8]!;
    let periodClosed = false;
    const externallyClosedPeriodService = createService(
      async (_source, input) => {
        if (input.itemId !== externallyClosedPeriodItemId || periodClosed) return;
        periodClosed = true;
        await database.query(
          `update "yu_inventory"."responsibility_periods"
              set ended_at = now(), ended_by = $2,
                  end_reason = 'external responsibility change'
            where id = $1`,
          [externallyClosedPeriodId, fixture.initiatorId],
        );
      },
    );
    const requestsBeforeResponsibilityChange = await requestCount();
    const changedResponsibility = await externallyClosedPeriodService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [externallyClosedPeriodItemId],
    }, actor);
    expect(changedResponsibility).toMatchObject({
      request: null,
      included: 0,
      problems: 1,
    });
    expect(changedResponsibility.items[0]).toMatchObject({
      itemId: externallyClosedPeriodItemId,
      problem: "item_unavailable",
    });
    expect(await requestCount()).toBe(requestsBeforeResponsibilityChange);
  });

  it("enforces employee ownership and the administrator override in PostgreSQL", async () => {
    const fixture = await seedFixture(5);
    const foreignOwnerId = fixture.recipientIds[0]!;

    await database.query(
      `update "yu_inventory"."users" set role = 'warehouse' where id = $1`,
      [fixture.initiatorId],
    );
    const warehouseResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[0]!],
    }, { userId: fixture.initiatorId, role: "warehouse" });
    expect(warehouseResult).toMatchObject({ included: 1, problems: 0 });
    await database.query(
      `update "yu_inventory"."users" set role = 'employee' where id = $1`,
      [fixture.initiatorId],
    );

    for (const index of [2, 3]) {
      await database.query(
        `update "yu_inventory"."responsibility_periods"
            set ended_at = now(), ended_by = $2,
                end_reason = 'permission fixture owner change'
          where id = $1`,
        [fixture.periodIds[index], fixture.initiatorId],
      );
      const replacementPeriodId = randomUUID();
      fixture.periodIds[index] = replacementPeriodId;
      await database.query(
        `insert into "yu_inventory"."responsibility_periods"
           (id, item_id, responsible_user_id, source, started_by)
         values ($1, $2, $3, 'transfer', $3)`,
        [replacementPeriodId, fixture.itemIds[index], foreignOwnerId],
      );
    }

    const employeeResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[1]!, fixture.itemIds[2]!],
    }, { userId: fixture.initiatorId, role: "employee" });
    expect(employeeResult.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome)).toEqual([
      "included",
      "item_unavailable",
    ]);

    const requestsBeforeUnavailableBatch = await requestCount();
    const unavailableResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[3]!],
    }, { userId: fixture.initiatorId, role: "employee" });
    expect(unavailableResult).toMatchObject({
      request: null,
      included: 0,
      problems: 1,
    });
    expect(unavailableResult.items[0]).toMatchObject({ problem: "item_unavailable" });
    expect(await requestCount()).toBe(requestsBeforeUnavailableBatch);

    const requestsBeforeStaleAdmin = await requestCount();
    const staleAdminResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[3]!],
    }, { userId: fixture.initiatorId, role: "admin" });
    expect(staleAdminResult.items[0]).toMatchObject({ problem: "item_unavailable" });
    expect(await requestCount()).toBe(requestsBeforeStaleAdmin);

    await database.query(
      `update "yu_inventory"."users"
          set is_active = false, deactivated_at = now(),
              version = version + 1, updated_at = now()
        where id = $1`,
      [fixture.initiatorId],
    );
    await expect(createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[4]!],
    }, { userId: fixture.initiatorId, role: "employee" })).rejects.toMatchObject({
      kind: "forbidden",
      publicCode: "forbidden",
    });

    const adminId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Transaction Administrator', 'admin', now(), now())`,
      [adminId, `TX-ADMIN-${adminId.slice(0, 8)}`, `${adminId}@example.com`],
    );
    const adminResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[2]!],
    }, { userId: adminId, role: "admin" });
    expect(adminResult).toMatchObject({ included: 1, problems: 0 });
    expect(adminResult.request).toMatchObject({
      status: "accepted",
      isAdministrativeDecision: true,
      summary: { accepted: 1, pending: 0 },
    });

    const administrativeAssignment = await database.query<{
      responsible_user_id: string;
      source: string;
    }>(
      `select responsible_user_id, source
         from "yu_inventory"."responsibility_periods"
        where item_id = $1 and ended_at is null`,
      [fixture.itemIds[2]],
    );
    expect(administrativeAssignment.rows).toEqual([{
      responsible_user_id: fixture.recipientIds[1],
      source: "admin_override",
    }]);
    const recipientNotification = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."notification_events" event
         join "yu_inventory"."tmc_operation_notifications" notification
           on notification.notification_event_id = event.id
         join "yu_inventory"."notification_deliveries" delivery
           on delivery.event_id = event.id
        where notification.request_id = $1
          and event.type = 'tmc_transfer.completed'
          and delivery.recipient_id = $2`,
      [adminResult.request!.id, fixture.recipientIds[1]],
    );
    expect(recipientNotification.rows[0]?.count).toBe(1);

    const snapshots = await database.query<{
      item_id: string;
      current_responsible_id_at_request: string;
    }>(
      `select item_id, current_responsible_id_at_request
         from "yu_inventory"."tmc_transfer_request_items"
        where request_id = any($1::uuid[])
        order by item_id`,
      [[
        warehouseResult.request!.id,
        employeeResult.request!.id,
        adminResult.request!.id,
      ]],
    );
    expect(new Map(snapshots.rows.map((row) => [
      row.item_id,
      row.current_responsible_id_at_request,
    ]))).toEqual(new Map([
      [fixture.itemIds[0]!, fixture.initiatorId],
      [fixture.itemIds[1]!, fixture.initiatorId],
      [fixture.itemIds[2]!, foreignOwnerId],
    ]));
  });

  it("fences decision BOLA, revoked sessions, replays, and concurrent commits in PostgreSQL", async () => {
    const fixture = await seedFixture(4);
    const initiator = { userId: fixture.initiatorId, role: "employee" as const };
    const requestA = (await createService().create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[0]!],
    }, initiator)).request!;
    const requestB = (await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[1]!],
    }, initiator)).request!;

    await expect(createService().decideIdempotent(
      requestA.id,
      {
        requestVersion: requestA.version,
        decisions: [{
          itemId: requestA.items[0]!.item.id,
          itemVersion: requestA.items[0]!.version,
          decision: "accept",
        }],
      },
      { userId: fixture.recipientIds[1]!, role: "employee", sessionVersion: 1 },
      "tmc-db-outsider-001",
    )).rejects.toMatchObject({ kind: "not_found", publicCode: "request_not_found" });

    await expect(createService().decide(
      requestA.id,
      {
        requestVersion: requestA.version,
        decisions: [{
          itemId: requestB.items[0]!.item.id,
          itemVersion: requestB.items[0]!.version,
          decision: "accept",
        }],
      },
      { userId: fixture.recipientIds[0]!, role: "employee", sessionVersion: 1 },
    )).rejects.toMatchObject({
      kind: "validation",
      publicCode: "decision_coverage_mismatch",
    });
    const untouched = await database.query<{ status: string; result: string }>(
      `select request.status, request_item.result
         from "yu_inventory"."tmc_transfer_requests" request
         join "yu_inventory"."tmc_transfer_request_items" request_item
           on request_item.request_id = request.id
        where request.id = any($1::uuid[])
        order by request.id`,
      [[requestA.id, requestB.id]],
    );
    expect(untouched.rows).toEqual([
      { status: "pending", result: "pending" },
      { status: "pending", result: "pending" },
    ]);

    await database.query(
      `update "yu_inventory"."users"
          set version = version + 1, updated_at = now()
        where id = $1`,
      [fixture.recipientIds[0]],
    );
    const decisionA = {
      requestVersion: requestA.version,
      administrativeReason: "   ",
      decisions: [{
        itemId: requestA.items[0]!.item.id,
        itemVersion: requestA.items[0]!.version,
        decision: "accept" as const,
      }],
    };
    await expect(createService().decideIdempotent(
      requestA.id,
      decisionA,
      { userId: fixture.recipientIds[0]!, role: "employee", sessionVersion: 1 },
      "tmc-db-session-fence-1",
    )).rejects.toMatchObject({ kind: "not_found", publicCode: "request_not_found" });
    const completed = await createService().decideIdempotent(
      requestA.id,
      decisionA,
      { userId: fixture.recipientIds[0]!, role: "employee", sessionVersion: 2 },
      "tmc-db-session-fence-1",
    );
    const replayed = await createService().decideIdempotent(
      requestA.id,
      {
        requestVersion: requestA.version,
        decisions: [{
          decision: "accept",
          itemVersion: requestA.items[0]!.version,
          itemId: requestA.items[0]!.item.id,
        }],
      },
      { userId: fixture.recipientIds[0]!, role: "employee", sessionVersion: 2 },
      "tmc-db-session-fence-1",
    );
    expect(completed.kind).toBe("completed");
    expect(replayed).toEqual({ ...completed, kind: "replayed" });

    const adminRequest = (await createService().create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[2]!],
    }, initiator)).request!;
    const adminId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Decision Administrator', 'admin', now(), now())`,
      [adminId, `DEC-ADMIN-${adminId.slice(0, 8)}`, `${adminId}@example.com`],
    );
    const adminDecision = await createService().decideIdempotent(
      adminRequest.id,
      {
        requestVersion: adminRequest.version,
        decisions: [{
          itemId: adminRequest.items[0]!.item.id,
          itemVersion: adminRequest.items[0]!.version,
          decision: "accept",
        }],
        administrativeReason: "  Urgent compliance override  ",
      },
      { userId: adminId, role: "admin", sessionVersion: 1 },
      "tmc-db-admin-decision-1",
    );
    expect(adminDecision.request).toMatchObject({
      isAdministrativeDecision: true,
      administrativeReason: "Urgent compliance override",
    });
    const adminResponsibility = await database.query<{ source: string }>(
      `select source
         from "yu_inventory"."responsibility_periods"
        where item_id = $1 and ended_at is null`,
      [fixture.itemIds[2]],
    );
    expect(adminResponsibility.rows).toEqual([{ source: "admin_override" }]);
    const adminAudits = await database.query<{
      reason: string | null;
      is_administrative_exception: boolean;
    }>(
      `select reason, is_administrative_exception
         from "yu_inventory"."audit_records"
        where domain_event_id = (
          select domain_event_id
            from "yu_inventory"."audit_records"
           where subject_kind = 'tmc_transfer_request'
             and subject_id = $1
             and action = 'tmc_transfer.completed'
        )
        order by subject_kind, subject_id`,
      [adminRequest.id],
    );
    expect(adminAudits.rows).toHaveLength(2);
    expect(adminAudits.rows.every((row) =>
      row.reason === "Urgent compliance override" &&
      row.is_administrative_exception)).toBe(true);

    const raceRequest = (await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[3]!],
    }, initiator)).request!;
    const raceInput = {
      requestVersion: raceRequest.version,
      decisions: [{
        itemId: raceRequest.items[0]!.item.id,
        itemVersion: raceRequest.items[0]!.version,
        decision: "accept" as const,
      }],
    };
    const raced = await Promise.allSettled([
      createService().decideIdempotent(
        raceRequest.id,
        raceInput,
        { userId: fixture.recipientIds[1]!, role: "employee", sessionVersion: 1 },
        "tmc-db-decision-race-a",
      ),
      createService().decideIdempotent(
        raceRequest.id,
        raceInput,
        { userId: fixture.recipientIds[1]!, role: "employee", sessionVersion: 1 },
        "tmc-db-decision-race-b",
      ),
    ]);
    expect(raced.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(raced.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const raceAudits = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."audit_records"
        where subject_kind = 'tmc_transfer_request'
          and subject_id = $1
          and action = 'tmc_transfer.completed'`,
      [raceRequest.id],
    );
    expect(raceAudits.rows[0]?.count).toBe(1);
  });

  it("fences cancellation BOLA, revoked sessions, parent scope, audit metadata, and overdue outbox in PostgreSQL", async () => {
    const fixture = await seedFixture(2);
    const initiator = {
      userId: fixture.initiatorId,
      role: "employee" as const,
      sessionVersion: 1,
    };
    const requestA = (await createService().create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[0]!],
    }, initiator)).request!;
    const requestB = (await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[1]!],
    }, initiator)).request!;

    for (const [requestId, actor, key] of [
      [randomUUID(), initiator, "tmc-db-cancel-missing-1"],
      [
        requestA.id,
        {
          userId: fixture.recipientIds[1]!,
          role: "employee" as const,
          sessionVersion: 1,
        },
        "tmc-db-cancel-outsider-1",
      ],
      [
        requestA.id,
        {
          userId: fixture.recipientIds[0]!,
          role: "employee" as const,
          sessionVersion: 1,
        },
        "tmc-db-cancel-recipient-1",
      ],
    ] as const) {
      await expect(createService().cancelIdempotent(
        requestId,
        { requestVersion: requestA.version },
        actor,
        key,
      )).rejects.toMatchObject({
        kind: "not_found",
        publicCode: "request_not_found",
      });
    }

    await database.query(
      `update "yu_inventory"."users"
          set version = version + 1, updated_at = now()
        where id = $1`,
      [fixture.initiatorId],
    );
    await expect(createService().cancelIdempotent(
      requestA.id,
      { requestVersion: requestA.version },
      initiator,
      "tmc-db-cancel-session-1",
    )).rejects.toMatchObject({
      kind: "not_found",
      publicCode: "request_not_found",
    });

    const currentInitiator = { ...initiator, sessionVersion: 2 };
    const completed = await createService().cancelIdempotent(
      requestA.id,
      { requestVersion: requestA.version, administrativeReason: "   " },
      currentInitiator,
      "tmc-db-cancel-session-1",
    );
    const replayed = await createService().cancelIdempotent(
      requestA.id,
      { requestVersion: requestA.version },
      currentInitiator,
      "tmc-db-cancel-session-1",
    );
    expect(completed.kind).toBe("completed");
    expect(replayed).toEqual({ ...completed, kind: "replayed" });

    const parentScoped = await database.query<{
      request_id: string;
      request_status: string;
      item_id: string;
      item_result: string;
    }>(
      `select request.id as request_id, request.status as request_status,
              request_item.item_id, request_item.result as item_result
         from "yu_inventory"."tmc_transfer_requests" request
         join "yu_inventory"."tmc_transfer_request_items" request_item
           on request_item.request_id = request.id
        where request.id = any($1::uuid[])
        order by request.id`,
      [[requestA.id, requestB.id]],
    );
    expect(parentScoped.rows).toEqual(expect.arrayContaining([
      {
        request_id: requestA.id,
        request_status: "cancelled",
        item_id: fixture.itemIds[0],
        item_result: "cancelled",
      },
      {
        request_id: requestB.id,
        request_status: "pending",
        item_id: fixture.itemIds[1],
        item_result: "pending",
      },
    ]));

    await database.query(
      `update "yu_inventory"."users"
          set version = version + 1, updated_at = now()
        where id = $1`,
      [fixture.initiatorId],
    );
    await expect(createService().cancelIdempotent(
      requestA.id,
      { requestVersion: requestA.version },
      currentInitiator,
      "tmc-db-cancel-session-1",
    )).rejects.toMatchObject({
      kind: "not_found",
      publicCode: "request_not_found",
    });
    const refreshedReplay = await createService().cancelIdempotent(
      requestA.id,
      { requestVersion: requestA.version },
      { ...currentInitiator, sessionVersion: 3 },
      "tmc-db-cancel-session-1",
    );
    expect(refreshedReplay).toEqual({ ...completed, kind: "replayed" });

    const adminId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Cancellation Administrator', 'admin', now(), now())`,
      [adminId, `CANCEL-ADMIN-${adminId.slice(0, 8)}`, `${adminId}@example.com`],
    );
    const adminCancellation = await createService().cancelIdempotent(
      requestB.id,
      {
        requestVersion: requestB.version,
        administrativeReason: "  Emergency compliance cancellation  ",
      },
      { userId: adminId, role: "employee", sessionVersion: 1 },
      "tmc-db-admin-cancel-1",
    );
    expect(adminCancellation.request).toMatchObject({
      status: "cancelled",
      isAdministrativeDecision: true,
      administrativeReason: "Emergency compliance cancellation",
    });
    const adminAudits = await database.query<{
      reason: string | null;
      is_administrative_exception: boolean;
    }>(
      `select reason, is_administrative_exception
         from "yu_inventory"."audit_records"
        where domain_event_id = (
          select domain_event_id
            from "yu_inventory"."audit_records"
           where subject_kind = 'tmc_transfer_request'
             and subject_id = $1
             and action = 'tmc_transfer.cancelled'
        )
        order by subject_kind, subject_id`,
      [requestB.id],
    );
    expect(adminAudits.rows).toHaveLength(2);
    expect(adminAudits.rows.every((row) =>
      row.reason === "Emergency compliance cancellation" &&
      row.is_administrative_exception)).toBe(true);

    const overdueFence = await database.query<{
      processed_at: Date | null;
      last_error_code: string | null;
    }>(
      `select outbox.processed_at, outbox.last_error_code
         from "yu_inventory"."tmc_web_push_outbox" outbox
         join "yu_inventory"."notification_events" event
           on event.id = outbox.notification_event_id
        where event.subject_id = $1
          and event.type = 'tmc_transfer.overdue'`,
      [requestB.id],
    );
    expect(overdueFence.rows).toHaveLength(1);
    expect(overdueFence.rows[0]?.processed_at).not.toBeNull();
    expect(overdueFence.rows[0]?.last_error_code).toBe(
      "event_no_longer_deliverable",
    );

    await database.query(
      `update "yu_inventory"."users"
          set role = 'employee', version = version + 1, updated_at = now()
        where id = $1`,
      [adminId],
    );
    await expect(createService().cancelIdempotent(
      requestB.id,
      {
        requestVersion: requestB.version,
        administrativeReason: "Emergency compliance cancellation",
      },
      { userId: adminId, role: "admin", sessionVersion: 2 },
      "tmc-db-admin-cancel-1",
    )).rejects.toMatchObject({
      kind: "not_found",
      publicCode: "request_not_found",
    });
  });

  it("serializes cancellation against decisions and duplicate cancellations in PostgreSQL", async () => {
    const fixture = await seedFixture(2);
    const initiator = {
      userId: fixture.initiatorId,
      role: "employee" as const,
      sessionVersion: 1,
    };
    const decisionRace = (await createService().create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[0]!],
    }, initiator)).request!;
    const cancelInput = { requestVersion: decisionRace.version };
    const decisionInput = {
      requestVersion: decisionRace.version,
      decisions: [{
        itemId: decisionRace.items[0]!.item.id,
        itemVersion: decisionRace.items[0]!.version,
        decision: "accept" as const,
      }],
    };
    const cancellationVsDecision = await Promise.allSettled([
      createService().cancelIdempotent(
        decisionRace.id,
        cancelInput,
        initiator,
        "tmc-db-cancel-decision-a",
      ),
      createService().decideIdempotent(
        decisionRace.id,
        decisionInput,
        {
          userId: fixture.recipientIds[0]!,
          role: "employee",
          sessionVersion: 1,
        },
        "tmc-db-cancel-decision-b",
      ),
    ]);
    expect(cancellationVsDecision.filter(({ status }) => status === "fulfilled"))
      .toHaveLength(1);
    expect(cancellationVsDecision.filter(({ status }) => status === "rejected"))
      .toHaveLength(1);

    const duplicateRace = (await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[1]!],
    }, initiator)).request!;
    const duplicateCancellations = await Promise.allSettled([
      createService().cancelIdempotent(
        duplicateRace.id,
        { requestVersion: duplicateRace.version },
        initiator,
        "tmc-db-cancel-race-a",
      ),
      createService().cancelIdempotent(
        duplicateRace.id,
        { requestVersion: duplicateRace.version },
        initiator,
        "tmc-db-cancel-race-b",
      ),
    ]);
    expect(duplicateCancellations.filter(({ status }) => status === "fulfilled"))
      .toHaveLength(1);
    expect(duplicateCancellations.filter(({ status }) => status === "rejected"))
      .toHaveLength(1);

    const terminalAudits = await database.query<{
      subject_id: string;
      count: number;
    }>(
      `select subject_id, count(*)::int as count
         from "yu_inventory"."audit_records"
        where subject_kind = 'tmc_transfer_request'
          and subject_id = any($1::uuid[])
          and action in ('tmc_transfer.completed', 'tmc_transfer.cancelled')
        group by subject_id
        order by subject_id`,
      [[decisionRace.id, duplicateRace.id]],
    );
    expect(terminalAudits.rows).toEqual(expect.arrayContaining([
      { subject_id: decisionRace.id, count: 1 },
      { subject_id: duplicateRace.id, count: 1 },
    ]));
  });

  it("replays TMC create idempotently across PostgreSQL connections", async () => {
    const fixture = await seedFixture(6);
    const actor = { userId: fixture.initiatorId, role: "employee" as const };
    const requestsBefore = await requestCount();

    const first = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!.toUpperCase(),
      itemIds: [fixture.itemIds[0]!.toUpperCase()],
      comment: "  Ａ idempotent transfer  ",
    }, { ...actor, userId: actor.userId.toUpperCase() }, "tmc-db-replay-001");
    const replay = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[0]!],
      comment: "A idempotent transfer",
    }, actor, "tmc-db-replay-001");
    expect(first.kind).toBe("completed");
    expect(replay).toEqual({ ...first, kind: "replayed" });
    expect(await requestCount()).toBe(requestsBefore + 1);

    const noResource = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [randomUUID()],
    }, actor, "tmc-db-no-resource-1");
    const retention = await database.query<{
      idempotency_key: string;
      is_infinite: boolean;
      resource_id: string | null;
    }>(
      `select idempotency_key,
              expires_at = 'infinity'::timestamptz as is_infinite,
              resource_id
         from "yu_inventory"."idempotency_requests"
        where actor_id = $1
          and operation = 'tmc.transfer_request.create'
          and idempotency_key = any($2::text[])
        order by idempotency_key`,
      [fixture.initiatorId, ["tmc-db-no-resource-1", "tmc-db-replay-001"]],
    );
    expect(noResource).toMatchObject({
      kind: "completed",
      result: { request: null, included: 0, problems: 1 },
      status: 200,
    });
    expect(retention.rows).toEqual([
      {
        idempotency_key: "tmc-db-no-resource-1",
        is_infinite: false,
        resource_id: null,
      },
      {
        idempotency_key: "tmc-db-replay-001",
        is_infinite: true,
        resource_id: first.resourceId,
      },
    ]);

    await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[1]!, fixture.itemIds[2]!],
    }, actor, "tmc-db-mismatch-01");
    await expect(createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[2]!, fixture.itemIds[1]!],
    }, actor, "tmc-db-mismatch-01")).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "idempotency_key_reused",
    });

    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstConcurrent = createService(async (_source, input) => {
      if (input.itemId !== fixture.itemIds[3]) return;
      enterFirst();
      await firstReleased;
    }).createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[3]!],
    }, actor, "tmc-db-concurrent-1");
    await firstEntered;
    await expect(
      createService().createIdempotent({
        recipientId: fixture.recipientIds[0]!,
        itemIds: [fixture.itemIds[3]!],
      }, actor, "tmc-db-concurrent-1"),
    ).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "idempotency_request_in_progress",
    });
    releaseFirst();
    const completedConcurrent = await firstConcurrent;
    const replayedConcurrent = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[3]!],
    }, actor, "tmc-db-concurrent-1");
    expect(completedConcurrent.kind).toBe("completed");
    expect(replayedConcurrent).toEqual({
      ...completedConcurrent,
      kind: "replayed",
    });

    let failCompletion = true;
    const faulty = createService(undefined, async () => {
      if (!failCompletion) return;
      failCompletion = false;
      throw new Error("injected_idempotency_completion_failure");
    });
    const requestsBeforeFailure = await requestCount();
    await expect(faulty.createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[4]!],
    }, actor, "tmc-db-rollback-001")).rejects.toThrow(
      "injected_idempotency_completion_failure",
    );
    expect(await requestCount()).toBe(requestsBeforeFailure);
    const rolledBackReservation = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."idempotency_requests"
        where actor_id = $1 and operation = 'tmc.transfer_request.create'
          and idempotency_key = 'tmc-db-rollback-001'`,
      [fixture.initiatorId],
    );
    expect(rolledBackReservation.rows[0]?.count).toBe(0);
    const retry = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[4]!],
    }, actor, "tmc-db-rollback-001");
    expect(retry.kind).toBe("completed");

    const adminId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Idempotency Administrator', 'admin', now(), now())`,
      [adminId, `IDEM-ADMIN-${adminId.slice(0, 8)}`, `${adminId}@example.com`],
    );
    const independentActor = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[5]!],
    }, { userId: adminId, role: "admin" }, "tmc-db-replay-001");
    expect(independentActor.kind).toBe("completed");
    const scopedRows = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."idempotency_requests"
        where operation = 'tmc.transfer_request.create'
          and idempotency_key = 'tmc-db-replay-001'`,
    );
    expect(scopedRows.rows[0]?.count).toBe(2);
  });
});

function createService(
  beforeInsert?: (
    source: PostgresRepositorySource,
    input: InsertTmcTransferRequestItemRecord,
  ) => Promise<void>,
  afterComplete?: (
    id: string,
    response: IdempotencyResponse,
  ) => Promise<void>,
) {
  const unitOfWork = new PostgresUnitOfWork<TmcOperationRepositories>(
    () => database,
    (source) => {
      const repositories = createPostgresTmcOperationRepositories(source);
      return {
        ...repositories,
        ...(afterComplete
          ? {
              idempotency: wrapIdempotency(
                repositories.idempotency,
                afterComplete,
              ),
            }
          : {}),
        ...(beforeInsert
          ? {
              transferRequests: wrapInsert(
                repositories.transferRequests,
                source,
                beforeInsert,
              ),
            }
          : {}),
      };
    },
    { retryBaseDelayMs: 1 },
  );
  return new TmcTransferRequestService(
    unitOfWork,
    { now: () => new Date() },
    { create: randomUUID },
  );
}

function wrapIdempotency(
  repository: IdempotencyRequestRepository,
  afterComplete: (
    id: string,
    response: IdempotencyResponse,
  ) => Promise<void>,
): IdempotencyRequestRepository {
  return {
    reserve: repository.reserve.bind(repository),
    async complete(id, response) {
      await repository.complete(id, response);
      await afterComplete(id, response);
    },
  };
}

function wrapInsert(
  repository: TmcTransferRequestRepository,
  source: PostgresRepositorySource,
  beforeInsert: (
    source: PostgresRepositorySource,
    input: InsertTmcTransferRequestItemRecord,
  ) => Promise<void>,
): TmcTransferRequestRepository {
  return {
    findUserById: repository.findUserById.bind(repository),
    findCandidates: repository.findCandidates.bind(repository),
    findById: repository.findById.bind(repository),
    findByIdForUpdate: repository.findByIdForUpdate.bind(repository),
    findItemPhoto: repository.findItemPhoto.bind(repository),
    decideItem: repository.decideItem.bind(repository),
    closeRequest: repository.closeRequest.bind(repository),
    cancelRequest: repository.cancelRequest.bind(repository),
    insertRequest: repository.insertRequest.bind(repository),
    async insertRequestItem(input) {
      await beforeInsert(source, input);
      return repository.insertRequestItem(input);
    },
  };
}

async function seedFixture(itemCount: number) {
  const initiatorId = randomUUID();
  const recipientIds = [randomUUID(), randomUUID()];
  const buildingId = randomUUID();
  const roomId = randomUUID();
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values
       ($1, $4, $5, 'Transaction Initiator', 'employee', now(), now()),
       ($2, $6, $7, 'Transaction Recipient A', 'employee', now(), now()),
       ($3, $8, $9, 'Transaction Recipient B', 'employee', now(), now())`,
    [
      initiatorId,
      ...recipientIds,
      `TX-I-${initiatorId.slice(0, 8)}`,
      `${initiatorId}@example.com`,
      `TX-A-${recipientIds[0]!.slice(0, 8)}`,
      `${recipientIds[0]}@example.com`,
      `TX-B-${recipientIds[1]!.slice(0, 8)}`,
      `${recipientIds[1]}@example.com`,
    ],
  );
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Transaction Building', $2, 'Transaction Address', $2, $3, $3)`,
    [buildingId, `tx-${buildingId}`, initiatorId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Transaction Room', $3, 1, $4, $4)`,
    [roomId, buildingId, `tx-${roomId}`, initiatorId],
  );
  const itemIds: string[] = [];
  const periodIds: string[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const itemId = randomUUID();
    itemIds.push(itemId);
    const periodId = randomUUID();
    periodIds.push(periodId);
    await database.query(
      `insert into "yu_inventory"."items"
         (id, name, room_id, inventory_number_kind, inventory_number,
          inventory_number_key, created_by, updated_by)
       values ($1, $2, $3, 'official', $4, $5, $6, $6)`,
      [
        itemId,
        `Transaction Item ${index + 1}`,
        roomId,
        `TX-ITEM-${itemId}`,
        `tx-item-${itemId}`,
        initiatorId,
      ],
    );
    await database.query(
      `insert into "yu_inventory"."responsibility_periods"
         (id, item_id, responsible_user_id, source, started_by)
       values ($1, $2, $3, 'transfer', $3)`,
      [periodId, itemId, initiatorId],
    );
  }
  return { initiatorId, recipientIds, itemIds, periodIds };
}

async function expectPersistedRequest(requestId: string, itemCount: number) {
  const persisted = await database.query<{ items: number }>(
    `select count(request_item.id)::int as items
       from "yu_inventory"."tmc_transfer_requests" request
       left join "yu_inventory"."tmc_transfer_request_items" request_item
         on request_item.request_id = request.id
      where request.id = $1
      group by request.id`,
    [requestId],
  );
  expect(persisted.rows[0]?.items).toBe(itemCount);
}

async function requestCount() {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count
       from "yu_inventory"."tmc_transfer_requests"`,
  );
  return result.rows[0]?.count ?? 0;
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
