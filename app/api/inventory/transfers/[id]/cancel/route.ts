import { getApplicationServices } from "@/lib/server/application";
import { createInventoryTransferCancelPostHandler } from "@/lib/server/http/inventory-transfer-cancel-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createInventoryTransferCancelPostHandler({
  authenticate: requireCurrentUser,
  cancelTransfer: (transferId, version, actor) =>
    getApplicationServices().responsibility.cancelTransfer(
      transferId,
      version,
      actor,
    ),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return post(request, (await context.params).id);
}
