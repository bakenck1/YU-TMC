import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestCancelPostHandler } from "@/lib/server/http/tmc-transfer-request-cancel-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createTmcTransferRequestCancelPostHandler({
  authenticate: requireCurrentUser,
  cancelIdempotent: (id, input, actor, key) =>
    getApplicationServices().tmcTransferRequests.cancelIdempotent(id, input, actor, key),
  onCompleted: () => after(() => getApplicationServices().push.processTmcPushOutbox()),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return post(request, (await context.params).id);
}
