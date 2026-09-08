import { dockflowAuthCheck } from "@/lib/dockflow-api";
import { observeHttpRequest } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return observeHttpRequest(request, "/api/v1/auth/check", () => dockflowAuthCheck(request));
}
