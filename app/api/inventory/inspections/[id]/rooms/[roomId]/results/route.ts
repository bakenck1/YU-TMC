import type { RecordItemResultInput } from "@/lib/contracts/inventory-inspection-results";
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
  context: { params: Promise<{ id: string; roomId: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id, roomId } = await context.params;
    assertId(id);
    assertId(roomId);
    const result = await getApplicationServices().inspections.recordItemResult(
      id,
      roomId,
      parseInput(await readLimitedJson(request)),
      authorizationActor(user),
    );
    return Response.json({ result }, { status: 201 });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "result_unavailable" }, { status: 503 });
  }
}

function parseInput(value: unknown): RecordItemResultInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (typeof body.itemId !== "string" || typeof body.result !== "string") {
    throw invalidRequest();
  }
  if (
    body.comment !== undefined &&
    body.comment !== null &&
    typeof body.comment !== "string"
  ) {
    throw invalidRequest();
  }
  return {
    itemId: body.itemId,
    result: body.result as RecordItemResultInput["result"],
    comment: body.comment as string | null | undefined,
  };
}

function assertId(value: string) {
  if (!isUuid(value)) throw invalidRequest();
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
