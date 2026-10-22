import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { requirePermission } from "@/lib/server/security/request-user";
import { getFixedAssetRegistryPage } from "@/lib/server/one-c-fixed-asset-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("pageSize") ?? 50);
    const search = (params.get("search") ?? "").trim();
    const scope = params.get("scope") ?? "active";
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || ![50, 100].includes(pageSize) || search.length > 255 || !["active", "all"].includes(scope)) {
      throw new ApplicationError("validation", "invalid_request");
    }
    return Response.json(await getFixedAssetRegistryPage({ page, pageSize, search, scope: scope as "active" | "all" }), { headers });
  } catch (error) { return applicationErrorResponse(error, headers); }
}
