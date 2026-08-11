import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { createYuApiClient } from "@/lib/server/integrations/yu-api-client";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "legacy.users.manage");
    await createYuApiClient().checkConnection();
    return Response.json({ connected: true });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
