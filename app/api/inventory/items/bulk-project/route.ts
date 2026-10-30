import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const body = await readLimitedJson(request, 128 * 1024);
    if (!body || typeof body !== "object" ||
      !Array.isArray((body as Record<string, unknown>).itemIds) ||
      typeof (body as Record<string, unknown>).isProject !== "boolean") {
      throw new ApplicationError("validation", "invalid_request");
    }
    const input = body as { itemIds: string[]; isProject: boolean };
    const updatedItemIds = await getApplicationServices().items.bulkChangeProject(
      input.itemIds, input.isProject, authorizationActor(user),
    );
    return Response.json({ updatedItemIds });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return applicationErrorResponse(new ApplicationError("validation", "invalid_request"));
    }
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "items_unavailable" }, { status: 503 });
  }
}
