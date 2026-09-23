import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { DormitoryAsset, DormitoryAssetRepository } from "../lib/contracts/dormitory-api";
import { dormitoryAuthCheck, listDormitoryAssets } from "../lib/dormitory-api";

const API_KEY = "dormitory-key-for-automated-tests";

function request(path: string, key = API_KEY) {
  return new Request(`https://inventory.example${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
}

function item(id: string, updatedAt: string): DormitoryAsset {
  return {
    id,
    code: "000009352",
    inventoryNumber: "INV-9352",
    name: "Кровать",
    category: "Мебель",
    acceptanceDate: "2025-11-20",
    responsiblePerson: "Материально ответственное лицо",
    department: "Студенческий кампус",
    location: {
      buildingId: "00000000-0000-4000-8000-000000000010",
      buildingName: "Общежитие 3",
      roomId: "00000000-0000-4000-8000-000000000011",
      room: "205",
      floorNumber: 2,
    },
    initialCost: 50_000,
    residualCost: 30_000,
    currency: "KZT",
    status: "active",
    condition: "good",
    accountingStatus: "Принято к учёту",
    updatedAt,
  };
}

test.beforeEach(() => {
  process.env.DORMITORY_API_KEY = API_KEY;
});

test.afterEach(() => {
  delete process.env.DORMITORY_API_KEY_NEXT;
});

test.after(() => {
  delete process.env.DORMITORY_API_KEY;
});

test("uses an isolated read-only key with a rotation slot", async () => {
  assert.deepEqual(await dormitoryAuthCheck(request("/api/v1/dormitory/auth/check")).json(), {
    valid: true,
    scope: "dormitory-assets:read",
  });
  assert.equal(dormitoryAuthCheck(request("/api/v1/dormitory/auth/check", "wrong")).status, 401);

  process.env.DORMITORY_API_KEY_NEXT = "next-dormitory-key";
  assert.equal(
    dormitoryAuthCheck(request("/api/v1/dormitory/auth/check", "next-dormitory-key")).status,
    200,
  );
});

test("authorizes before repository access and fails closed when unconfigured", async () => {
  let accessed = false;
  const repository: DormitoryAssetRepository = {
    async listItems() { accessed = true; return []; },
  };
  assert.equal((await listDormitoryAssets(request("/api/v1/dormitory/items", "wrong"), repository)).status, 401);
  assert.equal(accessed, false);

  delete process.env.DORMITORY_API_KEY;
  assert.equal((await listDormitoryAssets(request("/api/v1/dormitory/items"), repository)).status, 503);
  assert.equal(accessed, false);
});

test("returns a bounded page and accepts its opaque cursor", async () => {
  const first = item("00000000-0000-4000-8000-000000000021", "2026-09-22T08:00:00.000Z");
  const second = item("00000000-0000-4000-8000-000000000022", "2026-09-21T08:00:00.000Z");
  const third = item("00000000-0000-4000-8000-000000000023", "2026-09-20T08:00:00.000Z");
  const pages: DormitoryAssetRepository = {
    async listItems(page) {
      assert.equal(page.limit, 3);
      return page.after ? [] : [first, second, third];
    },
  };
  const response = await listDormitoryAssets(
    request("/api/v1/dormitory/items?limit=2"),
    pages,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { items: DormitoryAsset[]; nextCursor: string };
  assert.deepEqual(body.items, [first, second]);
  assert.equal(typeof body.nextCursor, "string");

  const next = await listDormitoryAssets(
    request(`/api/v1/dormitory/items?limit=2&cursor=${body.nextCursor}`),
    pages,
  );
  assert.equal(next.status, 200);
});

test("rejects unknown, duplicate, and out-of-range pagination parameters", async () => {
  const repository: DormitoryAssetRepository = { async listItems() { return []; } };
  for (const path of [
    "/api/v1/dormitory/items?all=true",
    "/api/v1/dormitory/items?limit=0",
    "/api/v1/dormitory/items?limit=201",
    "/api/v1/dormitory/items?limit=1&limit=2",
    "/api/v1/dormitory/items?cursor=invalid",
  ]) {
    assert.equal((await listDormitoryAssets(request(path), repository)).status, 400);
  }
});

test("returns a controlled dependency error without leaking database details", async () => {
  const repository: DormitoryAssetRepository = {
    async listItems() { throw new Error("password=private"); },
  };
  const response = await listDormitoryAssets(request("/api/v1/dormitory/items"), repository);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.doesNotMatch(await response.text(), /password|private/i);
});

test("PostgreSQL projection is restricted to the maintained dormitory name set", () => {
  const source = readFileSync(
    "lib/server/persistence/postgres/postgres-dormitory-asset-repository.ts",
    "utf8",
  );
  assert.match(source, /b\.name = any\(\$1::text\[\]\)/);
  assert.match(source, /off-campus-dormitory-/);
  assert.match(source, /decommissioned_in_use[^]*written_off/);
});
