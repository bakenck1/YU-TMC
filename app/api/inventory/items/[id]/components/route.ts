import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    const components = await getApplicationServices().items.listComponents(
      id,
      authorizationActor(user),
    );
    return Response.json({ components });
  } catch (error) {
    return componentErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return mutateComponents(request, context, "add");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return mutateComponents(request, context, "remove");
}

async function mutateComponents(
  request: Request,
  context: { params: Promise<{ id: string }> },
  operation: "add" | "remove",
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).componentId !== "string"
    ) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const actor = authorizationActor(user);
    const componentId = (body as { componentId: string }).componentId;
    const components =
      operation === "add"
        ? await getApplicationServices().items.addComponent(id, componentId, actor)
        : await getApplicationServices().items.removeComponent(
            id,
            componentId,
            actor,
          );
    return Response.json({ components });
  } catch (error) {
    return componentErrorResponse(
      error instanceof SyntaxError
        ? new ApplicationError("validation", "invalid_request")
        : error,
    );
  }
}

function componentErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "item_components_unavailable" }, { status: 503 });
}
