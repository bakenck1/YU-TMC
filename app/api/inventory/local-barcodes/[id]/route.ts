import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    const actor = authorizationActor(user);
    const [group, history] = await Promise.all([
      getApplicationServices().localBarcodes.getGroup(id, actor),
      getApplicationServices().localBarcodes.getHistory(id, actor),
    ]);
    return Response.json({ group, history }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return error instanceof ApplicationError ? applicationErrorResponse(error) : Response.json({ error: "local_barcode_unavailable" }, { status: 503 });
  }
}
