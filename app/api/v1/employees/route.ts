import { listDockflowEmployees } from "@/lib/dockflow-test-api";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return listDockflowEmployees(request);
}
