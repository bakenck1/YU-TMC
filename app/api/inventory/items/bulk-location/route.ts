import { getApplicationServices } from "@/lib/server/application";
import { createTmcBulkLocationPostHandler } from "@/lib/server/http/tmc-bulk-location-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createTmcBulkLocationPostHandler({
  authenticate: requireCurrentUser,
  changeLocation: (input, actor) =>
    getApplicationServices().items.bulkChangeLocation(input, actor),
});

export const POST = post;
