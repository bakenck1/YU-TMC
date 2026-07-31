import { getApplicationServices } from "@/lib/server/application";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return Response.json(getApplicationServices().push.publicConfiguration(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
}
