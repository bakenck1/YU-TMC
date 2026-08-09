import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestPostHandler } from "@/lib/server/http/tmc-transfer-request-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const services = getApplicationServices();
  return createTmcTransferRequestPostHandler({
    authenticate: requireCurrentUser,
    createIdempotent: (input, actor, idempotencyKey) =>
      services.tmcTransferRequests.createIdempotent(input, actor, idempotencyKey),
    onCreated: (event) => {
      after(() => services.push.notifyTmcTransferRequest(event));
    },
  })(request);
}
