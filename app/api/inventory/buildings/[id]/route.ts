import type {
  ArchiveLocationInput,
  UpdateBuildingInput,
} from "@/lib/contracts/inventory-locations";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
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
    const user = await requirePermission(request, "inventory.building.manage");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const body = await readLimitedJson(request);
    const building =
      await getApplicationServices().locations.updateBuilding(
        id,
        parseUpdateBuilding(body),
        authorizationActor(user),
      );
    return Response.json({ building });
  } catch (error) {
    return locationErrorResponse(normalizeRequestError(error));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.building.manage");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const input = parseArchive(await readLimitedJson(request));
    await getApplicationServices().locations.archiveBuilding(
      id,
      input.version,
      authorizationActor(user),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return locationErrorResponse(normalizeRequestError(error));
  }
}

function parseUpdateBuilding(value: unknown): UpdateBuildingInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    typeof input.address !== "string" ||
    typeof input.version !== "number" ||
    !Number.isInteger(input.version) ||
    input.version < 1
  ) {
    throw invalidRequest();
  }
  return {
    name: input.name,
    address: input.address,
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
