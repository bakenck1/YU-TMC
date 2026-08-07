import type {
  ArchiveLocationInput,
  UpdateRoomInput,
} from "@/lib/contracts/inventory-locations";
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.room.manage");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const room = await getApplicationServices().locations.updateRoom(
      id,
      parseUpdateRoom(await request.json()),
      authorizationActor(user),
    );
    return Response.json({ room });
  } catch (error) {
    return locationErrorResponse(normalizeRequestError(error));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.room.manage");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const input = parseArchive(await request.json());
    await getApplicationServices().locations.archiveRoom(
      id,
      input.version,
      authorizationActor(user),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return locationErrorResponse(normalizeRequestError(error));
  }
}

function parseUpdateRoom(value: unknown): UpdateRoomInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (
    typeof input.designation !== "string" ||
    typeof input.floorNumber !== "number" ||
    !Number.isInteger(input.floorNumber) ||
    typeof input.version !== "number" ||
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    (input.floorLabel !== undefined &&
      input.floorLabel !== null &&
      typeof input.floorLabel !== "string") ||
    (input.primaryResponsibleId !== undefined &&
      input.primaryResponsibleId !== null &&
      typeof input.primaryResponsibleId !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    designation: input.designation,
    floorNumber: input.floorNumber,
    floorLabel: input.floorLabel as string | null | undefined,
    primaryResponsibleId: input.primaryResponsibleId as string | null | undefined,
    version: input.version,
  };
}

function parseArchive(value: unknown): ArchiveLocationInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const version = (value as Record<string, unknown>).version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw invalidRequest();
  }
  return { version };
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
