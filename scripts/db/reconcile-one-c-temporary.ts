import { loadTargetEnvironment, parseTargetArgument, formatDatabaseCommandError } from "@/lib/db/cli";
import { closeDatabase, getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import { InventoryAuditEnrichmentService } from "@/lib/server/inventory-audit-enrichment-service";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const actorArgs = args.filter(arg => arg.startsWith("--actor-id="));
  if (actorArgs.length > 1 || args.filter(arg => arg === "--apply").length > 1) throw new Error("invalid_arguments");
  const actorId = actorArgs[0]?.slice("--actor-id=".length);
  if (actorId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(actorId)) throw new Error("invalid_actor_id");
  const target = parseTargetArgument(args.filter(arg => arg !== "--apply" && !arg.startsWith("--actor-id=")));
  loadTargetEnvironment(target);
  try {
    const pool = getDatabasePool();
    const admins = await pool.query<{ id: string; version: number }>(`select id,version from yu_inventory.users
      where role='admin' and is_active and deleted_at is null ${actorId ? "and id=$1" : ""}
      order by id limit 1`, actorId ? [actorId] : []);
    const admin = admins.rows[0];
    if (!admin) throw new ApplicationError("forbidden", "active_admin_required");
    const actor = { userId: admin.id, role: "admin" as const, sessionVersion: admin.version };
    const service = new InventoryAuditEnrichmentService(pool);
    const plan = await service.previewTemporary(actor);
    const result = apply ? await service.applyCurrent({ runId: plan.runId, planHash: plan.planHash }, actor) : null;
    const remaining = apply ? await service.previewTemporary(actor) : plan;
    const reasons: Record<string, number> = {};
    for (const row of remaining.rows.filter(row => !row.eligible)) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
    console.log(JSON.stringify({ target, mode: apply ? "apply" : "preview", actorId: admin.id,
      updated: result?.updated ?? 0, checked: remaining.rows.length,
      found: remaining.rows.filter(row => row.temporaryMatch?.found).length,
      remaining: remaining.counts, reasons,
      rows: remaining.rows.map(row => ({ itemId: row.itemId, siteNumber: row.siteNumber, found: row.temporaryMatch?.found,
        reason: row.reason, currentCode: row.currentCode, nextCode: row.nextCode, identityMethod: row.identityMethod })),
    }, null, 2));
  } finally { await closeDatabase(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApplicationError ? error.publicCode : formatDatabaseCommandError(error));
  process.exitCode = 1;
});
