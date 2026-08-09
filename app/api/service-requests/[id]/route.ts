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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object") throw invalidRequest();
    const input = body as Record<string, unknown>;
    if (
      (input.status !== "new" &&
        input.status !== "in_progress" &&
        input.status !== "completed") ||
      !Number.isInteger(input.version)
    ) throw invalidRequest();
    const { id } = await params;
    const serviceRequest = await getApplicationServices().requests.updateStatus(
      id,
      input.status,
      input.version as number,
      authorizationActor(user),
    );
    return Response.json({ request: serviceRequest });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "service_requests_unavailable" }, { status: 503 });
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_service_request");
}
