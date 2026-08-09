import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestDecisionPostHandler } from "@/lib/server/http/tmc-transfer-request-decision-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createTmcTransferRequestDecisionPostHandler({
  authenticate: requireCurrentUser,
  decideIdempotent: (requestId, input, actor, key) =>
    getApplicationServices().tmcTransferRequests.decideIdempotent(
      requestId,
      input,
      actor,
      key,
    ),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return post(request, (await context.params).id);
}
