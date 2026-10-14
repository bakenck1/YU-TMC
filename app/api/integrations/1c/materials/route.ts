import { getApplicationServices } from "@/lib/server/application";
import { observeHttpRequest } from "@/lib/server/observability";
import { createOneCMaterialsPostHandler, getOneCMaterialsCapability } from "@/lib/server/http/one-c-materials-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createOneCMaterialsPostHandler({
  service: {
    importSnapshot: (snapshot, metadata) =>
      getApplicationServices().oneCMaterials.importSnapshot(snapshot, metadata),
  },
});

export function GET(request: Request) {
  return observeHttpRequest(request, "/api/integrations/1c/materials", () => getOneCMaterialsCapability());
}

export function POST(request: Request) {
  return observeHttpRequest(request, "/api/integrations/1c/materials", () => post(request));
}
