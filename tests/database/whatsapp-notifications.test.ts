import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/lib/db/client";
import { checkWhatsApp, sendWhatsApp } from "@/lib/server/whatsapp-gateway";
import { notifyWhatsApp, reserveWhatsAppNotification } from "@/lib/server/whatsapp-notifications";
import { database, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

describe("persistent WhatsApp notification safeguards", () => {
  const recipientId = randomUUID();
  const otherRecipientId = randomUUID();
  beforeAll(async () => {
    await setupTmcTransferDatabase();
    await database.query(
      `insert into "yu_inventory"."users" (id, code, email, full_name, role, phone, created_at, updated_at)
       values ($1, 'WA-1', 'wa1@example.test', 'WA One', 'employee', '77011112233', now(), now()),
              ($2, 'WA-2', 'wa2@example.test', 'WA Two', 'employee', '77011112244', now(), now())`,
      [recipientId, otherRecipientId],
    );
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(teardownTmcTransferDatabase);

  it("enforces a 24-hour cooldown under concurrency and reconnection while isolating recipients and message kinds", async () => {
    vi.stubEnv("WA_SESSION", "concurrent-cooldown");
    const input = { ticket: randomUUID(), kind: "request_received", recipientId };
    const claims = await Promise.all(Array.from({ length: 8 }, () => reserveWhatsAppNotification(input)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await closeDatabase();
    expect(await reserveWhatsAppNotification(input)).toBe(false);
    expect(await reserveWhatsAppNotification({ ...input, recipientId: otherRecipientId })).toBe(true);
    expect(await reserveWhatsAppNotification({ ...input, kind: "request_accepted" })).toBe(true);
    await database.query(
      `update "yu_inventory"."whatsapp_delivery_attempts" set attempted_at = now() - interval '23 hours 59 minutes'
       where ticket = $1`, [input.ticket],
    );
    expect(await reserveWhatsAppNotification(input)).toBe(false);
    await database.query(
      `update "yu_inventory"."whatsapp_delivery_attempts" set attempted_at = now() - interval '24 hours'
       where ticket = $1`, [input.ticket],
    );
    expect(await reserveWhatsAppNotification(input)).toBe(true);
  });

  it("persists Retry-After and blocks all session calls without claiming a later notification", async () => {
    vi.stubEnv("WA_API_TOKEN", "fake-wa-secret");
    vi.stubEnv("WA_SESSION", "persisted-pause");
    const fetch = vi.fn(async () => Response.json({ ok: false }, { status: 429, headers: { "Retry-After": "180" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(sendWhatsApp({ to: "77011112233", message: "Test" })).rejects.toMatchObject({ code: "WA_RATE" });
    const paused = await database.query(`select retry_after_at > now() as paused from "yu_inventory"."whatsapp_session_limits" where session = 'persisted-pause'`);
    expect(paused.rows[0].paused).toBe(true);
    expect(await reserveWhatsAppNotification({ ticket: randomUUID(), kind: "request_sent", recipientId })).toBe(false);
    await expect(checkWhatsApp("77011112233")).rejects.toMatchObject({ code: "WA_RATE" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The persisted guard is honored even for a session unseen by the process cache.
    vi.stubEnv("WA_SESSION", "pause-from-other-process");
    await database.query(`insert into "yu_inventory"."whatsapp_session_limits" (session, retry_after_at) values ('pause-from-other-process', now() + interval '3 minutes')`);
    await expect(checkWhatsApp("77011112233")).rejects.toMatchObject({ code: "WA_RATE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks registration before sending, suppresses repeats, and records successful delivery", async () => {
    vi.stubEnv("WA_API_TOKEN", "fake-wa-secret");
    vi.stubEnv("WA_SESSION", "successful-delivery");
    const fetch = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/v1/check') ? { ok: true, registered: true } : { ok: true }));
    vi.stubGlobal("fetch", fetch);
    const input = { ticket: randomUUID(), kind: "request_received", recipientId, message: "Здравствуйте! Вам отправили запрос на получение ТМЦ." };
    await notifyWhatsApp(input);
    await notifyWhatsApp(input);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain('/v1/check');
    expect(String(fetch.mock.calls[1][0])).toContain('/v1/send');
    const sent = await database.query(`select sent_at from "yu_inventory"."whatsapp_delivery_attempts" where ticket = $1`, [input.ticket]);
    expect(sent.rows[0].sent_at).toBeInstanceOf(Date);
  });

  it("does not send to unregistered or inactive users and does not reject on unavailable gateway", async () => {
    vi.stubEnv("WA_API_TOKEN", "fake-wa-secret");
    vi.stubEnv("WA_SESSION", "failed-delivery");
    const fetch = vi.fn(async () => Response.json({ ok: true, registered: false }));
    vi.stubGlobal("fetch", fetch);
    await expect(notifyWhatsApp({ ticket: randomUUID(), kind: "request_sent", recipientId, message: "Test" })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => Response.json({ ok: false }, { status: 503 }));
    await expect(notifyWhatsApp({ ticket: randomUUID(), kind: "request_sent", recipientId, message: "Test" })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    await database.query(`update "yu_inventory"."users" set is_active = false, deactivated_at = now() where id = $1`, [otherRecipientId]);
    await notifyWhatsApp({ ticket: randomUUID(), kind: "request_sent", recipientId: otherRecipientId, message: "Test" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
