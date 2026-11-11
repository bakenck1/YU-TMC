import { createDecommissionedEnrichmentHandlers } from "@/lib/server/http/decommissioned-enrichment-handler";
import { InventoryAuditEnrichmentService } from "@/lib/server/inventory-audit-enrichment-service";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createDecommissionedEnrichmentHandlers({
  authenticate: async request => authorizationActor(await requirePermission(request, "inventory.integration.one_c.manage")),
  service: () => new InventoryAuditEnrichmentService(),
});
export const GET = handlers.GET;
export const POST = handlers.POST;
