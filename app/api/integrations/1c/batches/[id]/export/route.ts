import { Buffer } from "node:buffer";

import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { exportOneCReconciliation, type OneCReconciliationExport } from "@/lib/server/excel/one-c-reconciliation-excel";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizationActor(await requirePermission(request, "inventory.integration.one_c.manage"));
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApplicationError("validation", "invalid_request");
    const data = await getApplicationServices().oneCReconciliation.exportBatch(id, actor) as OneCReconciliationExport;
    const bytes = await exportOneCReconciliation(data);
    return new Response(Buffer.from(bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="one-c-reconciliation-${id}.xlsx"`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return applicationErrorResponse(error, { "cache-control": "private, no-store" });
  }
}
