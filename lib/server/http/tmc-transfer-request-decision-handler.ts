import "server-only";

import {
  normalizeTmcIdempotencyKey,
  type IdempotentTmcTransferRequestDecision,
} from "@/lib/application/services/tmc-transfer-request-service";
import type { DecideTmcTransferRequestInput } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const INPUT_FIELDS = new Set(["requestVersion", "decisions", "administrativeReason"]);
const DECISION_FIELDS = new Set(["itemId", "itemVersion", "decision"]);

export function createTmcTransferRequestDecisionPostHandler(dependencies: {
  authenticate(request: Request): Promise<{ userId: string; role: UserRole }>;
  decideIdempotent(
    requestId: string,
    input: DecideTmcTransferRequestInput,
    actor: { userId: string; role: UserRole },
    idempotencyKey: string,
  ): Promise<Pick<IdempotentTmcTransferRequestDecision, "body" | "kind" | "status">>;
}) {
  return async function post(request: Request, requestId: string): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      assertJson(request);
      const body = parseInput(await readLimitedJson(request, MAXIMUM_BODY_BYTES));
      const key = normalizeTmcIdempotencyKey(request.headers.get("idempotency-key"));
      const execution = await dependencies.decideIdempotent(requestId, body, actor, key);
      return Response.json(execution.body, {
        status: execution.status,
        headers: {
          "cache-control": "no-store",
          ...(execution.kind === "replayed" ? { "idempotency-replayed": "true" } : {}),
        },
      });
    } catch (error) {
      return applicationErrorResponse(
        error instanceof SyntaxError
          ? new ApplicationError("validation", "invalid_request")
          : error,
        errorHeaders(error),
      );
    }
  };
}

function assertJson(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApplicationError("unsupported_media_type", "unsupported_media_type");
  }
}

function parseInput(value: unknown): DecideTmcTransferRequestInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((field) => !INPUT_FIELDS.has(field)) ||
    !isVersion(body.requestVersion) ||
    !Array.isArray(body.decisions) ||
    body.decisions.some((decision) =>
      !decision ||
      typeof decision !== "object" ||
      Array.isArray(decision) ||
      Object.keys(decision).some((field) => !DECISION_FIELDS.has(field)) ||
      typeof (decision as Record<string, unknown>).itemId !== "string" ||
      !isVersion((decision as Record<string, unknown>).itemVersion) ||
      !["accept", "reject"].includes((decision as Record<string, unknown>).decision as string)
    ) ||
    (body.administrativeReason !== undefined &&
      body.administrativeReason !== null &&
      typeof body.administrativeReason !== "string")
  ) throw invalid();
  return {
    requestVersion: body.requestVersion as number,
    decisions: body.decisions as DecideTmcTransferRequestInput["decisions"],
    ...(body.administrativeReason !== undefined
      ? { administrativeReason: body.administrativeReason as string | null }
      : {}),
  };
}

function invalid() {
  return new ApplicationError("validation", "invalid_request");
}

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 2_147_483_647;
}

function errorHeaders(error: unknown): HeadersInit {
  let retryAfter: string | undefined;
  if (error instanceof ApplicationError) {
    if (error.publicCode === "idempotency_request_in_progress") retryAfter = "1";
    else if (error.kind === "rate_limited") {
      const candidate = error.safeDetails?.retryAfterSeconds;
      if (candidate && /^[1-9]\d{0,8}$/.test(candidate)) retryAfter = candidate;
    }
  }
  return {
    "cache-control": "no-store",
    ...(retryAfter ? { "retry-after": retryAfter } : {}),
  };
}
