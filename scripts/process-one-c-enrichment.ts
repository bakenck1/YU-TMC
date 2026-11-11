import { closeDatabase, getDatabasePool } from "@/lib/db/client";
import { formatDatabaseCommandError, loadTargetEnvironment, parseTargetArgument } from "@/lib/db/cli";
import { ApplicationError } from "@/lib/domain/application-error";
import { InventoryAuditEnrichmentService } from "@/lib/server/inventory-audit-enrichment-service";
import { runOneCNightlyEnrichment } from "@/lib/server/one-c-nightly-enrichment";

async function main() {
  const args = process.argv.slice(2);
  if (args.filter(arg => arg === "--apply").length > 1) throw new Error("invalid_arguments");
  const target = parseTargetArgument(args.filter(arg => arg !== "--apply"));
  loadTargetEnvironment(target);

  try {
    const pool = getDatabasePool();
    // Match the existing responsibility maintenance command's actor policy.
    const admins = await pool.query<{ id: string; version: number }>(`select id,version from yu_inventory.users
      where role='admin' and is_active and deleted_at is null order by id limit 1`);
    const admin = admins.rows[0];
    if (!admin) throw new ApplicationError("forbidden", "active_admin_required");
    const actor = { userId: admin.id, role: "admin" as const, sessionVersion: admin.version };
    const summary = await runOneCNightlyEnrichment(new InventoryAuditEnrichmentService(pool), actor, args.includes("--apply"));
    console.log(JSON.stringify({ job: "one_c_nightly_enrichment", target, actorId: admin.id, ...summary }));
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApplicationError ? error.publicCode : formatDatabaseCommandError(error));
  process.exitCode = 1;
});
