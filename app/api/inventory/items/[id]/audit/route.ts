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
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new ApplicationError("validation", "invalid_id");
    }
    const audit = await getApplicationServices().items.listAudit(
      id,
      authorizationActor(user),
    );
    return Response.json({ audit });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "audit_unavailable" }, { status: 503 });
  }
}
