import { listDockflowItems } from "@/lib/dockflow-api";
import { observeHttpRequest } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return observeHttpRequest(request, "/api/v1/items", () => listDockflowItems(request));
}
