import "server-only";

import type {
  CreateRoomInput,
  RoomDto,
} from "@/lib/contracts/inventory-locations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuthenticatedRoomActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export function createInventoryRoomPostHandler(dependencies: {
  authenticate(request: Request): Promise<AuthenticatedRoomActor>;
  createRoom(
    buildingId: string,
    input: CreateRoomInput,
    actor: AuthenticatedRoomActor,
  ): Promise<RoomDto>;
}) {
  return async function post(
    request: Request,
    buildingId: string,
  ): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      if (!UUID_PATTERN.test(buildingId)) throw invalidRequest();
      const room = await dependencies.createRoom(
        buildingId,
        parseCreateRoom(await readLimitedJson(request)),
        actor,
      );
      return Response.json({ room }, { status: 201 });
    } catch (error) {
      return locationErrorResponse(normalizeRequestError(error));
    }
  };
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
      typeof input.floorLabel !== "string") ||
    (input.primaryResponsibleId !== undefined &&
      input.primaryResponsibleId !== null &&
      (typeof input.primaryResponsibleId !== "string" ||
        !input.primaryResponsibleId))
  ) {
    throw invalidRequest();
  }
  return {
    designation: input.designation,
    floorNumber: input.floorNumber,
    floorLabel: input.floorLabel as string | null | undefined,
    primaryResponsibleId: input.primaryResponsibleId as string | null | undefined,
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
