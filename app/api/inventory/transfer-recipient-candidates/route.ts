import { getApplicationServices } from "@/lib/server/application";
import { createTmcRecipientCandidatesGetHandler } from "@/lib/server/http/tmc-recipient-candidates-handler";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const get = createTmcRecipientCandidatesGetHandler({
  authenticate: (request) =>
    requirePermission(request, "inventory.tmc.transfer_request.create"),
  search: (query, actor) =>
    getApplicationServices().users.searchTmcRecipients(query, actor),
});

export async function GET(request: Request) {
  return get(request);
}
