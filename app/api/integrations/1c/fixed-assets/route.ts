import { createOneCFixedAssetsPostHandler, getOneCFixedAssetsCapability } from "@/lib/server/http/one-c-fixed-assets-handler";
import { getApplicationServices } from "@/lib/server/application";
import { observeHttpRequest } from "@/lib/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return observeHttpRequest(request, "/api/integrations/1c/fixed-assets", () => getOneCFixedAssetsCapability());
}

const post = createOneCFixedAssetsPostHandler({
  service: {
    importBatch: (assets) => getApplicationServices().oneCFixedAssets.importBatch(assets),
    tryAcquireLease: (keyId) => getApplicationServices().oneCFixedAssets.tryAcquireLease(keyId),
  },
});

export function POST(request: Request) {
  return observeHttpRequest(request, "/api/integrations/1c/fixed-assets", () => post(request));
}
