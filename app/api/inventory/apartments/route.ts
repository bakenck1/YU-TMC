import type { CreateApartmentInput } from "@/lib/contracts/inventory-locations";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.building.create");
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApplicationError("validation", "invalid_request");
    const result = await getApplicationServices().locations.createApartment(body as CreateApartmentInput, authorizationActor(user));
    return Response.json(result, { status: 201 });
  } catch (error) {
    const normalized = error instanceof SyntaxError ? new ApplicationError("validation", "invalid_request") : error;
    return normalized instanceof ApplicationError ? applicationErrorResponse(normalized)
      : Response.json({ error: "locations_unavailable" }, { status: 503 });
  }
}
