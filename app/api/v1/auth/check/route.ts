import { dockflowAuthCheck } from "@/lib/dockflow-api";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return dockflowAuthCheck(request);
}
