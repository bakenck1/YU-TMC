import { findDockflowEmployeeItems } from "@/lib/dockflow-api";
import { observeHttpRequest } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ iin: string }> },
) {
  const { iin } = await params;
  return observeHttpRequest(request, "/api/v1/employees/:iin/items", () => findDockflowEmployeeItems(request, iin));
}
