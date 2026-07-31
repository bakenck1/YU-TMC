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
    const url = new URL(request.url);
    const value = url.searchParams.get("value");
    if (!value) throw new ApplicationError("validation", "qr_value_required");
    const kindInput = url.searchParams.get("kind");
    const kind =
      kindInput === "barcode" || kindInput === "qr" ? kindInput : "auto";
    const resolution = await getApplicationServices().qr.resolve(
      value,
      authorizationActor(user),
      kind,
    );
    return Response.json({ resolution });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "qr_resolver_unavailable" }, { status: 503 });
  }
}
