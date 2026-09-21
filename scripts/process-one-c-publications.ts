import { closeDatabase } from "@/lib/db/client";
import {
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";

async function main() {
  const target = parseTargetArgument(process.argv.slice(2));
  loadTargetEnvironment(target);

  const service = new OneCReconciliationService();
  let processedChunks = 0;

  try {
    while (await service.processNextPublication()) {
      processedChunks += 1;
    }
    console.log(JSON.stringify({ target, processedChunks }));
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "1C publication worker failed.",
  );
  process.exitCode = 1;
});
