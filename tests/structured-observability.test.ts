import assert from "node:assert/strict";
import test from "node:test";

import {
  createStructuredWorkerLogger,
  emitLegacyUsage,
  emitStructuredEvent,
  observeHttpRequest,
  type StructuredLogEvent,
} from "../lib/server/observability";
import { authorizeExternalBearer } from "../lib/server/http/external-api";

function capture() {
  const events: StructuredLogEvent[] = [];
  return {
    events,
    sink: (line: string) => events.push(JSON.parse(line) as StructuredLogEvent),
  };
}

test("structured events expose only allowlisted scalar context", () => {
  const output = capture();
  emitStructuredEvent({
    level: "error",
    event: "http.request.failed",
    requestId: "request-safe-1",
    route: "/api/example",
    status: 500,
    duration: 12,
    errorCode: "internal_error",
    attributes: {
      outcome: "failed",
      attempts: 2,
      authorization: "Bearer top-secret",
      cookie: "yu_inventory_session=secret",
      body: "<xml>secret</xml>",
      email: "person@example.test",
      iin: "123456789012",
      fullName: "Sensitive Person",
      photo: "data:image/jpeg;base64,secret",
      cause: { message: "nested secret" },
      details: { password: "secret" },
    },
  }, { sink: output.sink, deploymentId: "deploy-safe", now: () => new Date("2026-09-08T10:00:00.000Z") });

  assert.deepEqual(output.events, [{
    timestamp: "2026-09-08T10:00:00.000Z",
    level: "error",
    event: "http.request.failed",
    requestId: "request-safe-1",
    route: "/api/example",
    status: 500,
    duration: 12,
    deploymentId: "deploy-safe",
    errorCode: "internal_error",
    attributes: { outcome: "failed", attempts: 2 },
  }]);
  const serialized = JSON.stringify(output.events);
  for (const secret of ["top-secret", "yu_inventory_session", "<xml>", "person@example.test", "123456789012", "Sensitive Person", "base64", "nested secret", "password"]) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("top-level envelope identifiers reject IIN-shaped values", () => {
  const output = capture();
  emitStructuredEvent({
    level: "error",
    event: "failure_123456789012",
    requestId: "123456789012",
    route: "/api/users/123456789012",
    status: 500,
    duration: 1,
    deploymentId: "deploy_123456789012",
    errorCode: "db_123456789012",
  }, { sink: output.sink });
  const event = output.events[0]!;
  assert.equal(event.event, "observability.invalid_event");
  assert.match(event.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(event.route, "/api/users/:iin");
  assert.equal(event.deploymentId, "unknown");
  assert.equal(event.errorCode, "unknown_error");
  assert.doesNotMatch(JSON.stringify(event), /123456789012/);
});

test("request observation rejects a forged forwarding ID unless proxy trust is explicit", async () => {
  const untrusted = capture();
  const request = new Request("https://inventory.example/api/example", {
    headers: { "x-request-id": "forged-request-id" },
  });
  const response = await observeHttpRequest(request, "/api/example", () => Response.json({ ok: true }), {
    sink: untrusted.sink,
    trustForwardedRequestId: false,
  });
  assert.notEqual(response.headers.get("x-request-id"), "forged-request-id");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

  const trusted = capture();
  const trustedResponse = await observeHttpRequest(request, "/api/example", () => Response.json({ ok: true }), {
    sink: trusted.sink,
    trustForwardedRequestId: true,
  });
  assert.equal(trustedResponse.headers.get("x-request-id"), "forged-request-id");
});

test("expected 4xx is informational while an unexpected exception is safe and correlated", async () => {
  const expected = capture();
  const expectedResponse = await observeHttpRequest(
    new Request("https://inventory.example/api/example"),
    "/api/example",
    () => Response.json({ error: "not_found" }, { status: 404 }),
    { sink: expected.sink },
  );
  assert.equal(expectedResponse.status, 404);
  const expectedBody = await expectedResponse.json() as { error: string; requestId: string };
  assert.equal(expectedBody.error, "not_found");
  assert.equal(expectedBody.requestId, expectedResponse.headers.get("x-request-id"));
  assert.equal(expected.events[0]?.level, "info");
  assert.equal(expected.events[0]?.event, "http.request.completed");

  const unexpected = capture();
  const unexpectedResponse = await observeHttpRequest(
    new Request("https://inventory.example/api/example"),
    "/api/example",
    () => { throw new Error("database failed for person@example.test"); },
    { sink: unexpected.sink },
  );
  assert.equal(unexpectedResponse.status, 500);
  const body = await unexpectedResponse.json() as { error: string; requestId: string };
  assert.equal(body.error, "internal_error");
  assert.equal(body.requestId, unexpectedResponse.headers.get("x-request-id"));
  assert.equal(unexpected.events[0]?.level, "error");
  assert.equal(unexpected.events[0]?.errorCode, "internal_error");
  assert.doesNotMatch(JSON.stringify(unexpected.events), /person@example\.test|database failed/);
});

test("legacy usage accepts only registered dimensions and never raw identifiers", () => {
  const output = capture();
  emitLegacyUsage({
    compatibilityId: "LEGACY-QR-ALIASES",
    variant: "legacy_raw",
    outcome: "resolved",
  }, { sink: output.sink, requestId: "request-safe-2" });

  assert.equal(output.events[0]?.event, "legacy.usage");
  assert.deepEqual(output.events[0]?.attributes, {
    compatibilityId: "LEGACY-QR-ALIASES",
    variant: "legacy_raw",
    outcome: "resolved",
  });
  assert.throws(() => emitLegacyUsage({
    compatibilityId: "LEGACY-QR-ALIASES",
    variant: "8b88ac18-f334-47b0-88ad-d228f84322d3",
    outcome: "resolved",
  }, { sink: output.sink }), /allowlisted legacy variant/);
});

test("worker logger keeps correlation and aggregate counts but drops entity identifiers", () => {
  const output = capture();
  const logger = createStructuredWorkerLogger("worker:tmc-push", { sink: output.sink });
  logger.error("push_tmc_outbox_delivery_failed", {
    requestId: "request-safe-3",
    eventId: "8b88ac18-f334-47b0-88ad-d228f84322d3",
    subscriptionId: "subscription-secret",
    recipientId: "user-secret",
    statusCode: 503,
    attempts: 3,
  });

  assert.equal(output.events[0]?.requestId, "request-safe-3");
  assert.equal(output.events[0]?.route, "worker:tmc-push");
  assert.deepEqual(output.events[0]?.attributes, { statusCode: 503, attempts: 3 });
  assert.doesNotMatch(JSON.stringify(output.events), /8b88ac18|subscription-secret|user-secret/);
});

test("legacy events inside a request reuse the server correlation ID", async () => {
  const output = capture();
  const response = await observeHttpRequest(
    new Request("https://inventory.example/api/inventory/transfers"),
    "/api/inventory/transfers",
    () => {
      emitLegacyUsage({ compatibilityId: "LEGACY-TRANSFER-ROUTES", variant: "collection.get", outcome: "accepted" }, { sink: output.sink });
      return Response.json({ ok: true });
    },
    { sink: output.sink },
  );
  assert.equal(output.events.length, 2);
  assert.equal(output.events[0]?.requestId, response.headers.get("x-request-id"));
  assert.equal(output.events[1]?.requestId, response.headers.get("x-request-id"));
});

test("external authorization reuses the active observer correlation ID", async () => {
  const output = capture();
  const request = new Request("https://inventory.example/api/v1/items", {
    headers: { authorization: "Bearer current-secret" },
  });
  const response = await observeHttpRequest(request, "/api/v1/items", () => {
    const authorization = authorizeExternalBearer(request, { current: "current-secret" });
    assert.ok(authorization.context);
    return Response.json({ requestId: authorization.context.requestId });
  }, { sink: output.sink });

  const body = await response.json() as { requestId: string };
  assert.equal(body.requestId, response.headers.get("x-request-id"));
  assert.equal(output.events[0]?.requestId, body.requestId);
});

test("sink failures never change the observed business response", async () => {
  const response = await observeHttpRequest(
    new Request("https://inventory.example/api/example"),
    "/api/example",
    () => Response.json({ ok: true }, { status: 201 }),
    { sink: () => { throw new Error("collector unavailable"); } },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });

  const failure = await observeHttpRequest(
    new Request("https://inventory.example/api/example"),
    "/api/example",
    () => { throw new Error("application failure"); },
    { sink: () => { throw new Error("collector unavailable"); } },
  );
  assert.equal(failure.status, 500);
  assert.equal((await failure.json() as { error: string }).error, "internal_error");
});
