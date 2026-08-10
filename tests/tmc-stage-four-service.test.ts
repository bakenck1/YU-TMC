import assert from "node:assert/strict";
import test from "node:test";

import type {
  TmcOperationRepositories,
  TmcStageFourRepository,
  TmcTransferHistoryQuery,
  TmcTransferRequestRecord,
} from "../lib/application/ports/tmc-operation-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { TmcTransferRequestService } from "../lib/application/services/tmc-transfer-request-service";
import { ApplicationError } from "../lib/domain/application-error";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-10T12:00:00.000Z");

test("history is scoped to participants for employees and can include all for admins", async () => {
  const stageFour = new MemoryStageFourRepository();
  const service = createService(stageFour);

  const employeeHistory = await service.listHistory({ status: "pending", overdue: true, limit: 25 }, {
    userId: USER_ID,
    role: "employee",
  });
  await service.listHistory({}, { userId: USER_ID, role: "admin" });

  assert.equal(employeeHistory.locationChanges[0]?.occurredAt, NOW.toISOString());

  assert.deepEqual(stageFour.historyQueries.map((query) => ({
    actorId: query.actorId,
    includeAll: query.includeAll,
    status: query.status,
    overdue: query.overdue,
    limit: query.limit,
  })), [
    { actorId: USER_ID, includeAll: false, status: "pending", overdue: true, limit: 26 },
    { actorId: USER_ID, includeAll: true, status: undefined, overdue: undefined, limit: 51 },
  ]);
});

test("history only exposes a snapshot participant's own items from a multi-owner request", async () => {
  const stageFour = new MemoryStageFourRepository();
  const request = historyRequest([
    historyItem(USER_ID, "Owned item", "INV-OWN"),
    historyItem(OTHER_ID, "Foreign item", "INV-FOREIGN"),
  ]);
  stageFour.history = [request];
  const service = createService(stageFour);

  const result = await service.listHistory({}, {
    userId: USER_ID,
    role: "employee",
  });

  assert.deepEqual(
    result.requests[0]?.items.map((item) => item.currentResponsibleIdAtRequest),
    [USER_ID],
  );
  assert.equal(result.requests[0]?.summary.total, 1);

  for (const actor of [
    { userId: request.initiator.id, role: "employee" as const },
    { userId: request.recipient.id, role: "employee" as const },
    { userId: "abababab-abab-4bab-8bab-abababababab", role: "admin" as const },
  ]) {
    const full = await service.listHistory({}, actor);
    assert.equal(full.requests[0]?.items.length, 2);
    assert.equal(full.requests[0]?.summary.total, 2);
  }
});

test("snapshot-only history derives status from the participant's items instead of foreign siblings", async () => {
  const stageFour = new MemoryStageFourRepository();
  stageFour.history = [historyRequest([
    terminalHistoryItem(USER_ID, "Owned item", "INV-OWN", "rejected"),
    terminalHistoryItem(OTHER_ID, "Foreign item", "INV-FOREIGN", "accepted"),
  ], {
    status: "accepted",
    closedAt: NOW,
    closedBy: historyUser("abababab-abab-4bab-8bab-abababababab", "Decider", "employee"),
  })];

  const result = await createService(stageFour).listHistory({}, {
    userId: USER_ID,
    role: "employee",
  });

  assert.equal(result.requests[0]?.status, "rejected");
  assert.equal(result.requests[0]?.overdue, false);
});

test("history rejects unknown identities, impossible periods, invalid ids and excessive limits", async () => {
  const stageFour = new MemoryStageFourRepository();
  const service = createService(stageFour);
  const actor = { userId: USER_ID, role: "employee" as const };

  for (const filters of [
    { createdFrom: "2026-08-11T00:00:00.000Z", createdTo: "2026-08-10T00:00:00.000Z" },
    { itemId: "not-a-uuid" },
    { limit: 51 },
    { requestCursor: "bad!" },
  ]) {
    await assert.rejects(
      service.listHistory(filters, actor),
      (error: unknown) => error instanceof ApplicationError && error.kind === "validation",
    );
  }
  assert.equal(stageFour.historyQueries.length, 0);
});

test("notification feed is actor-scoped and admin queue is visible only to admins", async () => {
  const stageFour = new MemoryStageFourRepository();
  const service = createService(stageFour);

  const feed = await service.listNotifications({ userId: USER_ID, role: "employee" }, 10);
  assert.equal(feed.unreadCount, 1);
  assert.equal(feed.notifications[0]?.requestId, REQUEST_ID);
  assert.equal(stageFour.notificationQueries[0]?.includeAdminQueue, false);

  await service.listNotifications({ userId: USER_ID, role: "admin" }, 10);
  assert.equal(stageFour.notificationQueries[1]?.includeAdminQueue, true);
});

test("marking a notification read hides BOLA as not found", async () => {
  const stageFour = new MemoryStageFourRepository();
  const service = createService(stageFour);
  const actor = { userId: USER_ID, role: "employee" as const };

  await service.markNotificationRead("44444444-4444-4444-8444-444444444444", actor);
  stageFour.markResult = false;
  await assert.rejects(
    service.markNotificationRead("55555555-5555-4555-8555-555555555555", actor),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );
  assert.equal(stageFour.markCalls[0]?.actorId, USER_ID);
  assert.equal(stageFour.markCalls[0]?.includeAdminQueue, false);
});

function createService(stageFour: MemoryStageFourRepository) {
  const repositories = {
    stageFour,
    idempotency: {},
    transferRequests: {},
  } as unknown as TmcOperationRepositories;
  const unitOfWork: UnitOfWork<TmcOperationRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  return new TmcTransferRequestService(
    unitOfWork,
    { now: () => NOW },
    { create: () => "99999999-9999-4999-8999-999999999999" },
  );
}

class MemoryStageFourRepository implements TmcStageFourRepository {
  history: TmcTransferRequestRecord[] = [];
  historyQueries: TmcTransferHistoryQuery[] = [];
  locationHistoryQueries: TmcTransferHistoryQuery[] = [];
  notificationQueries: Array<{ actorId: string; includeAdminQueue: boolean; now: Date; limit: number }> = [];
  markCalls: Array<{ notificationId: string; actorId: string; includeAdminQueue: boolean; readAt: Date }> = [];
  markResult = true;

  async listHistory(input: TmcTransferHistoryQuery): Promise<TmcTransferRequestRecord[]> {
    this.historyQueries.push(input);
    return this.history;
  }
  async listLocationHistory(input: TmcTransferHistoryQuery) {
    this.locationHistoryQueries.push(input);
    return [{
      id: "66666666-6666-4666-8666-666666666666", itemId: "77777777-7777-4777-8777-777777777777",
      itemName: "Laptop", inventoryNumber: "INV-1", actorId: USER_ID, actorName: "User",
      beforeRoomId: "88888888-8888-4888-8888-888888888888", beforeLocation: "A / 101",
      afterRoomId: "99999999-9999-4999-8999-999999999999", afterLocation: "B / 202",
      comment: "move", occurredAt: NOW,
    }];
  }
  async appendAudit() {}
  async createNotification() {}
  async listNotifications(input: { actorId: string; includeAdminQueue: boolean; now: Date; limit: number }) {
    this.notificationQueries.push(input);
    return [{
      id: "44444444-4444-4444-8444-444444444444",
      type: "tmc_transfer.requested" as const,
      requestId: REQUEST_ID,
      itemId: null,
      safePayload: { itemCount: 2 },
      occurredAt: NOW,
      readAt: null,
    }];
  }
  async countUnreadNotifications() { return 1; }
  async markNotificationRead(input: { notificationId: string; actorId: string; includeAdminQueue: boolean; readAt: Date }) {
    this.markCalls.push(input);
    return this.markResult;
  }
}

function historyRequest(
  items: TmcTransferRequestRecord["items"],
  overrides: Partial<TmcTransferRequestRecord> = {},
): TmcTransferRequestRecord {
  return {
    id: REQUEST_ID,
    initiator: historyUser("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Administrator", "admin"),
    recipient: historyUser("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Recipient", "employee"),
    status: "pending",
    comment: null,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    closedAt: null,
    closedBy: null,
    isAdministrativeDecision: false,
    administrativeReason: null,
    version: 1,
    ...overrides,
    items,
  };
}

function historyItem(ownerId: string, name: string, inventoryNumber: string): TmcTransferRequestRecord["items"][number] {
  const itemId = ownerId === USER_ID
    ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    : "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  return {
    id: ownerId === USER_ID
      ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
      : "ffffffff-ffff-4fff-8fff-ffffffffffff",
    requestId: REQUEST_ID,
    itemId,
    item: {
      id: itemId,
      version: 1,
      name,
      inventoryNumber,
      quantity: 1,
      unitPrice: 100,
      photoUrl: null,
      buildingId: "12121212-1212-4212-8212-121212121212",
      buildingName: "Building",
      roomId: "13131313-1313-4313-8313-131313131313",
      roomDesignation: "101",
    },
    responsibilityPeriodIdAtRequest: ownerId === USER_ID
      ? "14141414-1414-4414-8414-141414141414"
      : "15151515-1515-4515-8515-151515151515",
    currentResponsibleIdAtRequest: ownerId,
    responsibleUserProfile: historyUser(ownerId, name, "employee"),
    result: "pending",
    invalidReason: null,
    createdAt: NOW,
    decidedAt: null,
    decidedBy: null,
    version: 1,
  };
}

function historyUser(id: string, fullName: string, role: "admin" | "employee") {
  return { id, fullName, email: `${id}@example.test`, role };
}

function terminalHistoryItem(
  ownerId: string,
  name: string,
  inventoryNumber: string,
  result: "accepted" | "rejected",
): TmcTransferRequestRecord["items"][number] {
  return {
    ...historyItem(ownerId, name, inventoryNumber),
    result,
    decidedAt: NOW,
    decidedBy: historyUser("abababab-abab-4bab-8bab-abababababab", "Decider", "employee"),
  };
}
