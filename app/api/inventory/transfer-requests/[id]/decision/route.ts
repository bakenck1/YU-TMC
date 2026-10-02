import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestDecisionPostHandler } from "@/lib/server/http/tmc-transfer-request-decision-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { after } from "next/server";
import { notifyTmcDecisionByWhatsApp } from "@/lib/server/whatsapp-tmc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const post = createTmcTransferRequestDecisionPostHandler({
  authenticate: requireCurrentUser,
  decideIdempotent: (requestId, input, actor, key) =>
    getApplicationServices().tmcTransferRequests.decideIdempotent(
      requestId,
      input,
      actor,
      key,
    ),
  onCompleted: (decided, decidedItemIds) => {
    after(() => notifyTmcDecisionByWhatsApp(decided, decidedItemIds));
    after(() => getApplicationServices().push.processTmcPushOutbox());
  },
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return post(request, (await context.params).id);
}
