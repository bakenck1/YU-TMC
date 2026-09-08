import { getApplicationServices } from "@/lib/server/application";
import { createInventoryTransferDecisionPostHandler } from "@/lib/server/http/inventory-transfer-decision-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { observeLegacyHttpRequest } from "@/lib/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createInventoryTransferDecisionPostHandler({
  authenticate: requireCurrentUser,
  decideTransfer: (transferId, input, actor) =>
    getApplicationServices().responsibility.decideTransfer(
      transferId,
      input,
      actor,
    ),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return observeLegacyHttpRequest(request, "/api/inventory/transfers/:id/decision", "decision", async () => post(request, (await context.params).id));
}
