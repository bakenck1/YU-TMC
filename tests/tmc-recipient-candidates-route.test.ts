import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { TmcOperationUserDto } from "../lib/contracts/tmc-operations";
import { ApplicationError } from "../lib/domain/application-error";
import { createTmcRecipientCandidatesGetHandler } from "../lib/server/http/tmc-recipient-candidates-handler";
import { hasPermission } from "../lib/security/permissions";

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", role: "employee" as const };
const RESULT: TmcOperationUserDto = { id: "22222222-2222-4222-8222-222222222222", fullName: "Demo User 5", email: "demo-user-5@example.test", role: "admin" };

test("recipient route uses the TMC permission without widening the admin users endpoint", () => {
  const route = readFileSync("app/api/inventory/transfer-recipient-candidates/route.ts", "utf8");
  const legacyUsersRoute = readFileSync("app/api/users/route.ts", "utf8");
  assert.match(route, /requirePermission\(request, "inventory\.tmc\.transfer_request\.create"\)/);
  assert.match(route, /searchTmcRecipients\(query, actorUserId\)/);
  assert.match(legacyUsersRoute, /requirePermission\(request, "legacy\.users\.read"\)/);
  for (const role of ["admin", "warehouse", "employee"] as const) {
    assert.equal(hasPermission(role, "inventory.tmc.transfer_request.create"), true);
  }
});

test("recipient endpoint authenticates actor, normalizes query and returns only safe no-store DTOs", async () => {
  const calls: unknown[][] = [];
  const handler = createTmcRecipientCandidatesGetHandler({
    authenticate: async (request) => { calls.push(["auth", request.url]); return ACTOR; },
    search: async (query, actorId) => { calls.push(["search", query, actorId]); return [RESULT]; },
  });
  const response = await handler(new Request("https://example.test/api/inventory/transfer-recipient-candidates?q=%20%EF%BC%A1LI%20"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { users: [RESULT] });
  assert.deepEqual(calls, [["auth", "https://example.test/api/inventory/transfer-recipient-candidates?q=%20%EF%BC%A1LI%20"], ["search", "ali", ACTOR.userId]]);
  assert.equal(JSON.stringify(RESULT).includes("phone"), false);
});

test("recipient endpoint rejects oversized query before reading users", async () => {
  let searched = false;
  const handler = createTmcRecipientCandidatesGetHandler({
    authenticate: async () => ACTOR,
    search: async () => { searched = true; return []; },
  });
  const response = await handler(new Request(`https://example.test/api/inventory/transfer-recipient-candidates?q=${"a".repeat(65)}`));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "recipient_query_too_long" });
  assert.equal(searched, false);
});

test("recipient endpoint preserves auth errors and hides unexpected failures", async () => {
  for (const [error, status, code] of [
    [new ApplicationError("unauthorized", "unauthorized"), 401, "unauthorized"],
    [new ApplicationError("forbidden", "forbidden"), 403, "forbidden"],
    [new Error("database details"), 503, "recipient_search_unavailable"],
  ] as const) {
    const handler = createTmcRecipientCandidatesGetHandler({
      authenticate: async () => { throw error; },
      search: async () => [],
    });
    const response = await handler(new Request("https://example.test/api/inventory/transfer-recipient-candidates?q=ali"));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});
