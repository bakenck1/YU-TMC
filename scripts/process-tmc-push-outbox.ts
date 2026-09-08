import { getApplicationServices } from "../lib/server/application";
import { closeDatabase } from "../lib/db/client";
import { emitStructuredEvent } from "../lib/server/observability";
import { randomUUID } from "node:crypto";

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
      emitStructuredEvent({
        level: result.deadLettered > 0 ? "warn" : "info",
        event: "tmc_push_outbox_cycle",
        requestId: randomUUID(),
        route: "worker:tmc-push",
        status: result.deadLettered > 0 ? 503 : 200,
        duration: 0,
        errorCode: result.deadLettered > 0 ? "tmc_push_dead_lettered" : "none",
        attributes: result,
      });
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

void main().catch(() => {
  emitStructuredEvent({
    level: "error",
    event: "tmc_push_worker_failed",
    requestId: randomUUID(),
    route: "worker:tmc-push",
    status: 500,
    duration: 0,
    errorCode: "tmc_push_worker_failed",
  });
  process.exitCode = 1;
});
