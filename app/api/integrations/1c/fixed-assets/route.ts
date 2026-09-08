import { createOneCFixedAssetsPostHandler, getOneCFixedAssetsCapability } from "@/lib/server/http/one-c-fixed-assets-handler";
import { getApplicationServices } from "@/lib/server/application";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return getOneCFixedAssetsCapability();
}

export const POST = createOneCFixedAssetsPostHandler({
  service: {
    importBatch: (assets) => getApplicationServices().oneCFixedAssets.importBatch(assets),
    tryAcquireLease: (keyId) => getApplicationServices().oneCFixedAssets.tryAcquireLease(keyId),
  },
});
