import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestPhotoGetHandler } from "@/lib/server/http/tmc-transfer-request-photo-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const get = createTmcTransferRequestPhotoGetHandler({
  authenticate: requireCurrentUser,
  getItemPhoto: (requestId, itemId, actor) =>
    getApplicationServices().tmcTransferRequests.getItemPhoto(
      requestId,
      itemId,
      actor,
    ),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await context.params;
  return get(request, id, itemId);
}
