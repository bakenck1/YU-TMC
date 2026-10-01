import { Buffer } from "node:buffer";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { exportInventorySourceAuditExcel } from "@/lib/server/excel/inventory-source-audit-excel";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const { id } = await context.params;
    if (!UUID.test(id)) throw new ApplicationError("validation", "invalid_request");
    const data = await getApplicationServices().oneCReconciliation.exportInventoryAudit(id);
    const bytes = await exportInventorySourceAuditExcel(data);
    return new Response(Buffer.from(bytes), { headers: { "cache-control": "private, no-store", "content-disposition": `attachment; filename="inventory-source-audit-${id}.xlsx"`, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x-content-type-options": "nosniff" } });
  } catch (error) { return applicationErrorResponse(error, { "cache-control": "private, no-store" }); }
}
