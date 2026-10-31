import { loadTargetEnvironment, parseTargetArgument, formatDatabaseCommandError } from "@/lib/db/cli";
import { closeDatabase, getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import { InventoryAuditEnrichmentService, responsibilityCounts } from "@/lib/server/inventory-audit-enrichment-service";

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
    // The operator can choose an administrator explicitly. Otherwise use a stable
    // active admin; backfill audit records identify the maintenance command origin.
    const admins = await pool.query<{ id: string; version: number }>(`select id,version from yu_inventory.users
      where role='admin' and is_active and deleted_at is null ${actorId ? "and id=$1" : ""}
      order by id limit 1`, actorId ? [actorId] : []);
    const admin = admins.rows[0];
    if (!admin) throw new ApplicationError("forbidden", "active_admin_required");
    const actor = { userId: admin.id, role: "admin" as const, sessionVersion: admin.version };
    const service = new InventoryAuditEnrichmentService(pool);
    const result = apply ? await service.fillMissingResponsibilities(actor) : null;
    // Read back the stored periods using a new transaction. This also verifies
    // that a second run has no duplicate assignments to create.
    const remaining = await service.previewMissingResponsibilities(actor);
    const missingAccounts = new Map<string, number>();
    for (const row of remaining.rows) if (row.responsibility?.status === "user_missing" && row.responsibility.sourceName) {
      const name = row.responsibility.sourceName;
      missingAccounts.set(name, (missingAccounts.get(name) ?? 0) + 1);
    }
    console.log(JSON.stringify({
      target, mode: apply ? "apply" : "preview", actorId: admin.id,
      checked: remaining.rows.length, updated: result?.updated ?? 0,
      remainingReady: remaining.counts.ready,
      responsibilityCounts: responsibilityCounts(remaining),
      missingAccounts: [...missingAccounts].map(([sourceName, items]) => ({ sourceName, items })),
    }, null, 2));
    if (apply && remaining.counts.ready > 0) throw new ApplicationError("conflict", "one_c_responsibilities_changed_during_verification");
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApplicationError ? error.publicCode : formatDatabaseCommandError(error));
  process.exitCode = 1;
});
