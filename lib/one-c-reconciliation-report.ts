import { classifyOneCAudit } from "@/lib/one-c-analytics";
import { isTemporaryOneCCard } from "@/lib/one-c-material-code";
import { getOneCMatchedCards } from "@/lib/one-c-matched-cards";
import type { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";

/** Diagnose the exact card sets behind the counters without changing inventory. */
export function buildOneCReconciliationReport(snapshot: Awaited<ReturnType<typeof getOneCAnalyticsSnapshot>>, itemIds: string[] = []) {
  const counts = snapshot.analytics.reconciliation;
  const presence = classifyOneCAudit(snapshot.rows);
  const matched = getOneCMatchedCards(snapshot);
  const materials = new Set(matched.filter(card => card.group === "materials").map(card => card.id));
  const assets = new Set(matched.filter(card => card.group === "assets").map(card => card.id));
  const temporary = snapshot.rows.filter(row => isTemporaryOneCCard(row.numberKind, row.siteNumber));
  const temporaryFound = temporary.filter(row => {
    const confirmed = presence.get(row.itemId)!;
    return confirmed.fixedAssets || confirmed.materials;
  });
  const unmatched = temporary.filter(row => presence.get(row.itemId)!.category === "missing");
  const unmatchedIds = new Set(unmatched.map(row => row.itemId));
  const describe = (row: (typeof snapshot.rows)[number]) => ({
    id: row.itemId, inventoryNumber: row.siteNumber, oneCCode: row.siteOneCCode ?? null,
    group: materials.has(row.itemId) ? "materials" : assets.has(row.itemId) ? "assets" : unmatchedIds.has(row.itemId) ? "temporaryUnmatched" : presence.get(row.itemId)!.category,
    sourceCodes: [...new Set([...row.oneC.map(entry => entry.code), ...row.excel.map(entry => entry.oneCCode)].filter(Boolean))],
  });
  const checks = {
    materialsCountMatchesList: counts.materials + counts.both === materials.size,
    assetsCountMatchesList: counts.fixedAssets === assets.size,
    temporaryFoundCountMatchesRows: counts.temporaryFound === temporaryFound.length,
    temporaryUnmatchedCountMatchesRows: counts.temporaryUnmatched === unmatched.length,
    everyFoundTemporaryIsInMaterials: temporaryFound.every(row => materials.has(row.itemId)),
    noFoundCardIsInTemporaryUnmatched: matched.every(card => !unmatchedIds.has(card.id)),
    categoriesSumToTotal: counts.fixedAssets + counts.materials + counts.both + counts.possible + counts.missing + (counts.temporaryUnmatched ?? 0) === counts.total,
  };
  return {
    calculatedAt: snapshot.analytics.calculatedAt,
    counters: counts,
    verified: Object.values(checks).every(Boolean),
    checks,
    temporaryFoundCards: temporaryFound.map(describe),
    temporaryUnmatchedWithSavedCode: unmatched.filter(row => row.siteOneCCode?.trim()).map(describe),
    requestedCards: itemIds.map(id => {
      const row = snapshot.rows.find(row => row.itemId === id);
      return row ? describe(row) : { id, group: "not_in_snapshot" };
    }),
  };
}
