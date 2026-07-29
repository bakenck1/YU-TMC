import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    const responsibility =
      await getApplicationServices().responsibility.acceptFree(
        id,
        authorizationActor(user),
      );
    return Response.json({ responsibility }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function assertId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApplicationError("validation", "invalid_id");
  }
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "responsibility_unavailable" }, { status: 503 });
}
