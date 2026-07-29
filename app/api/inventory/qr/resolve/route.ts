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
    const value = new URL(request.url).searchParams.get("value");
    if (!value) throw new ApplicationError("validation", "qr_value_required");
    const resolution = await getApplicationServices().qr.resolve(
      value,
      authorizationActor(user),
    );
    return Response.json({ resolution });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "qr_resolver_unavailable" }, { status: 503 });
  }
}
