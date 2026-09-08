import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, requestCount, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

describe("TMC transfer request transactions", () => {
  beforeAll(setupTmcTransferDatabase);
  afterAll(teardownTmcTransferDatabase);

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
