import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { createYuApiClient } from "@/lib/server/integrations/yu-api-client";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "legacy.users.manage");
    const query = new URL(request.url).searchParams.get("q") ?? "";
    if (Array.from(query.trim()).length < 2) {
      throw new ApplicationError("validation", "invalid_yu_api_query");
    }
    return Response.json({
      personnel: await createYuApiClient().searchPersonnel(query),
    });
  } catch (error) {
    return applicationErrorResponse(error);
  }
}
