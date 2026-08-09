import { getApplicationServices } from "@/lib/server/application";
import { createTmcTransferRequestPostHandler } from "@/lib/server/http/tmc-transfer-request-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createTmcTransferRequestPostHandler({
  authenticate: requireCurrentUser,
  createIdempotent: (input, actor, idempotencyKey) =>
    getApplicationServices().tmcTransferRequests.createIdempotent(
      input,
      actor,
      idempotencyKey,
    ),
});

export async function POST(request: Request) {
  return post(request);
}
