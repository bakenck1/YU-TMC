import { formatDatabaseCommandError, loadTargetEnvironment, parseTargetArgument } from "@/lib/db/cli";
import { closeDatabase } from "@/lib/db/client";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { buildOneCReconciliationReport } from "@/lib/one-c-reconciliation-report";

async function main() {
  const args = process.argv.slice(2);
  const itemIds = args.filter(arg => arg.startsWith("--item=")).map(arg => arg.slice("--item=".length));
  const target = parseTargetArgument(args.filter(arg => !arg.startsWith("--item=")));
  loadTargetEnvironment(target);
  try {
    const snapshot = await getOneCAnalyticsSnapshot();
    const report = buildOneCReconciliationReport(snapshot, itemIds);
    console.log(JSON.stringify(report, null, 2));
    if (!report.verified) process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
