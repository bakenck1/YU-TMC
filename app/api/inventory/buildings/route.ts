import type { CreateBuildingInput } from "@/lib/contracts/inventory-locations";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requirePermission,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.workspace.read");
    const buildings = await getApplicationServices().locations.listBuildings(
      authorizationActor(user),
    );
    return Response.json({ buildings });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.building.create");
    const body: unknown = await request.json();
    const building =
      await getApplicationServices().locations.createBuilding(
        parseCreateBuilding(body),
        authorizationActor(user),
      );
    return Response.json({ building }, { status: 201 });
  } catch (error) {
    return locationErrorResponse(normalizeRequestError(error));
  }
}

function parseCreateBuilding(value: unknown): CreateBuildingInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || typeof input.address !== "string") {
    throw invalidRequest();
  }
  return { name: input.name, address: input.address };
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
