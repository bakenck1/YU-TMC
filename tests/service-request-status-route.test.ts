import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { ServiceRequestDto } from "../lib/contracts/service-requests";
import { ApplicationError } from "../lib/domain/application-error";
import { createServiceRequestStatusPatchHandler } from "../lib/server/http/service-request-status-handler";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const BODY_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR = {
  userId: "33333333-3333-4333-8333-333333333333",
  role: "admin" as const,
  sessionVersion: 7,
};

test("PATCH forwards only the path ID, parsed command and complete authenticated actor", async () => {
  const calls: unknown[] = [];
  const handler = createServiceRequestStatusPatchHandler({
    authenticate: async () => ACTOR,
    updateStatus: async (id, status, version, actor) => {
      calls.push({ id, status, version, actor });
      return dto(id, status, version + 1);
    },
  });

  const response = await handler(jsonRequest({
    status: "in_progress",
    version: 3,
    id: BODY_REQUEST_ID,
    requestId: BODY_REQUEST_ID,
    actorId: BODY_REQUEST_ID,
    userId: BODY_REQUEST_ID,
    role: "employee",
    sessionVersion: 999,
  }), REQUEST_ID.toUpperCase());

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0, must-revalidate",
  );
  assert.deepEqual(await response.json(), {
    request: dto(REQUEST_ID.toUpperCase(), "in_progress", 4),
  });
  assert.deepEqual(calls, [{
    id: REQUEST_ID.toUpperCase(),
    status: "in_progress",
    version: 3,
    actor: ACTOR,
  }]);
});

test("authentication and same-origin failures precede identifier and body parsing", async () => {
  const failures = [
    new ApplicationError("unauthorized", "unauthorized"),
    new ApplicationError("forbidden", "cross_site_request_blocked"),
  ];
  let updates = 0;
  const handler = createServiceRequestStatusPatchHandler({
    authenticate: async () => {
      throw failures.shift();
    },
    updateStatus: async () => {
      updates += 1;
      throw new Error("must_not_run");
    },
  });
  const invalidRequest = () => new Request("https://example.test/api", {
    method: "PATCH",
    headers: { "content-type": "text/plain" },
    body: "not-json",
  });

  const unauthenticated = await handler(invalidRequest(), "not-a-uuid");
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "unauthorized" });

  const crossSite = await handler(invalidRequest(), "not-a-uuid");
  assert.equal(crossSite.status, 403);
  assert.deepEqual(await crossSite.json(), {
    error: "cross_site_request_blocked",
  });
  assert.equal(updates, 0);
  for (const response of [unauthenticated, crossSite]) {
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("PATCH rejects invalid status/version shapes and PostgreSQL int4 overflow", async () => {
  let updates = 0;
  const handler = createServiceRequestStatusPatchHandler({
    authenticate: async () => ACTOR,
    updateStatus: async () => {
      updates += 1;
      throw new Error("must_not_run");
    },
  });
  const invalidBodies = [
    null,
    [],
    {},
    { status: "new" },
    { version: 1 },
    { status: "unknown", version: 1 },
    { status: "completed", version: 0 },
    { status: "completed", version: 1.5 },
    { status: "completed", version: 2_147_483_648 },
    { status: { value: "completed" }, version: 1 },
  ];

  for (const body of invalidBodies) {
    const response = await handler(jsonRequest(body), REQUEST_ID);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_service_request",
    });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  assert.equal(updates, 0);
});

test("PATCH bounds JSON and sanitizes unexpected failures without cacheable PII", async () => {
  const outcomes: unknown[] = [
    new ApplicationError("not_found", "service_request_not_found"),
    new Error("postgres://secret:password@example.test/inventory"),
  ];
  const handler = createServiceRequestStatusPatchHandler({
    authenticate: async () => ACTOR,
    updateStatus: async () => {
      throw outcomes.shift();
    },
  });

  const missing = await handler(statusRequest(), REQUEST_ID);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: "service_request_not_found",
  });

  const unavailable = await handler(statusRequest(), REQUEST_ID);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: "service_requests_unavailable",
  });

  const nonJson = await handler(new Request("https://example.test/api", {
    method: "PATCH",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }), REQUEST_ID);
  assert.equal(nonJson.status, 415);

  const malformed = await handler(new Request("https://example.test/api", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{",
  }), REQUEST_ID);
  assert.equal(malformed.status, 400);

  const oversized = await handler(jsonRequest({
    status: "completed",
    version: 1,
    ignored: "x".repeat(5_000),
  }), REQUEST_ID);
  assert.equal(oversized.status, 413);

  for (const response of [missing, unavailable, nonJson, malformed, oversized]) {
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("Next 16 route awaits dynamic params and preserves current-user sessionVersion", async () => {
  const source = await readFile(
    "app/api/service-requests/[id]/route.ts",
    "utf8",
  );

  assert.match(source, /createServiceRequestStatusPatchHandler/);
  assert.match(source, /authenticate:\s*requireCurrentUser/);
  assert.match(source, /\(await context\.params\)\.id/);
  assert.doesNotMatch(source, /authorizationActor/);
});

function statusRequest() {
  return jsonRequest({ status: "completed", version: 1 });
}

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dto(
  id: string,
  status: ServiceRequestDto["status"],
  version: number,
): ServiceRequestDto {
  return {
    id,
    item: { id: BODY_REQUEST_ID, name: "Laptop", inventoryNumber: "INV-1" },
    room: { id: REQUEST_ID, designation: "101", buildingName: "Main" },
    author: { id: ACTOR.userId, name: "Administrator" },
    responsible: { id: ACTOR.userId, name: "Administrator" },
    type: "damaged",
    description: "Screen damage",
    status,
    photoUrl: `/api/service-requests/${id}/photo?v=${version}`,
    createdAt: "2026-08-14T07:00:00.000Z",
    updatedAt: "2026-08-14T08:00:00.000Z",
    version,
  };
}
