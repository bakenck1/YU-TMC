import { getApplicationServices } from "@/lib/server/application";
import { createTmcNotificationsGetHandler } from "@/lib/server/http/tmc-stage-four-handlers";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return createTmcNotificationsGetHandler({
    authenticate: requireCurrentUser,
    listNotifications: (actor, limit) =>
      getApplicationServices().tmcTransferRequests.listNotifications(actor, limit),
  })(request);
}
