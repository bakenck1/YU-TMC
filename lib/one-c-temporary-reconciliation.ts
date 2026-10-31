import type { InventoryAuditEnrichmentPlan } from "@/lib/inventory-audit-enrichment";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { classifyOneCAudit } from "@/lib/one-c-analytics";
import { isTemporaryOneCCard } from "@/lib/one-c-material-code";

/** Scope the reviewed changes on the server, including the counts used by Apply. */
export function temporaryReconciliationPlan<T extends InventoryAuditEnrichmentPlan>(plan: T, evidence: AuditMatch[]): T {
  const temporary = evidence.filter(row => isTemporaryOneCCard(row.numberKind, row.siteNumber));
  const presence = classifyOneCAudit(temporary);
  const rows = plan.rows.filter(row => presence.has(row.itemId)).map(row => {
    const match = presence.get(row.itemId)!;
    return { ...row, temporaryMatch: { found: match.fixedAssets || match.materials, category: match.category } };
  });
  return { ...plan, rows, counts: {
    ready: rows.filter(row => row.eligible && row.changed).length,
    unchanged: rows.filter(row => row.eligible && !row.changed).length,
    skipped: rows.filter(row => !row.eligible).length,
  } };
}
