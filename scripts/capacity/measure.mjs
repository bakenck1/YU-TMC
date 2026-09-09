import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { captureProductionCapacityScenarios, INVENTORY_COLLECTION_LIMIT, TMC_PUSH_WORKER_LEASE_MS } from "./production-scenarios.ts";
import { measureApplicationWorkloads } from "./application-workloads.ts";

const root = process.cwd();
const databaseUrl = process.env.CAPACITY_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CAPACITY_DATABASE_URL is required.");
const outputPrefix = process.env.CAPACITY_OUTPUT_PREFIX ?? path.join(root, "docs", "capacity-baseline-v1");
const dataset = JSON.parse(await readFile(new URL("./dataset-v1.json", import.meta.url), "utf8"));
const startedAt = new Date();
const initialMemory = process.memoryUsage();
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: dataset.load.poolSize,
  // This process cannot mutate even if a future scenario accidentally contains write SQL.
  options: "-c default_transaction_read_only=on",
});

try {
  const environment = await readEnvironment(pool);
  const cardinality = await readCardinality(pool);
  assertCardinality(cardinality, dataset.cardinality);
  const scenarios = await captureProductionCapacityScenarios(dataset.epoch);

  const queries = {};
  for (const [name, statements] of Object.entries(scenarios)) {
    queries[name] = await measureQuery(pool, name, statements, dataset);
  }
  const poolSaturation = await measurePoolSaturation(pool, scenarios.dockflow_projection, dataset);
  const statementTimeout = await verifyStatementTimeout(pool, dataset.load.statementTimeoutMs);
  const applicationWorkloads = await measureApplicationWorkloads(dataset);
  const collectionOutcomes = {
    inventory_list: collectionOutcome(cardinality.items, INVENTORY_COLLECTION_LIMIT),
    export_source: collectionOutcome(cardinality.items, INVENTORY_COLLECTION_LIMIT),
  };
  const worker = process.env.CAPACITY_DISPOSABLE_WORKER_PROBE === "1"
    ? await measureDisposableWorkerShutdown(pool, dataset)
    : { measured: false, reason: "Enable only on a disposable database with CAPACITY_DISPOSABLE_WORKER_PROBE=1." };
  const routeChunks = await readRouteChunkMetrics(root);
  const finalMemory = process.memoryUsage();

  const bottlenecks = rankBottlenecks({ queries, applicationWorkloads, collectionOutcomes, poolSaturation, statementTimeout, worker, routeChunks, initialMemory, finalMemory }, dataset);
  const report = {
    schemaVersion: 1,
    dataset: { version: dataset.version, epoch: dataset.epoch, description: dataset.description, expected: dataset.cardinality, actual: cardinality },
    environment,
    load: dataset.load,
    measuredAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    queries,
    applicationWorkloads,
    collectionOutcomes,
    poolSaturation,
    statementTimeout,
    worker,
    processMemoryMiB: {
      rssBefore: bytesToMiB(initialMemory.rss),
      rssAfter: bytesToMiB(finalMemory.rss),
      heapUsedBefore: bytesToMiB(initialMemory.heapUsed),
      heapUsedAfter: bytesToMiB(finalMemory.heapUsed),
    },
    productionRouteChunks: routeChunks,
    bottlenecks,
  };
  await mkdir(path.dirname(outputPrefix), { recursive: true });
  await writeFile(`${outputPrefix}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(`${outputPrefix}.md`, renderMarkdown(report), "utf8");
  console.log(`Capacity baseline written to ${path.relative(root, outputPrefix)}.{json,md}`);
} finally {
  await pool.end();
}

async function readEnvironment(database) {
  const result = await database.query(`select current_setting('server_version') as postgres_version,
    current_setting('max_connections') as max_connections,
    current_setting('shared_buffers') as shared_buffers,
    current_setting('effective_cache_size') as effective_cache_size`);
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    postgres: result.rows[0],
    nextBuildId: await readFile(path.join(root, ".next", "BUILD_ID"), "utf8").then((value) => value.trim()).catch(() => null),
  };
}

async function readCardinality(database) {
  const tables = {
    users: "users", oneCInbox: "one_c_fixed_asset_inbox", buildings: "buildings", rooms: "rooms", items: "items", photos: "photos",
    legacyTransfers: "transfers", tmcTransferRequests: "tmc_transfer_requests",
    tmcTransferRequestItems: "tmc_transfer_request_items", assetLossCases: "asset_loss_cases",
    notificationEvents: "notification_events", auditEvents: "audit_records", webPushOutbox: "tmc_web_push_outbox",
  };
  const output = {};
  for (const [name, table] of Object.entries(tables)) {
    const result = await database.query(`select count(*)::int as count from yu_inventory.${table}`);
    output[name] = result.rows[0].count;
  }
  return output;
}

function assertCardinality(actual, expected) {
  const mismatches = Object.entries(expected).filter(([key, value]) => actual[key] !== value);
  if (mismatches.length) {
    throw new Error(`Dataset cardinality mismatch: ${mismatches.map(([key, value]) => `${key}=${actual[key]} (expected ${value})`).join(", ")}`);
  }
}

async function measureQuery(database, name, statements, config) {
  const samples = [];
  let retainedPlans = [];
  for (let index = 0; index < config.load.warmups + config.load.samples; index += 1) {
    const client = await database.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('statement_timeout', $1, true)", [`${config.load.statementTimeoutMs}ms`]);
      const plans = [];
      let elapsed = 0;
      for (const statement of statements) {
        const result = await client.query(`explain (analyze, buffers, format json) ${statement.sql}`, statement.values);
        const payload = result.rows[0]["QUERY PLAN"][0];
        elapsed += Number(payload["Execution Time"]);
        plans.push(payload);
      }
      await client.query("rollback");
      if (index >= config.load.warmups) samples.push(elapsed);
      retainedPlans = plans;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`${name} measurement failed`, { cause: error });
    } finally {
      client.release();
    }
  }
  return {
    fingerprint: createHash("sha256").update(statements.map((item) => item.sql.replace(/\s+/g, " ").trim()).join("\n-- next statement --\n")).digest("hex"),
    statementCount: statements.length,
    samplesMs: samples,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    sloMs: config.sloMs[name],
    planSummary: compactPlans(statements, retainedPlans).map((entry) => ({ executions: entry.executions, ...summarizePlan(entry.plan) })),
    plans: compactPlans(statements, retainedPlans),
  };
}

function compactPlans(statements, plans) {
  const compact = new Map();
  statements.forEach((statement, index) => {
    const fingerprint = createHash("sha256").update(statement.sql.replace(/\s+/g, " ").trim()).digest("hex");
    const existing = compact.get(fingerprint);
    if (existing) existing.executions += 1;
    else compact.set(fingerprint, { fingerprint, executions: 1, plan: plans[index] });
  });
  return [...compact.values()];
}

function summarizePlan(payload) {
  const rootPlan = payload.Plan;
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(rootPlan);
  return {
    rootNode: rootPlan["Node Type"],
    actualRows: rootPlan["Actual Rows"],
    planningMs: round(payload["Planning Time"]),
    executionMs: round(payload["Execution Time"]),
    sharedHitBlocks: nodes.reduce((sum, node) => sum + Number(node["Shared Hit Blocks"] ?? 0), 0),
    sharedReadBlocks: nodes.reduce((sum, node) => sum + Number(node["Shared Read Blocks"] ?? 0), 0),
    tempReadBlocks: nodes.reduce((sum, node) => sum + Number(node["Temp Read Blocks"] ?? 0), 0),
    tempWrittenBlocks: nodes.reduce((sum, node) => sum + Number(node["Temp Written Blocks"] ?? 0), 0),
    nodeTypes: [...new Set(nodes.map((node) => node["Node Type"]))],
  };
}

async function measurePoolSaturation(database, statements, config) {
  const durations = [];
  let maxWaiting = 0;
  const monitor = setInterval(() => { maxWaiting = Math.max(maxWaiting, database.waitingCount); }, 1);
  const began = performance.now();
  try {
    await Promise.all(Array.from({ length: config.load.concurrentScanners }, async () => {
      const start = performance.now();
      for (const statement of statements) await database.query(statement.sql, statement.values);
      durations.push(performance.now() - start);
    }));
  } finally {
    clearInterval(monitor);
  }
  return {
    concurrentScanners: config.load.concurrentScanners,
    poolSize: config.load.poolSize,
    maxWaiting,
    totalMs: round(performance.now() - began),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    errors: 0,
    saturated: maxWaiting > 0,
  };
}

async function verifyStatementTimeout(database, timeoutMs) {
  const client = await database.connect();
  const start = performance.now();
  try {
    await client.query("begin read only");
    await client.query("select set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
    await client.query("select pg_sleep($1)", [(timeoutMs + 250) / 1000]);
    return { configuredMs: timeoutMs, enforced: false, elapsedMs: round(performance.now() - start) };
  } catch (error) {
    return { configuredMs: timeoutMs, enforced: error?.code === "57014", elapsedMs: round(performance.now() - start), postgresCode: error?.code ?? "unknown" };
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

async function measureDisposableWorkerShutdown(database, config) {
  if (!/^capacity-local-/.test(process.env.TEST_DATABASE_DEPLOYMENT_ID ?? "")) {
    throw new Error("Worker probe requires TEST_DATABASE_DEPLOYMENT_ID=capacity-local-*.");
  }
  const workerUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(workerUrl.hostname)) {
    throw new Error("Worker probe only supports a loopback disposable database.");
  }
  if (config.load.workerLeaseSeconds !== TMC_PUSH_WORKER_LEASE_MS / 1000) {
    throw new Error("Dataset worker lease does not match the production service constant.");
  }
  const before = await database.query("select count(*)::int as count from yu_inventory.tmc_web_push_outbox where processed_at is not null");
  const workers = Array.from({ length: config.load.workerConcurrency }, () => startWorker(config.load.workerBatchSize));
  const cycles = await Promise.all(workers.map((worker) => worker.cycle));
  const cycleAt = Math.max(...cycles.map((cycle) => cycle.at));
  const exits = await Promise.all(workers.map((worker) => worker.exit));
  const after = await database.query("select count(*)::int as count from yu_inventory.tmc_web_push_outbox where processed_at is not null");
  const completedDelta = after.rows[0].count - before.rows[0].count;
  const claimed = cycles.reduce((sum, cycle) => sum + Number(cycle.event.attributes?.claimed ?? 0), 0);
  if (completedDelta !== claimed) throw new Error(`Worker claim mismatch: claimed ${claimed}, completed ${completedDelta}.`);
  return {
    measured: true,
    workerConcurrency: config.load.workerConcurrency,
    batchSize: config.load.workerBatchSize,
    leaseSeconds: TMC_PUSH_WORKER_LEASE_MS / 1000,
    claimed,
    completedDelta,
    duplicateClaims: claimed - completedDelta,
    shutdownMode: "one_cycle_natural_exit",
    gracefulShutdownMs: round(performance.now() - cycleAt),
    gracefulShutdownBudgetMs: config.load.gracefulShutdownBudgetMs,
    exits,
  };
}

function startWorker(batchSize) {
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/process-tmc-push-outbox.ts", String(batchSize)], {
    cwd: root,
    env: { ...process.env, OBSERVABILITY_TEST_STDOUT: "true", TMC_PUSH_WORKER_INTERVAL_MS: "5000" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  const cycle = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker cycle timed out: ${output.slice(-500)}`)), 20_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!output.includes("tmc_push_outbox_cycle")) return;
      clearTimeout(timer);
      const eventLine = output.split(/\r?\n/).find((line) => line.includes('"event":"tmc_push_outbox_cycle"'));
      if (!eventLine) return;
      resolve({ at: performance.now(), event: JSON.parse(eventLine) });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("tmc_push_outbox_cycle")) reject(new Error(`Worker exited before cycle (${code}): ${output.slice(-500)}`));
    });
  });
  const exit = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Worker did not stop inside 10 seconds.")); }, 30_000);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  return { child, cycle, exit };
}

async function readRouteChunkMetrics(projectRoot) {
  const manifestPath = path.join(projectRoot, ".next", "server", "app-paths-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const wanted = [
    "/(protected)/items/page", "/(protected)/analytics/page", "/(protected)/tmc/history/page",
    "/api/inventory/loss-cases/route", "/api/inventory/excel/route",
  ];
  const output = {};
  for (const route of wanted) {
    const entry = manifest[route];
    if (!entry) { output[route] = { available: false }; continue; }
    const entryPath = path.join(projectRoot, ".next", "server", entry);
    const source = await readFile(entryPath, "utf8");
    const references = [...source.matchAll(/R\.c\("([^"]+)"\)/g)].map((match) => match[1]);
    const files = [path.relative(path.join(projectRoot, ".next"), entryPath), ...new Set(references)];
    let bytes = 0;
    for (const file of files) bytes += (await stat(path.join(projectRoot, ".next", file))).size;
    const clientManifestPath = entryPath.replace(/\.js$/, "_client-reference-manifest.js");
    const clientSource = await readFile(clientManifestPath, "utf8").catch(() => null);
    const clientFiles = clientSource
      ? [...new Set([...clientSource.matchAll(/(?:\/_next\/)?(static\/chunks\/[A-Za-z0-9_.-]+\.(?:js|css))/g)].map((match) => match[1]))]
      : [];
    let clientBytes = 0;
    for (const file of clientFiles) clientBytes += (await stat(path.join(projectRoot, ".next", file))).size;
    output[route] = {
      available: true,
      server: { files: files.length, bytes, kib: round(bytes / 1024) },
      client: { available: clientSource !== null, files: clientFiles.length, bytes: clientBytes, kib: round(clientBytes / 1024) },
    };
  }
  return output;
}

function rankBottlenecks(metrics, config) {
  const output = Object.entries(metrics.queries)
    .filter(([, value]) => value.p95Ms > value.sloMs)
    .map(([name, value]) => ({ id: name, metric: "p95Ms", measured: value.p95Ms, budget: value.sloMs, ratio: round(value.p95Ms / value.sloMs), followUp: `Profile ${name} independently; expected gain is p95 <= ${value.sloMs}ms; rollback any query/index change that misses that budget.` }));
  if (!metrics.statementTimeout.enforced) output.push({ id: "statement_timeout", metric: "enforced", measured: false, budget: true, ratio: Infinity, followUp: "Restore fail-closed statement timeout enforcement; rollback configuration if cancellation cannot be demonstrated." });
  for (const [name, value] of Object.entries(metrics.collectionOutcomes)) {
    if (!value.withinLimit) output.push({ id: `${name}_capacity`, metric: "rows", measured: value.rows, budget: value.limit, ratio: round(value.rows / value.limit), followUp: `Replace the fail-closed whole-collection path with a bounded product contract; expected capacity is at least ${value.rows} rows; rollback if authorization, export completeness, or memory regresses.` });
  }
  for (const [name, value] of Object.entries(metrics.applicationWorkloads)) {
    if (value.p95Ms > value.sloMs) output.push({ id: name, metric: "p95Ms", measured: value.p95Ms, budget: value.sloMs, ratio: round(value.p95Ms / value.sloMs), followUp: `Profile ${name} independently; expected gain is p95 <= ${value.sloMs}ms; rollback if the workload output contract changes.` });
  }
  if (metrics.poolSaturation.p95Ms > config.budgets.poolP95Ms) output.push({ id: "pool_saturation", metric: "p95Ms", measured: metrics.poolSaturation.p95Ms, budget: config.budgets.poolP95Ms, ratio: round(metrics.poolSaturation.p95Ms / config.budgets.poolP95Ms), followUp: `Profile pool waits at ${config.load.concurrentScanners} scanners; expected gain is p95 <= ${config.budgets.poolP95Ms}ms; rollback pool sizing if database saturation rises.` });
  const exportGrowth = metrics.applicationWorkloads.export_workbook.peakGrowthMiB;
  if (exportGrowth > config.budgets.processRssGrowthMiB) output.push({ id: "export_memory", metric: "peakGrowthMiB", measured: exportGrowth, budget: config.budgets.processRssGrowthMiB, ratio: round(exportGrowth / config.budgets.processRssGrowthMiB), followUp: `Profile retained heap and workbook allocation; expected isolated export peak growth <= ${config.budgets.processRssGrowthMiB} MiB; rollback changes that alter workbook content or increase peak memory.` });
  for (const [route, value] of Object.entries(metrics.routeChunks)) {
    if (value.client?.kib > config.budgets.routeClientKiB) output.push({ id: `route_chunk:${route}`, metric: "clientKiB", measured: value.client.kib, budget: config.budgets.routeClientKiB, ratio: round(value.client.kib / config.budgets.routeClientKiB), followUp: `Analyze this route with the Next bundle analyzer; expected client payload <= ${config.budgets.routeClientKiB} KiB; rollback splitting if navigation regresses.` });
  }
  if (metrics.worker.measured && metrics.worker.gracefulShutdownMs > config.load.gracefulShutdownBudgetMs) {
    output.push({ id: "worker_shutdown", metric: "gracefulShutdownMs", measured: metrics.worker.gracefulShutdownMs, budget: config.load.gracefulShutdownBudgetMs, ratio: round(metrics.worker.gracefulShutdownMs / config.load.gracefulShutdownBudgetMs), followUp: `Reduce shutdown below ${config.load.gracefulShutdownBudgetMs}ms without shortening the ${config.load.workerLeaseSeconds}s recovery lease; rollback if delivery duplication increases.` });
  }
  return output.sort((left, right) => right.ratio - left.ratio);
}

function renderMarkdown(report) {
  const queryRows = Object.entries(report.queries).map(([name, value]) => {
    const summary = value.planSummary.map((plan) => `${plan.executions}× ${plan.rootNode}; hit/read ${plan.sharedHitBlocks}/${plan.sharedReadBlocks}`).join(" + ");
    return `| ${name} (${value.statementCount}) | \`${value.fingerprint.slice(0, 12)}\` | ${value.p50Ms} | ${value.p95Ms} | ${value.sloMs} | ${summary} |`;
  }).join("\n");
  const cardinalityRows = Object.entries(report.dataset.actual).map(([name, value]) => `| ${name} | ${value.toLocaleString("en-US")} |`).join("\n");
  const workloadRows = Object.entries(report.applicationWorkloads).map(([name, value]) => `| ${name} | ${value.records} | ${value.p50Ms} | ${value.p95Ms} | ${value.sloMs} |`).join("\n");
  const bottlenecks = report.bottlenecks.length
    ? report.bottlenecks.map((item, index) => `${index + 1}. **${item.id}** — ${item.metric} ${item.measured}, budget ${item.budget}. Follow-up: ${item.followUp}`).join("\n")
    : "No measured query, timeout, or worker-shutdown bottleneck exceeded its declared budget. No speculative optimization task was created.";
  return `# Capacity baseline ${report.dataset.version}\n\nGenerated ${report.measuredAt}. Synthetic data only; no production dump or PII was used. Full PostgreSQL plans are stored in the adjacent JSON report. This is a nightly/release baseline, not a PR timing gate.\n\n## Environment\n\n- Node: ${report.environment.node}; PostgreSQL: ${report.environment.postgres.postgres_version}; platform: ${report.environment.platform}\n- CPU: ${report.environment.cpuCount} × ${report.environment.cpuModel}\n- PostgreSQL: max_connections=${report.environment.postgres.max_connections}, shared_buffers=${report.environment.postgres.shared_buffers}, effective_cache_size=${report.environment.postgres.effective_cache_size}\n- Next production build: ${report.environment.nextBuildId ?? "not available"}\n- Statement timeout: ${report.statementTimeout.configuredMs}ms, enforced=${report.statementTimeout.enforced}, observed=${report.statementTimeout.elapsedMs}ms\n\n## Dataset\n\n| Collection | Rows |\n| --- | ---: |\n${cardinalityRows}\n\nTargets: ${report.load.concurrentScanners} concurrent scanners, pool ${report.load.poolSize}, worker concurrency ${report.load.workerConcurrency}, batch ${report.load.workerBatchSize}, lease ${report.load.workerLeaseSeconds}s. Fixed dataset epoch: ${report.dataset.epoch}.\n\nRepository collection outcome: inventory=${report.collectionOutcomes.inventory_list.withinLimit ? "within limit" : `FAILS above ${report.collectionOutcomes.inventory_list.limit} rows`}; export=${report.collectionOutcomes.export_source.withinLimit ? "within limit" : `FAILS above ${report.collectionOutcomes.export_source.limit} rows`}. Query latency below does not override this functional verdict.\n\n## Read-only PostgreSQL baseline\n\nEach scenario ran ${report.load.warmups} warmups plus ${report.load.samples} measured samples in \`BEGIN READ ONLY\` with \`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\`. Multi-statement rows represent the complete production repository operation, including TMC history hydration.\n\n| Scenario (statements) | SHA-256 fingerprint | P50 ms | P95 ms | SLO ms | Plan summary |\n| --- | --- | ---: | ---: | ---: | --- |\n${queryRows}\n\n## XML and export workloads\n\n| Scenario | Records | P50 ms | P95 ms | SLO ms |\n| --- | ---: | ---: | ---: | ---: |\n${workloadRows}\n\nPool saturation: ${report.poolSaturation.concurrentScanners} requests through ${report.poolSaturation.poolSize} connections, P50 ${report.poolSaturation.p50Ms}ms, P95 ${report.poolSaturation.p95Ms}ms, total ${report.poolSaturation.totalMs}ms, max waiting ${report.poolSaturation.maxWaiting}, errors ${report.poolSaturation.errors}.\n\nWorker probe: ${report.worker.measured ? `${report.worker.workerConcurrency} one-cycle workers claimed ${report.worker.claimed} distinct events (duplicates ${report.worker.duplicateClaims}); natural shutdown ${report.worker.gracefulShutdownMs}ms against ${report.worker.gracefulShutdownBudgetMs}ms budget, verified production lease ${report.worker.leaseSeconds}s` : report.worker.reason}\n\nProcess RSS: ${report.processMemoryMiB.rssBefore} MiB → ${report.processMemoryMiB.rssAfter} MiB; heap used: ${report.processMemoryMiB.heapUsedBefore} MiB → ${report.processMemoryMiB.heapUsedAfter} MiB. Production client and server route chunks are recorded in the JSON report from the Next build manifests; Storybook is not used as a proxy.\n\n## Ranked bottlenecks\n\n${bottlenecks}\n`;
}

function collectionOutcome(rows, limit) { return { rows, limit, withinLimit: rows <= limit }; }

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0);
}
function round(value) { return Math.round(Number(value) * 100) / 100; }
function bytesToMiB(value) { return round(value / 1024 / 1024); }
