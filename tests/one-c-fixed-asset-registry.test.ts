import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Pool } from "pg";
import ts from "typescript";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { getFixedAssetRegistryPage } from "@/lib/server/one-c-fixed-asset-registry";

test("OS list reads only current on-balance assets and searches the entire registry with bound parameters", async () => {
  const db = { query: async (sql: string, values: unknown[]) => {
    assert.match(sql, /one_c_fixed_asset_inbox/);
    assert.ok(!sql.includes("batch"), "historical import batches cannot restrict the current registry");
    assert.ok(sql.includes("i.payload->>'status' = 'Принято к учёту'"));
    assert.ok(sql.includes("responsibleName"));
    assert.ok(sql.includes("inventoryNumber"));
    assert.ok(sql.includes("barcode"));
    assert.ok(sql.includes("select count(*)::int from filtered"));
    assert.ok(!sql.includes("Тынымбаев"));
    assert.deepEqual(values, ["%Тынымбаев\\%\\_%", 50, 100]);
    return { rows: [{ data: [], total: 6500 }] };
  } } as unknown as Pick<Pool, "query">;
  assert.deepEqual(await getFixedAssetRegistryPage({ page: 3, pageSize: 50, search: "Тынымбаев%_" }, db), { data: [], total: 6500, page: 3, pageSize: 50 });
});

test("OS list can include every current 1C status without limiting the search", async () => {
  const db = { query: async (sql: string, values: unknown[]) => {
    assert.ok(sql.includes("where true"));
    assert.ok(!sql.includes("Принято к учёту"));
    assert.ok(sql.includes("responsibleName"));
    assert.deepEqual(values, ["%Ермек%", 50, 0]);
    return { rows: [{ data: [], total: 10636 }] };
  } } as unknown as Pick<Pool, "query">;
  assert.equal((await getFixedAssetRegistryPage({ page: 1, pageSize: 50, search: "Ермек", scope: "all" }, db)).total, 10636);
});

function loadRoute(authenticate: () => Promise<unknown>, query: (...args: unknown[]) => Promise<unknown>) {
  const source = ts.transpileModule(readFileSync("app/api/integrations/1c/assets/registry/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const deps: Record<string, unknown> = {
    "@/lib/domain/application-error": { ApplicationError },
    "@/lib/server/http/error-response": { applicationErrorResponse },
    "@/lib/server/security/request-user": { requirePermission: authenticate },
    "@/lib/server/one-c-fixed-asset-registry": { getFixedAssetRegistryPage: query },
  };
  new Function("require", "exports", source)((id: string) => { assert.ok(id in deps); return deps[id]; }, exports);
  return exports as { GET: (request: Request) => Promise<Response> };
}

test("OS registry denies private data before any read and validates pagination and search", async () => {
  let reads = 0;
  const query = async (parameters: unknown) => {
    reads++;
    assert.deepEqual(parameters, { page: 2, pageSize: 100, search: "2411/00390", scope: "active" });
    return { data: [], total: 0 };
  };
  const request = (queryString = "") => new Request(`https://inventory.example/api/integrations/1c/assets/registry?${queryString}`);
  const denied = loadRoute(async () => { throw new ApplicationError("forbidden", "forbidden"); }, query);
  assert.equal((await denied.GET(request())).status, 403);
  assert.equal(reads, 0);
  const allowed = loadRoute(async () => ({}), query);
  for (const value of ["page=0", "page=-1", "page=1.5", "page=1000001", "pageSize=20", "scope=retired", `search=${"a".repeat(256)}`]) {
    assert.equal((await allowed.GET(request(value))).status, 400);
  }
  assert.equal(reads, 0);
  const response = await allowed.GET(request("page=2&pageSize=100&search=2411%2F00390"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.equal(reads, 1);
});

test("OS registry forwards all-status scope", async () => {
  const route = loadRoute(async () => ({}), async (parameters: unknown) => {
    assert.deepEqual(parameters, { page: 1, pageSize: 50, search: "", scope: "all" });
    return { data: [], total: 0, page: 1, pageSize: 50 };
  });
  assert.equal((await route.GET(new Request("https://inventory.example/api/integrations/1c/assets/registry?scope=all"))).status, 200);
});
