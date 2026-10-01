import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request: Request, context: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const { id, rowNumber } = await context.params;
    if (!UUID.test(id) || !/^[1-9]\d{0,5}$/u.test(rowNumber)) throw new ApplicationError("validation", "invalid_request");
    const row = await getApplicationServices().oneCReconciliation.getInventoryAuditExcelRow(id, Number(rowNumber));
    return Response.json({ row }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return applicationErrorResponse(error, { "cache-control": "private, no-store" }); }
}
