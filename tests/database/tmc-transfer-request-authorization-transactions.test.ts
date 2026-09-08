import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { database, createService, requestCount, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

describe("TMC transfer request transactions", () => {
  beforeAll(setupTmcTransferDatabase);
  afterAll(teardownTmcTransferDatabase);

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
});
