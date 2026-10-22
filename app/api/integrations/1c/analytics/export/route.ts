import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { requirePermission } from "@/lib/server/security/request-user";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { exportOneCAnalyticsExcel } from "@/lib/server/excel/one-c-analytics-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const snapshot = await getOneCAnalyticsSnapshot();
    const bytes = await exportOneCAnalyticsExcel(snapshot);
    return new Response(Buffer.from(bytes), { headers: {
      ...headers,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-length": String(bytes.byteLength),
      "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename="1c-inventory-${snapshot.analytics.calculatedAt.replace(/[:.]/gu, "-")}.xlsx"`,
    } });
  } catch (error) { return applicationErrorResponse(error, headers); }
}
