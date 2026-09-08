import { getApplicationServices } from "@/lib/server/application";
import { createAssetLossCollectionHandlers } from "@/lib/server/http/asset-loss-handlers";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlers() { return createAssetLossCollectionHandlers({ authenticate: async (request) => authorizationActor(await requireCurrentUser(request)), service: getApplicationServices().assetLosses }); }

export async function GET(request: Request) {
  return handlers().GET(request);
}

export async function POST(request: Request) {
  return handlers().POST(request);
}
