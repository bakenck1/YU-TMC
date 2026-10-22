import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

function loadRoute(path: string, authenticate: () => Promise<unknown>, query: (...args: unknown[]) => Promise<unknown> = async () => ({ data: [], total: 0 })) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const deps: Record<string, unknown> = {
    "@/lib/domain/application-error": { ApplicationError },
    "@/lib/server/http/error-response": { applicationErrorResponse },
    "@/lib/server/security/request-user": { requirePermission: authenticate },
    "@/lib/server/one-c-material-registry": { getMaterialRegistryPage: query, getMaterialRegistryMetadata: query },
    "@/lib/server/one-c-analytics-service": { getOneCAnalyticsSnapshot: query },
    "@/lib/server/excel/one-c-analytics-excel": { exportOneCAnalyticsExcel: async () => new Uint8Array([80, 75, 3, 4]) },
  };
  new Function("require", "exports", source)((id: string) => {
    assert.ok(id in deps, `Unexpected dependency: ${id}`);
    return deps[id];
  }, exports);
  return exports as Record<"GET" | "POST", (request: Request) => Promise<Response>>;
}

test("material registry requires administrator permission before reading private source data", async () => {
  let reads = 0;
  const route = loadRoute("app/api/integrations/1c/materials/registry/route.ts", async () => { throw new ApplicationError("forbidden", "forbidden"); }, async () => { reads++; return { data: [], total: 0 }; });
  const response = await route.GET(new Request("https://inventory.example/api/integrations/1c/materials/registry"));
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("full analytics export checks permission before reading and returns a private XLSX attachment", async () => {
  let reads = 0;
  const query = async () => { reads++; return { analytics: { calculatedAt: "2026-10-22T05:00:00Z" } }; };
  const request = new Request("https://inventory.example/api/integrations/1c/analytics/export");
  const denied = loadRoute("app/api/integrations/1c/analytics/export/route.ts", async () => { throw new ApplicationError("forbidden", "forbidden"); }, query);
  assert.equal((await denied.GET(request)).status, 403);
  assert.equal(reads, 0);
  const allowed = loadRoute("app/api/integrations/1c/analytics/export/route.ts", async () => ({}), query);
  const response = await allowed.GET(request);
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.match(response.headers.get("content-type")!, /spreadsheetml.sheet/);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="1c-inventory-2026-10-22T05-00-00Z.xlsx"');
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await response.arrayBuffer()).byteLength, 4);
});

test("material registry validates bounded pagination and search before passing parameters to its reader", async () => {
  let reads = 0;
  const route = loadRoute("app/api/integrations/1c/materials/registry/route.ts", async () => ({}), async (value) => {
    reads++;
    assert.deepEqual(value, { page: 2, pageSize: 100, search: "00007692" });
    return { data: [], total: 0 };
  });
  for (const query of ["page=0", "page=1.5", "page=1000001", "pageSize=50000", `search=${"a".repeat(256)}`]) {
    assert.equal((await route.GET(new Request(`https://inventory.example/api/integrations/1c/materials/registry?${query}`))).status, 400);
  }
  assert.equal(reads, 0);
  assert.equal((await route.GET(new Request("https://inventory.example/api/integrations/1c/materials/registry?page=2&pageSize=100&search=00007692"))).status, 200);
  assert.equal(reads, 1);
});

test("retired Excel upload authenticates but never consumes an uploaded file or changes source data", async () => {
  let reads = 0;
  const route = loadRoute("app/api/integrations/1c/material-snapshot/route.ts", async () => ({}), async () => { reads++; return { data: [], total: 0 }; });
  const request = new Request("https://inventory.example/api/integrations/1c/material-snapshot", { method: "POST", body: "old xls data" });
  const response = await route.POST(request);
  assert.equal(response.status, 410);
  assert.equal(request.bodyUsed, false);
  assert.equal(reads, 0);
  assert.equal((await response.json()).error, "material_excel_upload_retired");
});
