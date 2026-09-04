import { getApplicationServices } from "@/lib/server/application";
import { createTmcNotificationsReadAllPostHandler } from "@/lib/server/http/tmc-stage-four-handlers";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return createTmcNotificationsReadAllPostHandler({
    authenticate: requireCurrentUser,
    markAllRead: (actor) =>
      getApplicationServices().tmcTransferRequests.markAllNotificationsRead(actor),
  })(request);
}
