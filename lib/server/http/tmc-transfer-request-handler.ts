import "server-only";

import {
  normalizeTmcIdempotencyKey,
  type IdempotentTmcTransferRequestCreation,
} from "@/lib/application/services/tmc-transfer-request-service";
import type { CreateTmcTransferRequestInput } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const INPUT_FIELDS = new Set(["recipientId", "itemIds", "comment"]);

export interface TmcTransferRequestPostDependencies {
  authenticate(request: Request): Promise<{ userId: string; role: UserRole }>;
  createIdempotent(
    input: CreateTmcTransferRequestInput,
    actor: { userId: string; role: UserRole },
    idempotencyKey: string,
  ): Promise<Pick<
    IdempotentTmcTransferRequestCreation,
    "body" | "kind" | "resourceId" | "status"
  >>;
  onCreated?(event: {
    requestId: string;
    recipientId: string;
    itemCount: number;
  }): void;
  onCreationNotificationSchedulingError?(
    event: { requestId: string; recipientId: string; itemCount: number },
    error: unknown,
  ): void;
}

export function createTmcTransferRequestPostHandler(
  dependencies: TmcTransferRequestPostDependencies,
) {
  return async function post(request: Request): Promise<Response> {
    try {
      const user = await dependencies.authenticate(request);
      const body = await readJson(request);
      const idempotencyKey = normalizeTmcIdempotencyKey(
        request.headers.get("idempotency-key"),
      );
      const input = parseInput(body);
      const execution = await dependencies.createIdempotent(
        input,
        { userId: user.userId, role: user.role },
        idempotencyKey,
      );
      if (execution.kind === "completed" && execution.body.result.request) {
        const event = {
          requestId: execution.body.result.request.id,
          recipientId: execution.body.result.request.recipient.id,
          itemCount: execution.body.result.included,
        };
        try {
          dependencies.onCreated?.(event);
        } catch (error) {
          try {
            dependencies.onCreationNotificationSchedulingError?.(event, error);
          } catch {
            // Diagnostics must be as best-effort as the notification itself.
          }
          // Notification scheduling is best-effort and must not change the
          // already committed idempotent command response.
        }
      }
      return Response.json(execution.body, {
        status: execution.status,
        headers: responseHeaders(execution.kind === "replayed"),
      });
    } catch (error) {
      return applicationErrorResponse(error, errorHeaders(error));
    }
  };
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApplicationError(
      "unsupported_media_type",
      "unsupported_media_type",
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw invalidRequest();
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length)) throw invalidRequest();
    if (length > MAXIMUM_BODY_BYTES) throw payloadTooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) throw invalidRequest();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAXIMUM_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best-effort; the transport result remains 413.
      }
      throw payloadTooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidRequest();
  }
}

function parseInput(value: unknown): CreateTmcTransferRequestInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((field) => !INPUT_FIELDS.has(field)) ||
    typeof body.recipientId !== "string" ||
    !Array.isArray(body.itemIds) ||
    body.itemIds.some((itemId) => typeof itemId !== "string") ||
    (body.comment !== undefined &&
      body.comment !== null &&
      typeof body.comment !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    recipientId: body.recipientId,
    itemIds: body.itemIds,
    ...(body.comment !== undefined ? { comment: body.comment as string | null } : {}),
  };
}

function responseHeaders(replayed: boolean): HeadersInit {
  return {
    "cache-control": "no-store",
    ...(replayed ? { "idempotency-replayed": "true" } : {}),
  };
}

function errorHeaders(error: unknown): HeadersInit {
  const retryAfter = retryAfterSeconds(error);
  return {
    "cache-control": "no-store",
    ...(retryAfter ? { "retry-after": retryAfter } : {}),
  };
}

function retryAfterSeconds(error: unknown) {
  if (!(error instanceof ApplicationError)) return undefined;
  if (error.publicCode === "idempotency_request_in_progress") return "1";
  const value = error.kind === "rate_limited"
    ? error.safeDetails?.retryAfterSeconds
    : undefined;
  if (!value || !/^[1-9]\d{0,8}$/.test(value)) return undefined;
  return value;
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function payloadTooLarge() {
  return new ApplicationError("payload_too_large", "payload_too_large");
}
