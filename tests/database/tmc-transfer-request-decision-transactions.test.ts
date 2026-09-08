import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

describe("TMC transfer request transactions", () => {
  beforeAll(setupTmcTransferDatabase);
  afterAll(teardownTmcTransferDatabase);

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
});
