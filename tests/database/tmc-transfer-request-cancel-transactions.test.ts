import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

describe("TMC transfer request transactions", () => {
  beforeAll(setupTmcTransferDatabase);
  afterAll(teardownTmcTransferDatabase);

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
});
