import "server-only";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const LEGACY_COMPATIBILITY_IDS = [
  "LEGACY-PERMISSIONS",
  "LEGACY-TRANSFER-ROUTES",
  "LEGACY-QR-ALIASES",
  "LEGACY-AUTH-IMPORT",
  "LEGACY-COOKIE-CONTRACT",
  "LEGACY-SEED-DATA",
] as const;

export type LegacyCompatibilityId = typeof LEGACY_COMPATIBILITY_IDS[number];
export type StructuredLogLevel = "info" | "warn" | "error";

export interface StructuredLogEvent {
  timestamp: string;
  level: StructuredLogLevel;
  event: string;
  requestId: string;
  route: string;
  status: number;
  duration: number;
  deploymentId: string;
  errorCode: string;
  attributes?: Record<string, string | number | boolean>;
}

type LogSink = (serializedEvent: string, event: StructuredLogEvent) => void;

interface EmitOptions {
  sink?: LogSink;
  deploymentId?: string;
  now?: () => Date;
}

interface RequestObservationOptions extends EmitOptions {
  trustForwardedRequestId?: boolean;
  unexpectedErrorCode?: string;
}

interface LegacyUsageInput {
  compatibilityId: LegacyCompatibilityId;
  variant: string;
  outcome: string;
}

interface LegacyUsageOptions extends EmitOptions {
  requestId?: string;
  duration?: number;
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,96}$/;
const SAFE_EVENT = /^[a-z][a-z0-9_.-]{1,95}$/;
const SAFE_ROUTE = /^(?:\/|worker:|command:)[A-Za-z0-9_./:[\]-]{0,159}$/;
const LEGACY_IDS = new Set<string>(LEGACY_COMPATIBILITY_IDS);
const SAFE_LEGACY_VARIANTS: Readonly<Record<LegacyCompatibilityId, ReadonlySet<string>>> = {
  "LEGACY-PERMISSIONS": new Set([
    "legacy.dashboard.read",
    "legacy.items.read",
    "legacy.locations.read",
    "legacy.analytics.read",
    "legacy.users.read",
    "legacy.users.manage",
    "legacy.users.manage_privileged",
    "legacy.settings.manage",
  ]),
  "LEGACY-TRANSFER-ROUTES": new Set(["collection.get", "collection.post", "cancel", "decision", "override"]),
  "LEGACY-QR-ALIASES": new Set(["legacy_raw", "legacy_url"]),
  "LEGACY-AUTH-IMPORT": new Set(["configured", "not_configured"]),
  "LEGACY-COOKIE-CONTRACT": new Set(["v1"]),
  "LEGACY-SEED-DATA": new Set(["development", "test"]),
};
const SAFE_OUTCOMES = new Set([
  "allowed",
  "denied",
  "resolved",
  "not_found",
  "imported",
  "already_imported",
  "not_configured",
  "accepted",
  "rejected",
  "completed",
  "failed",
  "token_valid",
  "token_invalid",
  "session_version_mismatch",
]);
const SAFE_ATTRIBUTE_STRINGS: Readonly<Record<string, ReadonlySet<string>>> = {
  compatibilityId: LEGACY_IDS,
  credentialSlot: new Set(["current", "next"]),
  outcome: SAFE_OUTCOMES,
  variant: new Set(Object.values(SAFE_LEGACY_VARIANTS).flatMap((values) => [...values])),
};
const SAFE_NUMBER_ATTRIBUTES = new Set(["attempts", "failed", "total", "claimed", "completed", "retried", "deadLettered", "statusCode"]);
const requestContext = new AsyncLocalStorage<{ requestId: string; route: string }>();

export function emitStructuredEvent(
  input: Omit<StructuredLogEvent, "timestamp" | "deploymentId" | "attributes"> & {
    timestamp?: string;
    deploymentId?: string;
    attributes?: Record<string, unknown>;
  },
  options: EmitOptions = {},
): StructuredLogEvent {
  const attributes = sanitizeAttributes(input.attributes);
  const event: StructuredLogEvent = {
    timestamp: safeTimestamp(input.timestamp, options.now?.() ?? new Date()),
    level: input.level,
    event: safeIdentifier(input.event, SAFE_EVENT, "observability.invalid_event"),
    requestId: safeIdentifier(input.requestId, SAFE_ID, randomUUID()),
    route: safeRoute(input.route),
    status: safeStatus(input.status),
    duration: safeDuration(input.duration),
    deploymentId: safeIdentifier(input.deploymentId ?? options.deploymentId ?? configuredDeploymentId(), SAFE_ID, "unknown"),
    errorCode: safeIdentifier(input.errorCode, SAFE_EVENT, "unknown_error"),
    ...(attributes ? { attributes } : {}),
  };
  const serialized = JSON.stringify(event);
  try {
    (options.sink ?? defaultSink)(serialized, event);
  } catch {
    // Observability is best-effort and must never change business behavior.
  }
  return event;
}

export async function observeHttpRequest(
  request: Request,
  route: string,
  action: (context: { requestId: string }) => Response | Promise<Response>,
  options: RequestObservationOptions = {},
): Promise<Response> {
  const startedAt = options.now?.() ?? new Date();
  const requestId = requestIdFor(request, options.trustForwardedRequestId);
  try {
    const response = await requestContext.run({ requestId, route }, () => action({ requestId }));
    const finishedAt = options.now?.() ?? new Date();
    const level = response.status >= 500 ? "error" : "info";
    emitStructuredEvent({
      level,
      event: "http.request.completed",
      requestId,
      route,
      status: response.status,
      duration: elapsedMilliseconds(startedAt, finishedAt),
      errorCode: response.status >= 500 ? `http_${response.status}` : "none",
    }, options);
    return responseWithRequestId(response, requestId);
  } catch {
    const finishedAt = options.now?.() ?? new Date();
    const errorCode = safeIdentifier(options.unexpectedErrorCode ?? "internal_error", SAFE_EVENT, "internal_error");
    emitStructuredEvent({
      level: "error",
      event: "http.request.failed",
      requestId,
      route,
      status: 500,
      duration: elapsedMilliseconds(startedAt, finishedAt),
      errorCode,
    }, options);
    return Response.json(
      { error: errorCode, requestId },
      {
        status: 500,
        headers: {
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
          "X-Request-Id": requestId,
        },
      },
    );
  }
}

export function observeLegacyHttpRequest(
  request: Request,
  route: string,
  variant: string,
  action: () => Response | Promise<Response>,
  options: RequestObservationOptions = {},
) {
  return observeHttpRequest(request, route, async () => {
    try {
      const response = await action();
      emitLegacyUsage({
        compatibilityId: "LEGACY-TRANSFER-ROUTES",
        variant,
        outcome: response.status < 400 ? "accepted" : response.status < 500 ? "rejected" : "failed",
      }, options);
      return response;
    } catch (error) {
      emitLegacyUsage({ compatibilityId: "LEGACY-TRANSFER-ROUTES", variant, outcome: "failed" }, options);
      throw error;
    }
  }, options);
}

export function emitLegacyUsage(input: LegacyUsageInput, options: LegacyUsageOptions = {}) {
  if (!LEGACY_IDS.has(input.compatibilityId)) throw new Error("Unknown legacy compatibility ID.");
  if (!SAFE_LEGACY_VARIANTS[input.compatibilityId].has(input.variant)) {
    throw new Error("Legacy telemetry requires an allowlisted legacy variant.");
  }
  if (!SAFE_OUTCOMES.has(input.outcome)) throw new Error("Legacy telemetry requires an allowlisted outcome.");
  return emitStructuredEvent({
    level: input.outcome === "failed" ? "error" : "info",
    event: "legacy.usage",
    requestId: options.requestId ?? requestContext.getStore()?.requestId ?? randomUUID(),
    route: `command:${input.compatibilityId.toLowerCase()}`,
    status: input.outcome === "failed" ? 500 : 200,
    duration: options.duration ?? 0,
    errorCode: input.outcome === "failed" ? "legacy_operation_failed" : "none",
    attributes: {
      compatibilityId: input.compatibilityId,
      variant: input.variant,
      outcome: input.outcome,
    },
  }, options);
}

export function createStructuredWorkerLogger(route: `worker:${string}`, options: EmitOptions = {}) {
  return {
    error(event: string, context: Record<string, string | number | undefined>) {
      emitStructuredEvent({
        level: "error",
        event,
        requestId: typeof context.requestId === "string" ? context.requestId : randomUUID(),
        route,
        status: 500,
        duration: 0,
        errorCode: event,
        attributes: context,
      }, options);
    },
  };
}

export function requestIdFor(request: Request, trustForwarded = configuredProxyTrust()): string {
  const forwarded = request.headers.get("x-request-id");
  return trustForwarded && forwarded && safeIdentifier(forwarded, SAFE_ID, "") ? forwarded : randomUUID();
}

export function currentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}

export function configuredProxyTrust(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRUST_FORWARDED_REQUEST_ID?.trim().toLowerCase() === "true";
}

function sanitizeAttributes(attributes: Record<string, unknown> | undefined) {
  if (!attributes) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const strings = SAFE_ATTRIBUTE_STRINGS[key];
    if (strings && typeof value === "string" && strings.has(value)) safe[key] = value;
    else if (SAFE_NUMBER_ATTRIBUTES.has(key) && typeof value === "number" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

async function responseWithRequestId(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  if (response.status >= 400) headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  if (response.status >= 400 && response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await response.clone().json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        return Response.json({ ...body, requestId }, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    } catch {
      // Preserve malformed or streaming dependency responses without exposing them.
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function elapsedMilliseconds(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime());
}

function safeTimestamp(value: string | undefined, fallback: Date) {
  if (!value) return fallback.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

function safeIdentifier(value: string, pattern: RegExp, fallback: string) {
  return pattern.test(value) && !containsSensitiveIdentifier(value) ? value : fallback;
}

function containsSensitiveIdentifier(value: string) {
  return /\d{12}/.test(value) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function safeRoute(value: string) {
  const withoutQuery = value.split("?", 1)[0] ?? "unknown";
  const redacted = withoutQuery
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":id")
    .replace(/\b\d{12}\b/g, ":iin");
  return SAFE_ROUTE.test(redacted) ? redacted : "unknown";
}

function safeStatus(value: number) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 500;
}

function safeDuration(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function configuredDeploymentId() {
  return process.env.APP_DEPLOYMENT_ID?.trim() || process.env.DATABASE_DEPLOYMENT_ID?.trim() || "unknown";
}

function defaultSink(serialized: string, event: StructuredLogEvent) {
  if (process.env.NODE_ENV === "test" && process.env.OBSERVABILITY_TEST_STDOUT !== "true") return;
  if (event.level === "error") console.error(serialized);
  else if (event.level === "warn") console.warn(serialized);
  else console.log(serialized);
}
