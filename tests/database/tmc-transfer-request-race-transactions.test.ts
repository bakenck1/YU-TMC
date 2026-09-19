import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

describe("TMC transfer request transactions", () => {
  beforeAll(setupTmcTransferDatabase);
  afterAll(teardownTmcTransferDatabase);

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
    const cancellationDecisionBarrier = twoConnectionBarrier();
    const cancellationVsDecision = await Promise.allSettled([
      createService(undefined, undefined, cancellationDecisionBarrier.wait).cancelIdempotent(
        decisionRace.id,
        cancelInput,
        initiator,
        "tmc-db-cancel-decision-a",
      ),
      createService(undefined, undefined, cancellationDecisionBarrier.wait).decideIdempotent(
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
    expect(cancellationDecisionBarrier.backendPids).toHaveLength(2);

    const duplicateRace = (await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[1]!],
    }, initiator)).request!;
    const duplicateCancellationBarrier = twoConnectionBarrier();
    const duplicateCancellations = await Promise.allSettled([
      createService(undefined, undefined, duplicateCancellationBarrier.wait).cancelIdempotent(
        duplicateRace.id,
        { requestVersion: duplicateRace.version },
        initiator,
        "tmc-db-cancel-race-a",
      ),
      createService(undefined, undefined, duplicateCancellationBarrier.wait).cancelIdempotent(
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
    expect(duplicateCancellationBarrier.backendPids).toHaveLength(2);

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
});

function twoConnectionBarrier() {
  const backendPids: number[] = [];
  let release!: () => void;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    backendPids,
    wait: async (source: PostgresRepositorySource) => {
      if (backendPids.length >= 2) return;
      const result = await source.query<{ backendPid: number }>(
        'select pg_backend_pid()::int as "backendPid"',
      );
      const backendPid = result.rows[0]?.backendPid;
      if (!backendPid || backendPids.includes(backendPid)) {
        release();
        throw new Error("race_barrier_requires_distinct_postgres_connections");
      }
      backendPids.push(backendPid);
      if (backendPids.length === 2) release();
      await bothArrived;
    },
  };
}
