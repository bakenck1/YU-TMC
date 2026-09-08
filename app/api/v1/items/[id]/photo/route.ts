import { findDockflowItemPhoto } from "@/lib/dockflow-api";
import { observeHttpRequest } from "@/lib/server/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return observeHttpRequest(request, "/api/v1/items/:id/photo", () => findDockflowItemPhoto(request, id));
}
