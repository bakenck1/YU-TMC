import "server-only";

import type { DecideTransferInput, TransferDto } from "@/lib/contracts/inventory-responsibility";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import {
  legacyTransferErrorResponse,
  legacyTransferJsonResponse,
  parseLegacyTransferId,
} from "@/lib/server/http/inventory-transfer-route-boundary";
import { readLimitedJson } from "@/lib/server/http/request-body";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const MAXIMUM_VERSION = 2_147_483_647;
const INPUT_FIELDS = new Set(["version", "decision", "comment"]);

interface AuthenticatedDecisionActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export function createInventoryTransferDecisionPostHandler(dependencies: {
  authenticate(request: Request): Promise<AuthenticatedDecisionActor>;
  decideTransfer(
    transferId: string,
    input: DecideTransferInput,
    actor: AuthenticatedDecisionActor,
  ): Promise<TransferDto>;
}) {
  return async function post(
    request: Request,
    transferId: string,
  ): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const normalizedTransferId = parseLegacyTransferId(transferId);
      const input = parseInput(
        await readLimitedJson(request, MAXIMUM_BODY_BYTES),
      );
      const transfer = await dependencies.decideTransfer(
        normalizedTransferId,
        input,
        actor,
      );
      return legacyTransferJsonResponse({ transfer });
    } catch (error) {
      return legacyTransferErrorResponse(error);
    }
  };
}

function parseInput(value: unknown): DecideTransferInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((field) => !INPUT_FIELDS.has(field)) ||
    !isVersion(input.version) ||
    (input.decision !== "confirm" && input.decision !== "reject") ||
    (input.comment !== undefined &&
      input.comment !== null &&
      typeof input.comment !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    version: input.version,
    decision: input.decision,
    ...(input.comment !== undefined
      ? { comment: input.comment as string | null }
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
