import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, expectPersistedRequest, requestCount, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

describe("TMC transfer request transactions", () => {
  beforeAll(setupTmcTransferDatabase);
  afterAll(teardownTmcTransferDatabase);

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
});
