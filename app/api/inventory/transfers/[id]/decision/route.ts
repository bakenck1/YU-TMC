import type { DecideTransferInput } from "@/lib/contracts/inventory-responsibility";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    const input = parseInput(await readLimitedJson(request));
    const transfer = await getApplicationServices().responsibility.decideTransfer(
      id,
      input,
      authorizationActor(user),
    );
    return Response.json({ transfer });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parseInput(value: unknown): DecideTransferInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (
    !Number.isInteger(input.version) ||
    (input.decision !== "confirm" && input.decision !== "reject") ||
    (input.comment !== undefined &&
      input.comment !== null &&
      typeof input.comment !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    version: input.version as number,
    decision: input.decision,
    comment: input.comment as string | null | undefined,
  };
}

function assertId(id: string) {
  if (!isUuid(id)) {
    throw new ApplicationError("validation", "invalid_id");
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "transfer_unavailable" }, { status: 503 });
}
