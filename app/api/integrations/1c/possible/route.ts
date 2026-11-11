import { requirePermission } from "@/lib/server/security/request-user";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { classifyOneCAudit } from "@/lib/one-c-analytics";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store" };
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const snapshot = await getOneCAnalyticsSnapshot();
    const presence = classifyOneCAudit(snapshot.rows);
    const assets = new Map((snapshot.registryAssets ?? snapshot.assets).map(entry => [entry.externalId, entry.asset]));
    const data = snapshot.rows.filter(row => presence.get(row.itemId)?.category === "possible").map(row => ({
      id: row.itemId, name: row.itemName, inventoryNumber: row.siteNumber,
      candidates: [
        ...row.oneC.map(entry => ({ name: entry.name, code: entry.code, number: entry.inventoryNumber, price: assets.get(entry.externalId)?.initialCost ?? null, responsible: entry.responsibleName ?? null })),
        ...row.excel.map(entry => ({ name: entry.nomenclature, code: entry.oneCCode ?? null, number: entry.sourceInventoryNumber ?? entry.explicitInventoryNumber ?? entry.inventoryNumber, price: entry.unitPrice ?? null, responsible: entry.responsibleName ?? null })),
      ],
    }));
    return Response.json({ data }, { headers });
  } catch (error) { return applicationErrorResponse(error, headers); }
}
