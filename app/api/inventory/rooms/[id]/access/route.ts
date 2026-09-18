import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.room.manage");
    const { id } = await params;
    if (!isUuid(id)) throw invalidRequest();
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object") throw invalidRequest();
    const { accessMode, version } = body as Record<string, unknown>;
    if ((accessMode !== "open" && accessMode !== "closed") ||
        typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw invalidRequest();
    }
    const room = await getApplicationServices().locations.updateRoomAccess(
      id,
      { accessMode, version },
      authorizationActor(user),
    );
    return Response.json({ room });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "locations_unavailable" }, { status: 503 });
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
