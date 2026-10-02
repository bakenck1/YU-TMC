import { getApplicationServices } from "@/lib/server/application";
import { createInventoryTransferOverridePostHandler } from "@/lib/server/http/inventory-transfer-override-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { observeLegacyHttpRequest } from "@/lib/server/observability";
import { after } from "next/server";
import { notifyLegacyTransferByWhatsApp } from "@/lib/server/whatsapp-tmc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createInventoryTransferOverridePostHandler({
  authenticate: requireCurrentUser,
  overrideTransfer: async (transferId, input, actor) => {
    const transfer = await getApplicationServices().responsibility.overrideTransfer(
      transferId,
      input,
      actor,
    );
    try { after(() => notifyLegacyTransferByWhatsApp(transfer.id)); } catch { /* Best-effort notification scheduling. */ }
    return transfer;
  },
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return observeLegacyHttpRequest(request, "/api/inventory/transfers/:id/override", "override", async () => post(request, (await context.params).id));
}
