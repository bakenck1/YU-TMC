import { listDockflowEmployees } from "@/lib/dockflow-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listDockflowEmployees(request);
}
