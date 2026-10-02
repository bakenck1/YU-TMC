import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";
import {
  checkWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsApp,
  WhatsAppError,
  whatsappSession,
} from "../lib/server/whatsapp-gateway";
import { verifyWhatsAppPhoneForSave } from "../lib/server/whatsapp-user-phone";

test("normalizes Kazakhstan numbers and sends the token only in the Authorization header", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalUrl = process.env.WA_GATEWAY_URL;
  const originalSession = process.env.WA_SESSION;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    process.env.WA_GATEWAY_URL = "http://wa.example.test/";
    process.env.WA_SESSION = "inventory";
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json(calls.length === 1 ? { ok: true, registered: true } : { ok: true });
    };
    assert.equal(normalizeWhatsAppPhone("8 (701) 111-22-33"), "77011112233");
    assert.equal(await checkWhatsApp("+7 701 111 22 33"), true);
    await sendWhatsApp({ to: "7011112233", template: "generic_status", data: { status: "В работе" } });
    assert.deepEqual(calls.map((call) => call.url), [
      "http://wa.example.test/v1/check",
      "http://wa.example.test/v1/send",
    ]);
    assert.deepEqual(calls.map((call) => call.body.to), ["77011112233", "77011112233"]);
    assert.equal(calls[0].body.session, "inventory");
    assert.equal(calls[0].headers.get("Authorization"), "Bearer test-secret");
    assert.ok(calls.every((call) => !call.url.includes("test-secret")));
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
    restore("WA_GATEWAY_URL", originalUrl);
    restore("WA_SESSION", originalSession);
  }
});

test("keeps unregistered and unavailable numbers out of manual user saves", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    globalThis.fetch = async () => Response.json({ ok: true, registered: false });
    await assert.rejects(
      verifyWhatsAppPhoneForSave("77011112233"),
      (error: unknown) => error instanceof ApplicationError && error.publicCode === "whatsapp_not_registered",
    );
    globalThis.fetch = async () => new Response("", { status: 503 });
    assert.deepEqual(await verifyWhatsAppPhoneForSave("77011112233"), { phone: undefined, warning: true });
    await assert.rejects(
      checkWhatsApp("77011112233"),
      (error: unknown) => error instanceof WhatsAppError && error.code === "WA_NOT_READY",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
  }
});

test("exposes Retry-After without retrying a rate limited send", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "Retry-After": "120" } });
    };
    await assert.rejects(
      sendWhatsApp({ to: "77011112233", message: "test" }),
      (error: unknown) => error instanceof WhatsAppError && error.code === "WA_RATE" && error.retryAfterMs === 120_000,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
  }
});

function restore(key: "WA_API_TOKEN" | "WA_GATEWAY_URL" | "WA_SESSION", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test("rejects malformed success and maps gateway not-ready JSON without exposing its text", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalSession = process.env.WA_SESSION;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    process.env.WA_SESSION = "malformed-response-test";
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(sendWhatsApp({ to: "77011112233", message: "Test" }), WhatsAppError);
    globalThis.fetch = async () => Response.json({ ok: false, error: "Session not ready test-secret" });
    await assert.rejects(checkWhatsApp("77011112233"), (error: unknown) =>
      error instanceof WhatsAppError && error.code === "WA_NOT_READY" && !error.message.includes("test-secret"));
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
    restore("WA_SESSION", originalSession);
  }
});

test("a rate-limited request stops concurrent queued checks and sends for the same session", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalSession = process.env.WA_SESSION;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    process.env.WA_SESSION = "concurrent-rate-test";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ ok: false, retryAfter: 1 }, { status: 429, headers: { "Retry-After": "120" } });
    };
    const results = await Promise.allSettled([
      sendWhatsApp({ to: "77011112233", message: "Test" }),
      checkWhatsApp("77011112233"),
      sendWhatsApp({ to: "77011112233", message: "Test 2" }),
    ]);
    assert.equal(calls, 1);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") {
        assert.equal(result.reason.code, "WA_RATE");
        assert.ok(result.reason.retryAfterMs > 110_000);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
    restore("WA_SESSION", originalSession);
  }
});

test("uses the shared otinish session and rejects URL credentials and ambiguous send payloads", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalUrl = process.env.WA_GATEWAY_URL;
  const originalSession = process.env.WA_SESSION;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    delete process.env.WA_SESSION;
    assert.equal(whatsappSession(), "otinish");
    process.env.WA_GATEWAY_URL = "http://wa.example.test/?token=test-secret";
    let calls = 0;
    globalThis.fetch = async (_, init) => {
      calls++;
      assert.equal(JSON.parse(String(init?.body)).session, "otinish");
      assert.equal(init?.redirect, "error");
      return Response.json({ ok: true, registered: true });
    };
    await assert.rejects(checkWhatsApp("77011112233"), (e: unknown) => e instanceof WhatsAppError && e.code === "WA_CONFIG");
    await assert.rejects(sendWhatsApp({ to: "77011112233" }), WhatsAppError);
    await assert.rejects(sendWhatsApp({ to: "77011112233", message: "Test", template: "generic_status" }), WhatsAppError);
    assert.equal(calls, 0);
    process.env.WA_GATEWAY_URL = "http://wa.example.test";
    process.env.WA_SESSION = "YU Inventory";
    await assert.rejects(checkWhatsApp("77011112233"), (e: unknown) => e instanceof WhatsAppError && e.code === "WA_CONFIG");
    assert.equal(calls, 0, "invalid WhatsApp client IDs fail before the gateway request");
    process.env.WA_SESSION = "default-session-test";
    globalThis.fetch = async (_, init) => {
      assert.equal(JSON.parse(String(init?.body)).session, "default-session-test");
      assert.equal(init?.redirect, "error");
      return Response.json({ ok: true, registered: true });
    };
    assert.equal(await checkWhatsApp("77011112233"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
    restore("WA_GATEWAY_URL", originalUrl);
    restore("WA_SESSION", originalSession);
  }
});

test("parses HTTP-date Retry-After and suppresses calls during the resulting pause", async () => {
  const originalToken = process.env.WA_API_TOKEN;
  const originalSession = process.env.WA_SESSION;
  const originalFetch = globalThis.fetch;
  try {
    process.env.WA_API_TOKEN = "test-secret";
    process.env.WA_SESSION = "http-date-retry-test";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ ok: false }, { status: 429, headers: {
        "Retry-After": new Date(Date.now() + 180_000).toUTCString(),
      } });
    };
    const rate = (error: unknown) => error instanceof WhatsAppError && error.code === "WA_RATE" &&
      (error.retryAfterMs ?? 0) >= 178_000 && (error.retryAfterMs ?? Infinity) <= 180_000;
    await assert.rejects(checkWhatsApp("77011112233"), rate);
    await assert.rejects(sendWhatsApp({ to: "77011112233", message: "Test" }), rate);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", originalToken);
    restore("WA_SESSION", originalSession);
  }
});
