import { findDockflowEmployee } from "@/lib/dockflow-test-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ iin: string }> },
) {
  const { iin } = await params;
  return findDockflowEmployee(request, iin);
}
