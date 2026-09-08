import { getApplicationServices } from "@/lib/server/application";
import { createAssetLossReceiptHandlers } from "@/lib/server/http/asset-loss-handlers";
import { normalizeUploadedPhoto } from "@/lib/server/photos/normalize-uploaded-photo";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlers() { return createAssetLossReceiptHandlers({ authenticate: async (request) => authorizationActor(await requireCurrentUser(request)), normalize: normalizeUploadedPhoto, service: getApplicationServices().assetLosses }); }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlers().GET(request, (await params).id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlers().POST(request, (await params).id);
}
