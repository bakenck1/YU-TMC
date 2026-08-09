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
    if (!isUuid(id)) throw invalidRequest();
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object") throw invalidRequest();
    const input = body as Record<string, unknown>;
    if (
      !Number.isInteger(input.version) ||
      typeof input.reason !== "string" ||
      (input.outcome !== "assigned" && input.outcome !== "released") ||
      (input.responsibleUserId !== undefined &&
        input.responsibleUserId !== null &&
        typeof input.responsibleUserId !== "string")
    ) {
      throw invalidRequest();
    }
    const transfer = await getApplicationServices().responsibility.overrideTransfer(
      id,
      {
        version: input.version as number,
        reason: input.reason,
        outcome: input.outcome,
        responsibleUserId: input.responsibleUserId as string | null | undefined,
      },
      authorizationActor(user),
    );
    return Response.json({ transfer });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "transfer_unavailable" }, { status: 503 });
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
