import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TransferDto } from "../lib/contracts/inventory-responsibility";
import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryTransferListGetHandler } from "../lib/server/http/inventory-transfer-list-handler";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "employee" as const,
  sessionVersion: 7,
};

test("transfer collection forwards the complete actor and is explicitly private", async () => {
  const calls: unknown[] = [];
  const handler = createInventoryTransferListGetHandler({
    authenticate: async () => ACTOR,
    listTransfers: async (actor) => {
      calls.push(actor);
      return [transferDto()];
    },
  });

  const response = await handler(request());

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0, must-revalidate",
  );
  assert.deepEqual(await response.json(), { transfers: [transferDto()] });
  assert.deepEqual(calls, [ACTOR]);
});

test("transfer collection preserves private caching and safe Retry-After on errors", async () => {
  const outcomes: unknown[] = [
    new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "9" },
    }),
    new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "\r\nunsafe" },
    }),
    new Error("database secret"),
  ];
  const handler = createInventoryTransferListGetHandler({
    authenticate: async () => {
      throw outcomes.shift();
    },
    listTransfers: async () => {
      throw new Error("must_not_run");
    },
  });

  const limited = await handler(request());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "9");
  assert.match(limited.headers.get("cache-control") ?? "", /private/);
  assert.match(limited.headers.get("cache-control") ?? "", /no-store/);

  const unsafe = await handler(request());
  assert.equal(unsafe.status, 429);
  assert.equal(unsafe.headers.get("retry-after"), null);

  const unavailable = await handler(request());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "transfer_unavailable" });
  assert.match(unavailable.headers.get("cache-control") ?? "", /no-store/);
});

test("GET route keeps complete session actor while POST remains separately wired", async () => {
  const source = await readFile("app/api/inventory/transfers/route.ts", "utf8");
  assert.match(source, /createInventoryTransferListGetHandler/);
  assert.match(source, /authenticate:\s*requireCurrentUser/);
  assert.match(source, /export async function POST/);
  assert.match(source, /requestTransfer/);
});

function request() {
  return new Request("https://example.test/api/inventory/transfers?userId=attacker", {
    method: "GET",
    headers: { "x-user-id": "attacker" },
  });
}

function transferDto(): TransferDto {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    itemId: "33333333-3333-4333-8333-333333333333",
    itemName: "Laptop",
    itemInventoryNumber: "INV-1",
    requestedByName: "Requester",
    status: "pending_current_owner",
    requestedAt: "2026-08-13T07:00:00.000Z",
    closedAt: null,
    decisionComment: null,
    version: 1,
    direction: "incoming",
  };
}
