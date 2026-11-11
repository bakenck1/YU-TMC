import "server-only";

import type { OneCAdminActor } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import type { InventoryAuditEnrichmentService } from "@/lib/server/inventory-audit-enrichment-service";

type Service = Pick<InventoryAuditEnrichmentService, "previewCurrent" | "applyCurrent">;

/** Use the same comparison and guarded write path as the administrator's review. */
export async function runOneCNightlyEnrichment(service: Service, actor: OneCAdminActor, apply: boolean) {
  const plan = await service.previewCurrent(actor);
  const result = apply && plan.counts.ready > 0
    ? await service.applyCurrent({ runId: plan.runId, planHash: plan.planHash }, actor)
    : null;
  // Log aggregate counts only: source rows can contain employee names.
  return { mode: apply ? "apply" : "preview", checked: plan.rows.length, counts: plan.counts, result };
}
