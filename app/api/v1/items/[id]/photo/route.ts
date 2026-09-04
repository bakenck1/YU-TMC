import { findDockflowItemPhoto } from "@/lib/dockflow-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return findDockflowItemPhoto(request, id);
}
