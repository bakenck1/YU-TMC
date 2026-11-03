import { getApplicationServices } from "@/lib/server/application";
import { createTmcBulkOneCCodePatchHandler } from "@/lib/server/http/tmc-bulk-one-c-code-handler";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = createTmcBulkOneCCodePatchHandler({
  authenticate: async (request) => authorizationActor(await requireCurrentUser(request)),
  changeCode: (itemIds, oneCCode, actor) =>
    getApplicationServices().items.bulkChangeOneCCode(itemIds, oneCCode, actor),
});
