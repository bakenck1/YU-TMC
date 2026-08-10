import { getApplicationServices } from "../lib/server/application";
import { closeDatabase } from "../lib/db/client";

async function main() {
  const continuous = process.argv.includes("--loop");
  const rawLimit = process.argv.find((value, index) => index >= 2 && /^\d+$/.test(value)) ?? "50";
  if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) {
    throw new Error("TMC push outbox limit must be between 1 and 100");
  }
  const rawInterval = process.env.TMC_PUSH_WORKER_INTERVAL_MS ?? "30000";
  if (!/^[1-9]\d{3,6}$/.test(rawInterval) || Number(rawInterval) < 5_000 || Number(rawInterval) > 3_600_000) {
    throw new Error("TMC_PUSH_WORKER_INTERVAL_MS must be between 5000 and 3600000");
  }
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { stopping = true; });
  }
  try {
    do {
      const result = await getApplicationServices().push.processTmcPushOutbox(Number(rawLimit));
      process.stdout.write(`${JSON.stringify({ event: "tmc_push_outbox_cycle", ...result })}\n`);
      if (result.deadLettered > 0 && !continuous) process.exitCode = 2;
      if (!continuous || stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Number(rawInterval));
        const poll = setInterval(() => {
          if (!stopping) return;
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }, 250);
      });
    } while (!stopping);
  } finally {
    await closeDatabase();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : "tmc_push_worker_failed"}\n`);
  process.exitCode = 1;
});
