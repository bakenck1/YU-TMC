import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

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
});
