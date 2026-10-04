import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { currentRequestId, requestIdFor } from "@/lib/server/observability";
import {
  consumeDurableRateLimit,
  getClientIp,
  InMemoryRateLimiter,
  rateLimitHeaders,
  type RateLimitResult,
} from "@/lib/security/rate-limiter";

export interface ExternalRequestContext {
  requestId: string;
  credentialSlot: "current" | "next";
}

export function authorizeExternalBearer(
  request: Request,
  secrets: { current?: string | null; next?: string | null },
): { context?: ExternalRequestContext; response?: Response } {
  const verification = verifyExternalBearer(request, secrets);
  const requestId = currentRequestId() ?? requestIdFor(request);
  if (verification === "not_configured") return { response: externalJson({ error: "API_NOT_CONFIGURED", message: "External API is not configured." }, 503, { "X-Request-Id": requestId }) };
  if (verification === "unauthorized") return { response: externalJson({ error: "UNAUTHORIZED", message: "Missing or invalid API key." }, 401, { "WWW-Authenticate": "Bearer", "X-Request-Id": requestId }) };
  return { context: { requestId, credentialSlot: verification } };
}

export function verifyExternalBearer(
  request: Request,
  secrets: { current?: string | null; next?: string | null },
): "current" | "next" | "not_configured" | "unauthorized" {
  const configured = [
    ["current", secrets.current?.trim()],
    ["next", secrets.next?.trim()],
  ] as const;
  const active = configured.filter((entry): entry is readonly ["current" | "next", string] => Boolean(entry[1]));
  if (active.length === 0) return "not_configured";
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? "";
  const suppliedDigest = digest(supplied);
  const currentMatch = timingSafeEqual(suppliedDigest, digest(secrets.current?.trim() ?? ""));
  const nextMatch = timingSafeEqual(suppliedDigest, digest(secrets.next?.trim() ?? ""));
  if (currentMatch && Boolean(secrets.current?.trim())) return "current";
  if (nextMatch && Boolean(secrets.next?.trim())) return "next";
  return "unauthorized";
}

export function externalJson(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: externalResponseHeaders({ "Content-Type": "application/json; charset=utf-8", ...headers }) });
}

export function externalResponseHeaders(headers: HeadersInit = {}) {
  const supplied = new Headers(headers);
  const suppliedRequestId = supplied.get("x-request-id");
  const requestId = suppliedRequestId?.match(/^[A-Za-z0-9._-]{1,80}$/)?.[0] ?? randomUUID();
  const retryAfter = safeRetryAfter(supplied.get("retry-after"));
  supplied.delete("x-request-id");
  supplied.delete("retry-after");
  const result = new Headers({ "Cache-Control": "private, no-store, max-age=0, must-revalidate", "X-Request-Id": requestId });
  supplied.forEach((value, name) => result.set(name, value));
  if (retryAfter) result.set("Retry-After", retryAfter);
  return result;
}

export function safeRetryAfter(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86_400 ? String(seconds) : null;
}

const externalRateLimiters = new Map<string, InMemoryRateLimiter>();

/**
 * External integrations are bearer-key protected, but a leaked integration
 * key must not turn into an unlimited PII/data scraping channel.  Use a
 * durable bucket in production and an in-memory bucket for isolated tests or
 * a local process without a database.
 */
export async function consumeExternalApiRateLimit(
  request: Request,
  namespace: string,
  limit = 600,
): Promise<RateLimitResult> {
  const authorization = request.headers.get("authorization") ?? "";
  const credentialDigest = createHash("sha256")
    .update(authorization)
    .digest("hex");
  const key = `${getClientIp(request)}:${credentialDigest}`;
  if (process.env.NODE_ENV !== "test") {
    try {
      return await consumeDurableRateLimit({
        namespace: `external-${namespace}`,
        key,
        limit,
        windowMs: 60_000,
      });
    } catch {
      // Keep a local safety net when a standalone development process has no
      // database. Production still has the durable bucket whenever the API is
      // able to reach its configured database.
    }
  }
  let limiter = externalRateLimiters.get(namespace);
  if (!limiter) {
    limiter = new InMemoryRateLimiter({
      namespace: `external-${namespace}-local`,
      limit,
      windowMs: 60_000,
    });
    externalRateLimiters.set(namespace, limiter);
  }
  return limiter.consume(key);
}

export function externalRateLimitedResponse(result: RateLimitResult) {
  return externalJson(
    { error: "TOO_MANY_REQUESTS", retryAfterSeconds: result.retryAfterSeconds },
    429,
    Object.fromEntries(rateLimitHeaders(result)),
  );
}

function digest(value: string) { return createHash("sha256").update(value).digest(); }
