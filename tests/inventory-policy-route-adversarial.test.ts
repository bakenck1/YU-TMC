import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { ApplicationError } from "../lib/domain/application-error";
import { isInventoryItemCategory } from "../lib/inventory-categories";
import { isEmployeeRole } from "../lib/contracts/users";

const ID = "10000000-0000-4000-8000-000000000001";
async function routeHarness(role: string) {
  const source = await readFile(new URL("../app/api/inventory/items/[id]/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: unknown[][] = [];
  const actor = { userId: ID, role };
  const deps: Record<string, unknown> = {
    "@/lib/contracts/users": { isEmployeeRole },
    "next/server": { after: () => undefined },
    "@/lib/server/whatsapp-tmc": {},
    "@/lib/domain/application-error": { ApplicationError },
    "@/lib/domain/identifiers": { isUuid: () => true },
    "@/lib/inventory-categories": { isInventoryItemCategory },
    "@/lib/it-inventory": {},
    "@/lib/server/application": { getApplicationServices: () => ({ items: {
      changeStatus: async (...args: unknown[]) => { calls.push(args); if (role !== "admin" && role !== "warehouse") throw new ApplicationError("forbidden", "forbidden"); return { id: ID, status: "active", responsible: { id: ID } }; },
      findItem: async () => ({ responsible: null }),
      updateProtected: async () => { throw new Error("wrong mutation"); },
      updateContent: async () => { throw new Error("wrong mutation"); },
    } }) },
    "@/lib/server/http/error-response": { applicationErrorResponse: (error: ApplicationError) => Response.json({ error: error.publicCode }, { status: error.kind === "forbidden" ? 403 : 400 }) },
    "@/lib/server/http/photo-request": { assertPhotoJsonRequest: () => undefined, readPhotoJsonRequest: (r: Request) => r.json() },
    "@/lib/server/http/request-body": {},
    "@/lib/server/security/request-user": { requireCurrentUser: async () => actor, authorizationActor: (user: unknown) => user },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", code)((name: string) => { if (!(name in deps)) throw new Error("missing route dependency " + name); return deps[name]; }, exports);
  const patch = exports.PATCH as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  return { calls, actor, patch: (body: unknown) => patch(new Request("https://example.test/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) }) };
}
for (const role of ["admin", "warehouse", "employee", "typography"]) {
  test("attack: status PATCH passes authenticated " + role + " and rejects unauthorized repair", async () => {
    const h = await routeHarness(role); const response = await h.patch({ operation: "change_status", version: 1, status: "active" });
    assert.equal(response.status, role === "admin" || role === "warehouse" ? 200 : 403);
    assert.deepEqual(h.calls[0], [ID, { operation: "change_status", version: 1, status: "active" }, h.actor]);
  });
}
for (const fields of [{ responsibleUserId: ID }, { roomId: ID }, { inventoryNumber: "ATTACK" }, { role: "admin" }, { replaceQr: true }, { category: "electronics" }]) {
  test("attack: status PATCH rejects mass assignment " + Object.keys(fields).join(), async () => {
    const h = await routeHarness("warehouse"); const response = await h.patch({ operation: "change_status", version: 1, status: "active", ...fields });
    assert.equal(response.status, 400); assert.equal(h.calls.length, 0);
  });
}
for (const version of [0, -1, 1.5, "1", null, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
  test("attack: status PATCH rejects invalid revision " + String(version) + " before calling service", async () => {
    const h = await routeHarness("admin"); const response = await h.patch({ operation: "change_status", version, status: "active" });
    assert.equal(response.status, 400); assert.equal(h.calls.length, 0);
  });
}

async function createRouteHarness() {
  const source = await readFile(new URL("../app/api/inventory/items/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: Array<{ status?: string }> = [];
  const deps: Record<string, unknown> = {
    "next/server": { after: () => undefined },
    "@/lib/server/whatsapp-tmc": {},
    "@/lib/inventory-categories": { isInventoryItemCategory },
    "@/lib/domain/application-error": { ApplicationError },
    "@/lib/server/application": { getApplicationServices: () => ({ items: { createItem: async (input: { status?: string }) => { calls.push(input); return { id: ID, status: input.status }; } } }) },
    "@/lib/server/http/error-response": { applicationErrorResponse: (error: ApplicationError) => Response.json({ error: error.publicCode }, { status: 400 }) },
    "@/lib/server/security/request-user": { requireCurrentUser: async () => ({ userId: ID, role: "admin" }), authorizationActor: (user: unknown) => user },
    "@/lib/server/http/photo-request": { assertPhotoJsonRequest: () => undefined, readPhotoJsonRequest: (request: Request) => request.json() },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", code)((name: string) => { if (!(name in deps)) throw new Error("missing route dependency " + name); return deps[name]; }, exports);
  const post = exports.POST as (request: Request) => Promise<Response>;
  return { calls, post: (status: unknown) => post(new Request("https://example.test/api/inventory/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cable", category: "components", roomId: ID, status, photos: [{ imageDataUrl: "data:image/jpeg;base64,eA==", width: 1, height: 1 }] }) })) };
}
for (const status of ["active", "broken", "maintenance", "decommissioned", "decommissioned_in_use"]) {
  test(`creation route accepts selected lifecycle status ${status}`, async () => {
    const h = await createRouteHarness();
    const response = await h.post(status);
    assert.equal(response.status, 201);
    assert.equal(h.calls[0]?.status, status);
    assert.equal((await response.json()).item.status, status);
  });
}
for (const status of ["invalid-status", null, 1, {}, ["active"]]) {
  test(`creation route rejects invalid lifecycle status ${JSON.stringify(status)}`, async () => {
    const h = await createRouteHarness();
    assert.equal((await h.post(status)).status, 400);
    assert.equal(h.calls.length, 0);
  });
}
