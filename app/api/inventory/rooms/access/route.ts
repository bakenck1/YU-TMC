import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.room.manage");
    const body = await readLimitedJson(request, 128 * 1024);
    if (!body || typeof body !== "object") throw invalidRequest();
    const { accessMode, rooms } = body as Record<string, unknown>;
    if ((accessMode !== "open" && accessMode !== "closed") ||
        !Array.isArray(rooms) || rooms.length < 1 || rooms.length > 500) {
      throw invalidRequest();
    }
    const entries = rooms.map((entry) => {
      if (!entry || typeof entry !== "object") throw invalidRequest();
      const { id, version } = entry as Record<string, unknown>;
      if (!isUuid(id) || typeof version !== "number" ||
          !Number.isInteger(version) || version < 1) throw invalidRequest();
      return { id, version };
    });
    const result = await getApplicationServices().locations.bulkUpdateRoomAccess(
      { accessMode, rooms: entries },
      authorizationActor(user),
    );
    return Response.json(result);
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "locations_unavailable" }, { status: 503 });
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
