import { findDockflowEmployeeItems } from "@/lib/dockflow-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ iin: string }> },
) {
  const { iin } = await params;
  return findDockflowEmployeeItems(request, iin);
}
