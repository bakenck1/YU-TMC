import { getApplicationServices } from "@/lib/server/application";
import { createInventoryTransferDecisionPostHandler } from "@/lib/server/http/inventory-transfer-decision-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

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
  return post(request, (await context.params).id);
}
