import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import type { AuthorizationActor } from "@/lib/security/permissions";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

interface ComponentMutationDependencies {
  authenticate(request: Request): Promise<AuthorizationActor>;
  addComponents(id: string, componentIds: string[], actor: AuthorizationActor): Promise<InventoryItemDto[]>;
  removeComponent(id: string, componentId: string, actor: AuthorizationActor): Promise<InventoryItemDto[]>;
}

export function createInventoryItemComponentsMutationHandler(
  dependencies: ComponentMutationDependencies,
  operation: "add" | "remove",
) {
  return async function mutateComponents(request: Request, id: string): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      if (!isUuid(id)) throw new ApplicationError("validation", "invalid_id");
      const body = await readLimitedJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ApplicationError("validation", "invalid_request");
      }
      const input = body as Record<string, unknown>;
      const componentIds = operation === "add" && "componentIds" in input
        ? input.componentIds
        : typeof input.componentId === "string" ? [input.componentId] : null;
      if (
        !Array.isArray(componentIds) ||
        componentIds.length === 0 ||
        componentIds.some((componentId) => typeof componentId !== "string")
      ) {
        throw new ApplicationError("validation", "invalid_request");
      }
      if (componentIds.some((componentId) => !isUuid(componentId))) {
        throw new ApplicationError("validation", "invalid_id");
      }
      const components = operation === "add"
        ? await dependencies.addComponents(id, componentIds, actor)
        : await dependencies.removeComponent(id, componentIds[0], actor);
      return Response.json({ components });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return applicationErrorResponse(new ApplicationError("validation", "invalid_request"));
      }
      return error instanceof ApplicationError
        ? applicationErrorResponse(error)
        : Response.json({ error: "item_components_unavailable" }, { status: 503 });
    }
  };
}
