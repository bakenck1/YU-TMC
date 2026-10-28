import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { requirePermission } from "@/lib/server/security/request-user";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { getOneCMatchedCards } from "@/lib/one-c-matched-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    const params = new URL(request.url).searchParams;
    const group = params.get("group") ?? "materials";
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("pageSize") ?? 50);
    const search = (params.get("search") ?? "").trim();
    if (!["assets", "materials"].includes(group) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || ![50, 100].includes(pageSize) || search.length > 255) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const snapshot = await getOneCAnalyticsSnapshot();
    const key = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[\s/\\*._:·-]+/gu, "");
    const query = key(search);
    const cards = getOneCMatchedCards(snapshot).filter(card => card.group === group
      && (!query || [card.name, card.inventoryNumber, card.oneCCode, ...card.sourceCodes, card.responsibleName, card.barcode].some(value => value && key(value).includes(query))));
    cards.sort((a, b) => Number(!a.responsibleName) - Number(!b.responsibleName)
      || (a.responsibleName ?? "").localeCompare(b.responsibleName ?? "", "ru")
      || Number(b.oneCUnitPrice ?? b.currentUnitPrice ?? 0) - Number(a.oneCUnitPrice ?? a.currentUnitPrice ?? 0)
      || a.id.localeCompare(b.id));
    return Response.json({ data: cards.slice((page - 1) * pageSize, page * pageSize), total: cards.length, page, pageSize, calculatedAt: snapshot.analytics.calculatedAt }, { headers });
  } catch (error) { return applicationErrorResponse(error, headers); }
}
