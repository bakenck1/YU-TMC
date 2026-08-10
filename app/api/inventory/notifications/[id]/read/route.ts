import { getApplicationServices } from "@/lib/server/application";
import { createTmcNotificationReadPostHandler } from "@/lib/server/http/tmc-stage-four-handlers";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return createTmcNotificationReadPostHandler({
    authenticate: requireCurrentUser,
    markRead: (id, actor) => getApplicationServices().tmcTransferRequests.markNotificationRead(id, actor),
  })(request, (await context.params).id);
}
