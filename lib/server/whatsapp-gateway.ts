import "server-only";

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

async function gateway(path: "/v1/check" | "/v1/send", body: Record<string, unknown>) {
  const token = process.env.WA_API_TOKEN?.trim();
  if (!token) throw new WhatsAppError("WA_CONFIG");
  const base = (process.env.WA_GATEWAY_URL?.trim() || "http://wa.yu.edu.kz").replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: whatsappSession(), ...body }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    throw new WhatsAppError("WA_ERROR");
  }
  const result: unknown = await response.json().catch(() => ({}));
  const data = result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown> : {};
  if (!response.ok || data.ok === false) {
    const retry = retryAfterMs(
      typeof data.retryAfter === "number" || typeof data.retryAfter === "string"
        ? String(data.retryAfter)
        : response.headers.get("Retry-After"),
    );
    throw new WhatsAppError(
      response.status === 429 ? "WA_RATE" : response.status === 503 ? "WA_NOT_READY" : "WA_ERROR",
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
  await gateway("/v1/send", { ...input, to: normalizeWhatsAppPhone(input.to) });
}
