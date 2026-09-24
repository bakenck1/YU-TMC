import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";
import {
  checkWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsApp,
  WhatsAppError,
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
