#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const sourceFile = required(args, "source-file");
const outputFile = path.resolve(String(args["output-file"] ?? "legacy-usage-report.md"));
const from = parseDate(required(args, "from"), "--from");
const to = parseDate(required(args, "to"), "--to");
if (to <= from) throw new Error("--to must be later than --from");
if (to.getTime() > Date.now()) throw new Error("--to cannot be in the future");

const root = path.resolve(String(args.root ?? process.cwd()));
const baseline = JSON.parse(await readFile(path.join(root, "scripts/legacy-compatibility-baseline.json"), "utf8"));
const raw = await readFile(path.resolve(sourceFile), "utf8");
const coverageConfirmed = args["coverage-confirmed"] === "true";
const uptimeConfirmed = args["uptime-confirmed"] === "true";
const minimumWindowMs = Number(baseline.evidenceRetentionDays) * 24 * 60 * 60 * 1_000;
const completeWindow = to.getTime() - from.getTime() >= minimumWindowMs;
const evidenceComplete = completeWindow && coverageConfirmed && uptimeConfirmed;
const rows = baseline.inventoryIds.map((compatibilityId) => ({
  compatibilityId,
  owner: baseline.owners[compatibilityId],
  count: 0,
  variants: new Map(),
}));
const byId = new Map(rows.map((row) => [row.compatibilityId, row]));

for (const line of raw.split(/\r?\n/)) {
  const event = parseJson(line);
  if (!event || event.event !== "legacy.usage") continue;
  const timestamp = parseDateOrNull(event.timestamp);
  if (!timestamp || timestamp < from || timestamp >= to) continue;
  const compatibilityId = event.attributes?.compatibilityId;
  const variant = event.attributes?.variant;
  const outcome = event.attributes?.outcome;
  const row = typeof compatibilityId === "string" ? byId.get(compatibilityId) : undefined;
  if (!row || typeof variant !== "string" || !baseline.telemetryVariants[compatibilityId]?.includes(variant)) continue;
  if (typeof outcome !== "string" || !baseline.telemetryOutcomes[compatibilityId]?.includes(outcome)) continue;
  row.count += 1;
  const key = `${variant}:${outcome}`;
  row.variants.set(key, (row.variants.get(key) ?? 0) + 1);
}

const status = evidenceComplete ? "complete" : "unknown";
const report = renderReport({ baseline, from, to, coverageConfirmed, uptimeConfirmed, completeWindow, status, rows });
await writeFile(outputFile, report, { encoding: "utf8", mode: 0o600 });
console.log(`Legacy usage report written to ${path.relative(process.cwd(), outputFile)} (${status}).`);

function renderReport({ baseline, from, to, coverageConfirmed, uptimeConfirmed, completeWindow, status, rows }) {
  const lines = [
    "# Legacy usage evidence report",
    "",
    `- Period: ${from.toISOString()} — ${to.toISOString()}`,
    `- Required window: ${baseline.evidenceRetentionDays} days`,
    `- Full window: ${completeWindow ? "yes" : "no"}`,
    `- Collection coverage confirmed: ${coverageConfirmed ? "yes" : "no"}`,
    `- Observation uptime confirmed: ${uptimeConfirmed ? "yes" : "no"}`,
    `- Evidence status: ${status}`,
    "",
    "Absence of events is reported as `unknown` until the complete window, collection coverage and observation uptime are all confirmed.",
    "This report never removes compatibility code; the owner must record a separate keep/deprecate/remove decision.",
    "",
    "| Compatibility ID | Owner | Observed events | Evidence | Decision | Aggregates |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];
  for (const row of rows) {
    const evidence = row.count > 0 ? "observed" : status === "complete" ? "zero observed" : "unknown";
    const decision = status === "complete" && row.count === 0 ? "eligible for owner review" : "keep";
    const aggregates = [...row.variants.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(", ") || "n/a";
    lines.push(`| ${row.compatibilityId} | ${row.owner} | ${row.count} | ${evidence} | ${decision} | ${aggregates} |`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) parsed[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) parsed[key] = argv[++index];
    else parsed[key] = "true";
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required`);
  return value;
}

function parseDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return date;
}

function parseDateOrNull(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
