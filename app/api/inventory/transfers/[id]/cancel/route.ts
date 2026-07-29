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
    const body: unknown = await request.json();
    const version =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).version
        : null;
    if (!Number.isInteger(version)) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const transfer = await getApplicationServices().responsibility.cancelTransfer(
      id,
      version as number,
      authorizationActor(user),
    );
    return Response.json({ transfer });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "transfer_unavailable" }, { status: 503 });
  }
}
