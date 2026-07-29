import type { CreateInspectionInput } from "@/lib/contracts/inventory-inspections";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const inspections = await getApplicationServices().inspections.list(
      authorizationActor(user),
    );
    return Response.json({ inspections });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).name !== "string"
    ) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const inspection = await getApplicationServices().inspections.create(
      { name: (body as { name: string }).name } satisfies CreateInspectionInput,
      authorizationActor(user),
    );
    return Response.json({ inspection }, { status: 201 });
  } catch (error) {
    return errorResponse(
      error instanceof SyntaxError
        ? new ApplicationError("validation", "invalid_request")
        : error,
    );
  }
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "inspections_unavailable" }, { status: 503 });
}
