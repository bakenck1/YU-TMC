import "server-only";

import type { TransferDto } from "@/lib/contracts/inventory-responsibility";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const MAXIMUM_VERSION = 2_147_483_647;
const INPUT_FIELDS = new Set([
  "version",
  "reason",
  "outcome",
  "responsibleUserId",
]);

interface AuthenticatedOverrideActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

interface OverrideTransferInput {
  version: number;
  reason: string;
  outcome: "assigned" | "released";
  responsibleUserId?: string | null;
}

export function createInventoryTransferOverridePostHandler(dependencies: {
  authenticate(request: Request): Promise<AuthenticatedOverrideActor>;
  overrideTransfer(
    transferId: string,
    input: OverrideTransferInput,
    actor: AuthenticatedOverrideActor,
  ): Promise<TransferDto>;
}) {
  return async function post(
    request: Request,
    transferId: string,
  ): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const normalizedTransferId = normalizeTransferId(transferId);
      const input = parseInput(
        await readLimitedJson(request, MAXIMUM_BODY_BYTES),
      );
      const transfer = await dependencies.overrideTransfer(
        normalizedTransferId,
        input,
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

function parseInput(value: unknown): OverrideTransferInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((field) => !INPUT_FIELDS.has(field)) ||
    !isVersion(input.version) ||
    typeof input.reason !== "string" ||
    (input.outcome !== "assigned" && input.outcome !== "released")
  ) {
    throw invalidRequest();
  }
  if (
    (input.outcome === "assigned" &&
      typeof input.responsibleUserId !== "string") ||
    (input.outcome === "released" &&
      input.responsibleUserId !== undefined &&
      input.responsibleUserId !== null)
  ) {
    throw invalidRequest();
  }
  return {
    version: input.version,
    reason: input.reason,
    outcome: input.outcome,
    ...(input.responsibleUserId !== undefined
      ? { responsibleUserId: input.responsibleUserId as string | null }
      : {}),
  };
}

function isVersion(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAXIMUM_VERSION
  );
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
