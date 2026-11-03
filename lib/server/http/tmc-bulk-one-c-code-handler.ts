import "server-only";

import type { AuthorizationActor } from "@/lib/security/permissions";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

type Result = { updatedItemIds: string[]; oneCCode: string };

export function createTmcBulkOneCCodePatchHandler(dependencies: {
  authenticate(request: Request): Promise<AuthorizationActor>;
  changeCode(itemIds: string[], code: string, actor: AuthorizationActor): Promise<Result>;
}) {
  return async function patch(request: Request): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      if (actor.role !== "admin") throw new ApplicationError("forbidden", "forbidden");
      const value = await readLimitedJson(request, 128 * 1024);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
      const body = value as Record<string, unknown>;
      if (Object.keys(body).some((key) => key !== "itemIds" && key !== "oneCCode") ||
        !Array.isArray(body.itemIds) || body.itemIds.length < 1 || body.itemIds.length > 2_000 ||
        body.itemIds.some((id) => typeof id !== "string") || typeof body.oneCCode !== "string") {
        throw invalidRequest();
      }
      const result = await dependencies.changeCode(body.itemIds, body.oneCCode, actor);
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return applicationErrorResponse(error instanceof SyntaxError ? invalidRequest() : error,
        { "cache-control": "no-store" });
    }
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
