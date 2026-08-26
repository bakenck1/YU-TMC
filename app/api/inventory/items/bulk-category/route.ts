import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const body = await readLimitedJson(request, 128 * 1024);
    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray((body as Record<string, unknown>).itemIds) ||
      (((body as Record<string, unknown>).category !== "electronics") &&
        ((body as Record<string, unknown>).category !== "furniture"))
    ) {
      throw invalidRequest();
    }
    const updatedItemIds = await getApplicationServices().items.bulkChangeCategory(
      (body as { itemIds: string[] }).itemIds,
      (body as { category: "electronics" | "furniture" }).category,
      authorizationActor(user),
    );
    return Response.json({ updatedItemIds });
  } catch (error) {
    return itemErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function itemErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "items_unavailable" }, { status: 503 });
}
