import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { createIntegrationKey } from "../scripts/create-integration-key.mjs";
import { createIntegrationHandler, validIntegrationCursor } from "../lib/server/http/integration-handler";
import { integrationCredential, integrationGuard } from "../lib/server/integration-auth";
import * as integrationRoute from "../app/api/v1/integration/[resource]/route";
import type { IntegrationRepository } from "../lib/contracts/integration-api";

const readKey = createIntegrationKey("read");
const nextKey = createIntegrationKey("read");
function request(path = "changes", token = readKey.token, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/v1/integration/${path}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
}
const repository: IntegrationRepository = {
  async checkpoint() { return "10:9223372036854775807"; },
  async list() { return [{ id: "00000000-0000-4000-8000-000000000001", name: "Chair" }, { id: "00000000-0000-4000-8000-000000000002" }]; },
  async changes() { return { changes: [], hasMore: false, nextCursor: "10:9223372036854775807" }; },
};
const guard = async () => null;
test.beforeEach(() => {
  process.env.INTEGRATION_API_READ_KEY_SHA256 = readKey.hash;
  process.env.INTEGRATION_API_READ_EXPIRES_AT = readKey.expiresAt;
});
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("INTEGRATION_API_")) delete process.env[key];
});

test("issues independent 256-bit credentials and verifies only hashes with an expiry", () => {
  assert.match(readKey.token, /^yu_read_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(createIntegrationKey("read").token, readKey.token);
  assert.equal(createHash("sha256").update(readKey.token).digest("hex"), readKey.hash);
  assert.equal(integrationCredential(request()), readKey.hash);
  assert.equal(integrationCredential(request("changes", "bad")), null);
  delete process.env.INTEGRATION_API_READ_EXPIRES_AT;
  assert.equal(integrationCredential(request()), null);
  process.env.INTEGRATION_API_READ_EXPIRES_AT = "2000-01-01T00:00:00Z";
  assert.equal(integrationCredential(request()), null);
});
test("supports rotation and immediately rejects the retired credential", () => {
  process.env.INTEGRATION_API_READ_KEY_SHA256_NEXT = nextKey.hash;
  process.env.INTEGRATION_API_READ_EXPIRES_AT_NEXT = nextKey.expiresAt;
  assert.ok(integrationCredential(request("changes", nextKey.token)));
  process.env.INTEGRATION_API_READ_KEY_SHA256 = nextKey.hash;
  assert.equal(integrationCredential(request()), null);
});
test("does not accept URL credentials, browser origins, cookies or unrelated integration keys", async () => {
  assert.equal((await integrationGuard(request("changes?api_key=secret", "bad")))?.status, 401);
  assert.equal((await integrationGuard(request("changes", readKey.token, { origin: "https://site.example" })))?.status, 403);
  assert.equal((await integrationGuard(new Request("http://localhost", { headers: { cookie: "session=admin" } })))?.status, 401);
  process.env.FACILITIES_API_KEY = "unrelated-secret";
  assert.equal((await integrationGuard(request("changes", "unrelated-secret")))?.status, 401);
  delete process.env.FACILITIES_API_KEY;
});
test("checks authorization before accessing the repository", async () => {
  const handler = createIntegrationHandler({ repository, guard: async () => Response.json({}, { status: 401 }) });
  assert.equal((await handler(request(), "changes")).status, 401);
});
test("bounds and validates all query fields and cursors, including duplicate parameters", async () => {
  const handler = createIntegrationHandler({ repository, guard });
  for (const path of ["changes?after=1%0Aid:evil", "changes?after=-1:0", "changes?after=18446744073709551616:0", "changes?after=1:9223372036854775808", "changes?limit=101", "changes?limit=0", "changes?limit=1&limit=2", "items?after=bad", "items?api_key=secret"]) {
    assert.equal((await handler(request(path), path.split("?")[0])).status, 400, path);
  }
  assert.ok(validIntegrationCursor("0:0"));
  assert.ok(validIntegrationCursor("18446744073709551615:9223372036854775807"));
  assert.equal((await handler(request(), "unknown")).status, 404);
});
test("returns bounded snapshots and disables response caching", async () => {
  const response = await createIntegrationHandler({ repository, guard })(request("items?limit=1"), "items");
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.nextCursor, body.data[0].id);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
test("SSE replays Last-Event-ID and emits resumable checkpoints", async () => {
  let received = "";
  const handler = createIntegrationHandler({ repository: { ...repository, async changes(after) { received = after; return repository.changes(after, 1); } },
    guard, credentialValid: () => true, streamLifetimeMs: 25, pollIntervalMs: 1 });
  const response = await handler(request("events?after=0:0", readKey.token, { "last-event-id": "9:5" }), "events");
  assert.equal(received, "9:5");
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const text = await response.text();
  assert.match(text, /event: checkpoint/);
  assert.match(text, /id: 10:9223372036854775807/);
});
test("SSE stops on credential revocation and does not poll without demand", async () => {
  let calls = 0;
  const handler = createIntegrationHandler({ repository: { ...repository, async changes(after, limit) { calls++; return repository.changes(after, limit); } },
    guard, credentialValid: () => false, streamLifetimeMs: 100 });
  const response = await handler(request("events"), "events");
  assert.equal(calls, 1);
  assert.match(await response.text(), /event: revoked/);
  assert.equal(calls, 1);
});
test("SSE cancellation releases its timer and stops polling", async () => {
  let calls = 0;
  const handler = createIntegrationHandler({ repository: { ...repository, async changes(after, limit) { calls++; return repository.changes(after, limit); } },
    guard, credentialValid: () => true, pollIntervalMs: 1 });
  const response = await handler(request("events"), "events");
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(calls, 1);
});
test("hides internal dependency errors", async () => {
  const handler = createIntegrationHandler({ repository: { ...repository, async changes() { throw new Error("password=secret database.host"); } }, guard });
  const response = await handler(request(), "changes");
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /password|database.host/);
});
test("rejects retired write credentials even if their old configuration remains", () => {
  const token = `yu_write_${randomBytes(32).toString("base64url")}`;
  process.env.INTEGRATION_API_WRITE_KEY_SHA256 = createHash("sha256").update(token).digest("hex");
  process.env.INTEGRATION_API_WRITE_EXPIRES_AT = readKey.expiresAt;
  assert.equal(integrationCredential(request("items", token)), null);
  assert.throws(() => createIntegrationKey("write"), /read-only/);
});
test("exposes no mutation handlers in the integration route", () => {
  assert.equal(typeof integrationRoute.GET, "function");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(method in integrationRoute, false);
});
