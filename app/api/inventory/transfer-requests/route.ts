import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestPostHandler } from "@/lib/server/http/tmc-transfer-request-handler";
import { createTmcHistoryGetHandler } from "@/lib/server/http/tmc-stage-four-handlers";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { after } from "next/server";
import { notifyTmcCreatedByWhatsApp } from "@/lib/server/whatsapp-tmc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return createTmcHistoryGetHandler({
    authenticate: requireCurrentUser,
    listHistory: (filters, actor) =>
      getApplicationServices().tmcTransferRequests.listHistory(filters, actor),
  })(request);
}

export async function POST(request: Request) {
  const services = getApplicationServices();
  return createTmcTransferRequestPostHandler({
    authenticate: requireCurrentUser,
    createIdempotent: (input, actor, idempotencyKey) =>
      services.tmcTransferRequests.createIdempotent(input, actor, idempotencyKey),
    onCreated: () => {
      after(() => services.push.processTmcPushOutbox());
    },
    onCommitted: (created) => after(() => notifyTmcCreatedByWhatsApp(created)),
    onCreationNotificationSchedulingError: (event, error) => {
      console.error("tmc_transfer_push_schedule_failed", {
        requestId: event.requestId,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  })(request);
}
