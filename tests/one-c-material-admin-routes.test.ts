import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadRoute(path: string, authenticate: () => Promise<unknown>, query: (...args: unknown[]) => Promise<unknown> = async () => ({ data: [], total: 0 }), matched: () => unknown[] = () => []) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const deps: Record<string, unknown> = {
    "@/lib/domain/application-error": { ApplicationError },
    "@/lib/server/http/error-response": { applicationErrorResponse },
    "@/lib/server/security/request-user": { requirePermission: authenticate },
    "@/lib/server/one-c-material-registry": { getMaterialRegistryPage: query, getMaterialRegistryMetadata: query },
    "@/lib/server/one-c-analytics-service": { getOneCAnalyticsSnapshot: query },
    "@/lib/one-c-matched-cards": { getOneCMatchedCards: matched },
    "@/lib/server/excel/one-c-analytics-excel": { exportOneCAnalyticsExcel: async () => new Uint8Array([80, 75, 3, 4]) },
  };
  new Function("require", "exports", source)((id: string) => {
    assert.ok(id in deps, `Unexpected dependency: ${id}`);
    return deps[id];
  }, exports);
  return exports as Record<"GET" | "POST", (request: Request) => Promise<Response>>;
}

test("matched-card list requires permission and validates query before reading inventory", async () => {
  let reads = 0;
  const query = async () => { reads++; return {}; };
  const path = "app/api/integrations/1c/analytics/matched/route.ts";
  const denied = loadRoute(path, async () => { throw new ApplicationError("forbidden", "forbidden"); }, query);
  assert.equal((await denied.GET(new Request("https://inventory.example/api?group=materials"))).status, 403);
  const allowed = loadRoute(path, async () => ({}), query);
  for (const params of ["group=other", "page=0", "pageSize=500", "search=" + "x".repeat(256)]) {
    assert.equal((await allowed.GET(new Request(`https://inventory.example/api?${params}`))).status, 400);
  }
  assert.equal(reads, 0);
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
