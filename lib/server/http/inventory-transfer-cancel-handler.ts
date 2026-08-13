import "server-only";

import type { TransferDto } from "@/lib/contracts/inventory-responsibility";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const MAXIMUM_BODY_BYTES = 4 * 1024;
const MAXIMUM_VERSION = 2_147_483_647;
const INPUT_FIELDS = new Set(["version"]);

interface AuthenticatedCancellationActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export function createInventoryTransferCancelPostHandler(dependencies: {
  authenticate(request: Request): Promise<AuthenticatedCancellationActor>;
  cancelTransfer(
    transferId: string,
    version: number,
    actor: AuthenticatedCancellationActor,
  ): Promise<TransferDto>;
}) {
  return async function post(
    request: Request,
    transferId: string,
  ): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const normalizedTransferId = normalizeTransferId(transferId);
      const version = parseVersion(
        await readLimitedJson(request, MAXIMUM_BODY_BYTES),
      );
      const transfer = await dependencies.cancelTransfer(
        normalizedTransferId,
        version,
        actor,
      );
      return Response.json(
        { transfer },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function normalizeTransferId(value: string) {
  if (!isUuid(value)) throw hiddenTransfer();
  return value.toLowerCase();
}

function parseVersion(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((field) => !INPUT_FIELDS.has(field)) ||
    !Number.isSafeInteger(input.version) ||
    (input.version as number) < 1 ||
    (input.version as number) > MAXIMUM_VERSION
  ) {
    throw invalidRequest();
  }
  return input.version as number;
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function hiddenTransfer() {
  return new ApplicationError("not_found", "transfer_not_found");
}

function errorResponse(error: unknown) {
  const headers = errorHeaders(error);
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, headers)
    : Response.json(
        { error: "transfer_unavailable" },
        { status: 503, headers },
      );
}

function errorHeaders(error: unknown): HeadersInit {
  const retryAfter =
    error instanceof ApplicationError && error.kind === "rate_limited"
      ? error.safeDetails?.retryAfterSeconds
      : undefined;
  return {
    "cache-control": "no-store",
    ...(retryAfter && /^[1-9]\d{0,8}$/.test(retryAfter)
      ? { "retry-after": retryAfter }
      : {}),
  };
}
