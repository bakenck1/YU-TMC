import "server-only";

import { normalizeTmcIdempotencyKey } from "@/lib/application/services/tmc-transfer-request-service";
import type { CancelTmcTransferRequestInput, TmcTransferRequestDto } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const MAXIMUM_BODY_BYTES = 4 * 1024;
const FIELDS = new Set(["requestVersion", "administrativeReason"]);

export function createTmcTransferRequestCancelPostHandler(dependencies: {
  authenticate(request: Request): Promise<{ userId: string; role: UserRole }>;
  cancelIdempotent(
    requestId: string,
    input: CancelTmcTransferRequestInput,
    actor: { userId: string; role: UserRole },
    key: string,
  ): Promise<{ status: 200; kind: "completed" | "replayed"; body: { request: TmcTransferRequestDto } }>;
  onCompleted?(): void;
}) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const actor = await dependencies.authenticate(request);
      const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") {
        throw new ApplicationError("unsupported_media_type", "unsupported_media_type");
      }
      const value = await readLimitedJson(request, MAXIMUM_BODY_BYTES);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
      const body = value as Record<string, unknown>;
      if (
        Object.keys(body).some((field) => !FIELDS.has(field)) ||
        !Number.isSafeInteger(body.requestVersion) ||
        (body.requestVersion as number) < 1 ||
        (body.requestVersion as number) > 2_147_483_647 ||
        (body.administrativeReason !== undefined && body.administrativeReason !== null && typeof body.administrativeReason !== "string")
      ) throw invalid();
      const key = normalizeTmcIdempotencyKey(request.headers.get("idempotency-key"));
      const execution = await dependencies.cancelIdempotent(requestId, {
        requestVersion: body.requestVersion as number,
        ...(body.administrativeReason !== undefined
          ? { administrativeReason: body.administrativeReason as string | null }
          : {}),
      }, actor, key);
      if (execution.kind === "completed") {
        try { dependencies.onCompleted?.(); } catch { /* Durable outbox remains available for the worker. */ }
      }
      return Response.json(execution.body, {
        status: execution.status,
        headers: {
          "cache-control": "no-store",
          ...(execution.kind === "replayed" ? { "idempotency-replayed": "true" } : {}),
        },
      });
    } catch (error) {
      return applicationErrorResponse(
        error instanceof SyntaxError ? invalid() : error,
        errorHeaders(error),
      );
    }
  };
}

function invalid() {
  return new ApplicationError("validation", "invalid_request");
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
  return { "cache-control": "no-store", ...(retryAfter ? { "retry-after": retryAfter } : {}) };
}
