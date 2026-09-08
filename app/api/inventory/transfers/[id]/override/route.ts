import { getApplicationServices } from "@/lib/server/application";
import { createInventoryTransferOverridePostHandler } from "@/lib/server/http/inventory-transfer-override-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { observeLegacyHttpRequest } from "@/lib/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createInventoryTransferOverridePostHandler({
  authenticate: requireCurrentUser,
  overrideTransfer: (transferId, input, actor) =>
    getApplicationServices().responsibility.overrideTransfer(
      transferId,
      input,
      actor,
    ),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return observeLegacyHttpRequest(request, "/api/inventory/transfers/:id/override", "override", async () => post(request, (await context.params).id));
}
