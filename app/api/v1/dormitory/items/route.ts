import { listDormitoryAssets } from "@/lib/dormitory-api";
import { observeHttpRequest } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return observeHttpRequest(request, "/api/v1/dormitory/items", () => listDormitoryAssets(request));
}
