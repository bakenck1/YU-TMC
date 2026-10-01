import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const { id } = await context.params;
    if (!UUID.test(id)) throw new ApplicationError("validation", "invalid_request");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!["page", "pageSize", "search", "result", "source"].includes(key)) throw new ApplicationError("validation", "invalid_request");
    const page = positive(params.get("page"), 1, 1_000_000);
    const pageSize = positive(params.get("pageSize"), 50, 100);
    const search = params.get("search")?.trim() || undefined;
    const result = params.get("result") || undefined;
    const source = params.get("source") || undefined;
    if ((search && search.length > 160) || (result && !["matched", "missing", "temporary"].includes(result)) || (source && !["1c", "excel", "1c+excel"].includes(source))) throw new ApplicationError("validation", "invalid_request");
    const audit = await getApplicationServices().oneCReconciliation.getInventoryAuditPage(id, { page, pageSize, search, result, source });
    return Response.json({ audit }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return applicationErrorResponse(error, { "cache-control": "private, no-store" }); }
}
function positive(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(parsed) || parsed > max) throw new ApplicationError("validation", "invalid_request");
  return parsed;
}
