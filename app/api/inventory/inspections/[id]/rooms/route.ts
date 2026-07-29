import type { AddInspectionRoomInput } from "@/lib/contracts/inventory-inspections";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
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
    const input = parseInput(await request.json());
    const room = await getApplicationServices().inspections.addRoom(
      id,
      input,
      authorizationActor(user),
    );
    return Response.json({ room }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parseInput(value: unknown): AddInspectionRoomInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (typeof input.buildingId !== "string" || typeof input.roomId !== "string") {
    throw invalidRequest();
  }
  return { buildingId: input.buildingId, roomId: input.roomId };
}

function assertId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApplicationError("validation", "invalid_id");
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "inspections_unavailable" }, { status: 503 });
}
