import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestDetailGetHandler } from "@/lib/server/http/tmc-transfer-request-detail-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const get = createTmcTransferRequestDetailGetHandler({
  authenticate: requireCurrentUser,
  getById: (id, actor) =>
    getApplicationServices().tmcTransferRequests.getById(id, actor),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return get(request, (await context.params).id);
}
