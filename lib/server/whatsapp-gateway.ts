import "server-only";

import { getDatabasePool } from "@/lib/db/client";

export type WhatsAppErrorCode = "WA_CONFIG" | "WA_RATE" | "WA_NOT_READY" | "WA_ERROR";

export class WhatsAppError extends Error {
  constructor(
    readonly code: WhatsAppErrorCode,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(code);
  }
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WA_API_TOKEN?.trim());
}

export function whatsappSession(): string {
  return process.env.WA_SESSION?.trim() || "otinish";
}

const pausedUntil = new Map<string, number>();
const sessionRequests = new Map<string, Promise<unknown>>();

// Serialize this process's requests so a 429 also stops calls already queued.
async function gateway(path: "/v1/check" | "/v1/send", body: Record<string, unknown>) {
  const session = whatsappSession();
  const previous = sessionRequests.get(session) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => requestGateway(path, body, session));
  sessionRequests.set(session, pending);
  try {
    return await pending;
  } finally {
    if (sessionRequests.get(session) === pending) sessionRequests.delete(session);
  }
}

async function assertSessionAvailable(session: string) {
  let until = pausedUntil.get(session) ?? 0;
  try {
    const result = await getDatabasePool().query<{ retry_after_at: Date | null }>(
      `select retry_after_at from "yu_inventory"."whatsapp_session_limits" where session = $1`,
      [session],
    );
    until = Math.max(until, result.rows[0]?.retry_after_at?.getTime() ?? 0);
  } catch {
    // A standalone gateway client can run without DB configuration. Notification
    // callers separately require a durable cooldown reservation before sending.
  }
  if (until > Date.now()) throw new WhatsAppError("WA_RATE", 429, until - Date.now());
  pausedUntil.delete(session);
}

async function pauseSession(session: string, delay: number) {
  const until = Math.max(pausedUntil.get(session) ?? 0, Date.now() + delay);
  pausedUntil.set(session, until);
  try {
    await getDatabasePool().query(
      `insert into "yu_inventory"."whatsapp_session_limits" (session, retry_after_at)
       values ($1, $2) on conflict (session) do update
       set retry_after_at = greatest("whatsapp_session_limits".retry_after_at, excluded.retry_after_at)`,
      [session, new Date(until)],
    );
  } catch {
    console.warn("WhatsApp session pause persistence failed", { code: "WA_RATE" });
  }
}

export function normalizeWhatsAppPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7\d{10}$/.test(digits)) throw new WhatsAppError("WA_ERROR");
  return digits;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function requestGateway(path: "/v1/check" | "/v1/send", body: Record<string, unknown>, session: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(session)) throw new WhatsAppError("WA_CONFIG");
  const token = process.env.WA_API_TOKEN?.trim();
  if (!token) throw new WhatsAppError("WA_CONFIG");
  const base = (process.env.WA_GATEWAY_URL?.trim() || "http://wa.yu.edu.kz").replace(/\/+$/, "");
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
  } catch {
    throw new WhatsAppError("WA_CONFIG");
  }
  await assertSessionAvailable(session);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, session }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    throw new WhatsAppError("WA_ERROR");
  }
  const result: unknown = await response.json().catch(() => ({}));
  const data = result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown> : {};
  if (!response.ok || data.ok !== true) {
    const retry = retryAfterMs(response.headers.get("Retry-After")) ?? retryAfterMs(
      typeof data.retryAfter === "number" || typeof data.retryAfter === "string"
        ? String(data.retryAfter)
        : null,
    );
    if (response.status === 429) await pauseSession(session, Math.max(retry ?? 60 * 60_000, 1000));
    const notReady = response.status === 503 || (typeof data.error === "string" && /not[ _-]?ready|qr/i.test(data.error));
    throw new WhatsAppError(
      response.status === 429 ? "WA_RATE" : notReady ? "WA_NOT_READY" : "WA_ERROR",
      response.status,
      retry,
    );
  }
  return data;
}

export async function checkWhatsApp(phone: string): Promise<boolean> {
  const data = await gateway("/v1/check", { to: normalizeWhatsAppPhone(phone) });
  if (typeof data.registered !== "boolean") throw new WhatsAppError("WA_ERROR");
  return data.registered;
}

export async function sendWhatsApp(input: {
  to: string;
  message?: string;
  template?: string;
  data?: Record<string, string>;
}): Promise<void> {
  if (Boolean(input.message?.trim()) === Boolean(input.template?.trim())) {
    throw new WhatsAppError("WA_ERROR");
  }
  await gateway("/v1/send", { ...input, to: normalizeWhatsAppPhone(input.to) });
}
