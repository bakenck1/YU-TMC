import "server-only";

import type { FacilitiesRepository } from "@/lib/contracts/facilities-api";
import { externalJson, verifyExternalBearer } from "@/lib/server/http/external-api";
import { createPostgresFacilitiesRepository } from "@/lib/server/persistence/postgres/postgres-facilities-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authorizeFacilitiesRequest(request: Request): Response | null {
  const result = verifyExternalBearer(request, {
    current: process.env.FACILITIES_API_KEY,
    next: process.env.FACILITIES_API_KEY_NEXT,
  });
  if (result === "not_configured") {
    return externalJson(
      { error: "API_NOT_CONFIGURED", message: "Facilities API is not configured." },
      503,
    );
  }
  if (result === "unauthorized") {
    return externalJson(
      { error: "UNAUTHORIZED", message: "Missing or invalid API key." },
      401,
      { "WWW-Authenticate": "Bearer" },
    );
  }
  return null;
}

export function facilitiesAuthCheck(request: Request) {
  return authorizeFacilitiesRequest(request) ?? externalJson({ valid: true, scope: "facilities:read" });
}

export async function listFacilitiesBuildings(
  request: Request,
  repository?: FacilitiesRepository,
) {
  const unauthorized = authorizeFacilitiesRequest(request);
  if (unauthorized) return unauthorized;
  if (new URL(request.url).search) return invalidQuery();

  try {
    repository ??= createPostgresFacilitiesRepository();
    return externalJson({ buildings: await repository.listBuildings() });
  } catch {
    return dependencyUnavailable();
  }
}

export async function listFacilitiesRooms(
  request: Request,
  repository?: FacilitiesRepository,
) {
  const unauthorized = authorizeFacilitiesRequest(request);
  if (unauthorized) return unauthorized;

  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "buildingId") || query.getAll("buildingId").length > 1) {
    return invalidQuery();
  }
  const buildingId = query.get("buildingId")?.trim() || undefined;
  if (buildingId && !UUID.test(buildingId)) return invalidQuery();

  try {
    repository ??= createPostgresFacilitiesRepository();
    return externalJson({ rooms: await repository.listRooms(buildingId) });
  } catch {
    return dependencyUnavailable();
  }
}

function invalidQuery() {
  return externalJson(
    { error: "INVALID_QUERY", message: "Invalid facilities query parameters." },
    400,
  );
}

function dependencyUnavailable() {
  return externalJson(
    { error: "DEPENDENCY_UNAVAILABLE", message: "Facilities dependency is unavailable." },
    503,
    { "Retry-After": "5" },
  );
}

export type {
  FacilitiesBuilding,
  FacilitiesRepository,
  FacilitiesRoom,
} from "@/lib/contracts/facilities-api";
