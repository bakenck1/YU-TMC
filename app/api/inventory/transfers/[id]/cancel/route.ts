import { getApplicationServices } from "@/lib/server/application";
import { createInventoryTransferCancelPostHandler } from "@/lib/server/http/inventory-transfer-cancel-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { observeLegacyHttpRequest } from "@/lib/server/observability";

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
  return observeLegacyHttpRequest(request, "/api/inventory/transfers/:id/cancel", "cancel", async () => post(request, (await context.params).id));
}
