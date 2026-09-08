import { getApplicationServices } from "@/lib/server/application";
import { createAssetLossReviewHandler } from "@/lib/server/http/asset-loss-handlers";
import { observeHttpRequest } from "@/lib/server/observability";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handler() { return createAssetLossReviewHandler({ authenticate: async (request) => authorizationActor(await requirePermission(request, "inventory.item.manage_protected_fields")), service: getApplicationServices().assetLosses }); }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return observeHttpRequest(request, "/api/inventory/loss-cases/:id/review", async () => handler()(request, (await params).id));
}
