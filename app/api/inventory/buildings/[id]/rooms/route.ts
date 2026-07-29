import type { CreateRoomInput } from "@/lib/contracts/inventory-locations";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requirePermission,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.workspace.read");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const rooms = await getApplicationServices().locations.listRooms(
      id,
      authorizationActor(user),
    );
    return Response.json({ rooms });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.room.create");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const room = await getApplicationServices().locations.createRoom(
      id,
      parseCreateRoom(await request.json()),
      authorizationActor(user),
    );
    return Response.json({ room }, { status: 201 });
  } catch (error) {
    return locationErrorResponse(normalizeRequestError(error));
  }
}

function parseCreateRoom(value: unknown): CreateRoomInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (
    typeof input.designation !== "string" ||
    typeof input.floorNumber !== "number" ||
    !Number.isInteger(input.floorNumber) ||
    (input.floorLabel !== undefined &&
      input.floorLabel !== null &&
      typeof input.floorLabel !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    designation: input.designation,
    floorNumber: input.floorNumber,
    floorLabel: input.floorLabel as string | null | undefined,
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function normalizeRequestError(error: unknown): unknown {
  return error instanceof SyntaxError ? invalidRequest() : error;
}

function locationErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "locations_unavailable" }, { status: 503 });
}
