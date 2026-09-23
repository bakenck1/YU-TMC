import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  DormitoryRequestRepository,
  DormitoryRequestResult,
} from "../lib/contracts/dormitory-requests";
import { createDormitoryRequest } from "../lib/dormitory-requests-api";

const WRITE_KEY = "dormitory-write-key-for-tests";
const ITEM_ID = "00000000-0000-4000-8000-000000000021";

function request(body: unknown, key = WRITE_KEY) {
  return new Request("https://inventory.example/api/v1/dormitory/requests", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const input = {
  externalRequestId: "dormitory-request-42",
  itemId: ITEM_ID,
  action: "repair",
  description: "Необходимо отремонтировать ножку кровати",
  reporterName: "Комендант общежития 3",
} as const;

function result(replayed = false): DormitoryRequestResult {
  return {
    id: "00000000-0000-4000-8000-000000000031",
    externalRequestId: input.externalRequestId,
    item: { id: ITEM_ID, name: "Кровать", inventoryNumber: "INV-42" },
    action: input.action,
    status: "new",
    createdAt: "2026-09-23T06:00:00.000Z",
    replayed,
  };
}

test.beforeEach(() => { process.env.DORMITORY_WRITE_API_KEY = WRITE_KEY; });
test.afterEach(() => { delete process.env.DORMITORY_WRITE_API_KEY_NEXT; });
test.after(() => { delete process.env.DORMITORY_WRITE_API_KEY; });

test("authenticates before reading or writing the request", async () => {
  let writes = 0;
  const repository: DormitoryRequestRepository = {
    async create() { writes += 1; return result(); },
  };
  const malformed = new Request("https://inventory.example/api/v1/dormitory/requests", {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json" },
    body: "not-json",
  });
  assert.equal((await createDormitoryRequest(malformed, { repository })).status, 401);
  assert.equal(writes, 0);
});

test("creates a visible maintenance request and schedules one notification", async () => {
  let accepted = 0;
  const repository: DormitoryRequestRepository = {
    async create(value, hash) {
      assert.deepEqual(value, input);
      assert.match(hash, /^[0-9a-f]{64}$/);
      return result();
    },
  };
  const response = await createDormitoryRequest(request(input), {
    repository,
    onAccepted(value, description) {
      accepted += 1;
      assert.equal(value.item.id, ITEM_ID);
      assert.equal(description, input.description);
    },
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).request.action, "repair");
  assert.equal(accepted, 1);
});

test("returns an idempotent replay without sending a duplicate notification", async () => {
  const repository: DormitoryRequestRepository = { async create() { return result(true); } };
  let accepted = 0;
  const response = await createDormitoryRequest(request(input), {
    repository,
    onAccepted() { accepted += 1; },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).request.replayed, true);
  assert.equal(accepted, 0);
});

test("rejects unsupported actions, unknown fields, and invalid item identifiers", async () => {
  const repository: DormitoryRequestRepository = { async create() { throw new Error("must not write"); } };
  for (const body of [
    { ...input, action: "write_off" },
    { ...input, itemId: "not-a-uuid" },
    { ...input, unexpected: true },
    { ...input, reporterName: "" },
  ]) {
    assert.equal((await createDormitoryRequest(request(body), { repository })).status, 400);
  }
});

test("migration keeps internal photo requirements and external idempotency", () => {
  const migration = readFileSync("drizzle/20260923062128_even_krista_starr.sql", "utf8");
  assert.match(migration, /service_requests_dormitory_external_unique/);
  assert.match(migration, /source[^]*= 'internal'[^]*photo_binary_data[^]*IS NOT NULL/);
  assert.match(migration, /requested_action[^]*repair[^]*damaged[^]*missing[^]*other/);
});
