#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const DEFAULT_SINCE_MINUTES = 30;
const DEFAULT_OUTPUT_DIR = "errors";
const STATE_FILE_NAME = ".monitor-state.json";

const ERROR_LEVELS = new Set(["error", "fatal", "critical", "alert", "emergency"]);

const args = parseArgs(process.argv.slice(2));
const sinceMinutes = Number(args["since-minutes"] ?? DEFAULT_SINCE_MINUTES);
const outputDir = path.resolve(String(args["output-dir"] ?? DEFAULT_OUTPUT_DIR));
const sourceCommand = String(args["source-command"] ?? process.env.PROD_LOG_SOURCE_COMMAND ?? "");
const sourceFile = String(args["source-file"] ?? process.env.PROD_LOG_SOURCE_FILE ?? "");
const statePath = path.join(outputDir, STATE_FILE_NAME);

if (!Number.isFinite(sinceMinutes) || sinceMinutes <= 0) {
  throw new Error("--since-minutes must be a positive number");
}

await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700).catch(() => {});

const rawLogs = await readLogs({ sourceCommand, sourceFile, stdin: !process.stdin.isTTY });
const entries = parseLogEntries(rawLogs);
const incidents = groupIncidents(entries, sinceMinutes);

if (!incidents.length) {
  console.log("No production errors found.");
  process.exitCode = 0;
  await persistState(statePath, { incidents: {} });
  process.exit(0);
}

const state = await loadState(statePath);
const updatedState = { incidents: { ...state.incidents } };
const writtenFiles = [];

for (const incident of incidents) {
  const known = updatedState.incidents[incident.fingerprint];
  const fileName = known?.fileName ?? makeFileName(incident.title, incident.fingerprint);
  const filePath = path.join(outputDir, fileName);
  const merged = mergeIncident(incident, known);
  await writeFile(filePath, renderIncidentMarkdown(merged, sinceMinutes), { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => {});
  updatedState.incidents[incident.fingerprint] = {
    fileName,
    title: incident.title,
    fingerprint: incident.fingerprint,
    firstSeenUtc: merged.firstSeenUtc,
    lastSeenUtc: merged.lastSeenUtc,
    occurrences: merged.occurrences,
  };
  writtenFiles.push(path.relative(process.cwd(), filePath));
}

await persistState(statePath, updatedState);

console.log(`Saved ${writtenFiles.length} error report(s):`);
for (const file of writtenFiles) console.log(`- ${file}`);

async function readLogs({ sourceCommand, sourceFile, stdin }) {
  if (sourceFile) return readFile(sourceFile, "utf8");
  if (sourceCommand) return runCommand(sourceCommand);
  if (stdin) return readStdin();
  throw new Error(
    "No log source configured. Set PROD_LOG_SOURCE_COMMAND, PROD_LOG_SOURCE_FILE, or pipe logs into stdin.",
  );
}

function parseLogEntries(rawText) {
  const lines = rawText.split(/\r?\n/);
  const blocks = [];
  let current = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    if (!current.length) {
      current.push(line);
      continue;
    }

    if (startsNewEntry(line)) {
      blocks.push(current.join("\n"));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length) blocks.push(current.join("\n"));
  return blocks.map(parseEntry).filter(Boolean);
}

function parseEntry(block) {
  const trimmed = redactSensitiveText(block).trim();
  if (!trimmed) return null;

  const json = tryParseJson(trimmed);
  const normalized = json ? normalizeJsonLog(json, block) : normalizeTextLog(block);
  return normalized;
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/([?&](?:token|code|password|secret|key|email)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/("(?:password|token|secret|authorization|cookie|code|email)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function normalizeJsonLog(obj, raw) {
  const level = lower(obj.level ?? obj.severity ?? obj.logLevel ?? obj.type);
  const status = numberOrNull(obj.status ?? obj.statusCode ?? obj.httpStatus);
  const message = firstString(
    obj.message,
    obj.msg,
    obj.error?.message,
    obj.err?.message,
    obj.error,
    obj.err,
    obj.reason,
  );
  const stack = firstString(obj.stack, obj.error?.stack, obj.err?.stack);
  const trace = [message, stack, raw].filter(Boolean).join("\n");
  const route = firstString(obj.route, obj.path, obj.url, obj.pathname, obj.request?.path);
  const method = firstString(obj.method, obj.request?.method);
  const requestId = firstString(obj.requestId, obj.request_id, obj.traceId, obj.trace_id, obj.id);
  const timestamp = firstString(obj.timestamp, obj.time, obj.ts, obj["@timestamp"], obj.occurredAt, obj.createdAt);
  const title = deriveTitle({ message, stack, raw, status, level });

  return {
    raw,
    title,
    message,
    stack,
    trace,
    route,
    method,
    requestId,
    status,
    level,
    timestamp,
    fingerprint: makeFingerprint({
      title,
      stack,
      route,
      method,
      status,
    }),
  };
}

function normalizeTextLog(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd());
  const firstLine = lines[0] ?? "";
  const level = deriveLevelFromText(raw);
  const status = deriveStatusFromText(raw);
  const title = deriveTitle({ message: firstLine, stack: raw, raw, status, level });
  const route = matchFirst(raw, /(?:route|path|url)=([^\s]+)/i);
  const method = matchFirst(raw, /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  const requestId = matchFirst(raw, /\b(?:request[_-]?id|trace[_-]?id|correlation[_-]?id)[:= ]([^\s]+)/i);
  const timestamp = matchFirst(raw, /(\d{4}-\d{2}-\d{2}T[^\s]+Z?)/);
  const stackLine = lines.find((line) => line.trimStart().startsWith("at ")) ?? "";

  return {
    raw,
    title,
    message: firstLine,
    stack: stackLine || "",
    trace: raw,
    route,
    method,
    requestId,
    status,
    level,
    timestamp,
    fingerprint: makeFingerprint({
      title,
      stack: stackLine || raw,
      route,
      method,
      status,
    }),
  };
}

function groupIncidents(entries, sinceMinutes) {
  const cutoff = Date.now() - sinceMinutes * 60_000;
  const grouped = new Map();

  for (const entry of entries) {
    if (!isErrorEntry(entry)) continue;
    const occurredAt = parseTimestamp(entry.timestamp) ?? Date.now();
    if (occurredAt < cutoff) continue;

    const key = entry.fingerprint;
    const incident = grouped.get(key) ?? {
      fingerprint: key,
      title: entry.title,
      firstSeenUtc: new Date(occurredAt).toISOString(),
      lastSeenUtc: new Date(occurredAt).toISOString(),
      occurrences: 0,
      level: entry.level ?? "error",
      route: entry.route ?? "",
      method: entry.method ?? "",
      status: entry.status ?? null,
      requestId: entry.requestId ?? "",
      sample: entry.trace,
      entries: [],
    };

    incident.occurrences += 1;
    incident.lastSeenUtc = new Date(Math.max(Date.parse(incident.lastSeenUtc), occurredAt)).toISOString();
    if (!incident.route && entry.route) incident.route = entry.route;
    if (!incident.method && entry.method) incident.method = entry.method;
    if (incident.status === null && entry.status !== null) incident.status = entry.status;
    if (!incident.requestId && entry.requestId) incident.requestId = entry.requestId;
    if (!incident.sample || entry.trace.length > incident.sample.length) incident.sample = entry.trace;
    incident.entries.push(entry);

    grouped.set(key, incident);
  }

  return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function mergeIncident(current, known) {
  if (!known) return current;
  return {
    ...current,
    firstSeenUtc: known.firstSeenUtc ?? current.firstSeenUtc,
    lastSeenUtc: current.lastSeenUtc,
    occurrences: (known.occurrences ?? 0) + current.occurrences,
  };
}

function renderIncidentMarkdown(incident, sourceWindowMinutes) {
  const contextLines = incident.sample.split(/\r?\n/).slice(0, 40).join("\n");
  const trace = incident.entries.map((entry) => entry.trace).join("\n\n---\n\n");

  return `---
title: "${escapeYaml(incident.title)}"
fingerprint: "${escapeYaml(incident.fingerprint)}"
first_seen_utc: "${escapeYaml(incident.firstSeenUtc)}"
last_seen_utc: "${escapeYaml(incident.lastSeenUtc)}"
occurrences: ${incident.occurrences}
level: "${escapeYaml(incident.level ?? "error")}"
source_window_minutes: ${sourceWindowMinutes}
---

# ${incident.title}

- First seen: ${incident.firstSeenUtc}
- Last seen: ${incident.lastSeenUtc}
- Occurrences: ${incident.occurrences}
- Fingerprint: \`${incident.fingerprint}\`
- Route: ${incident.route ? `\`${incident.route}\`` : "n/a"}
- Method: ${incident.method ? `\`${incident.method}\`` : "n/a"}
- Status: ${incident.status ?? "n/a"}
- Request ID: ${incident.requestId ? `\`${incident.requestId}\`` : "n/a"}

## Trace

\`\`\`text
${trace || incident.sample || incident.title}
\`\`\`

## Context

\`\`\`text
${contextLines}
\`\`\`
`;
}

function makeFileName(title, fingerprint) {
  const slug = slugify(title) || "error";
  const shortHash = fingerprint.slice(0, 8);
  return `${slug}-${shortHash}.md`;
}

function makeFingerprint({ title, stack, route, method, status }) {
  const normalized = [
    normalizeFingerprintText(title),
    normalizeFingerprintText(stack),
    normalizeFingerprintText(route),
    normalizeFingerprintText(method),
    status === null || status === undefined ? "" : String(status),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

function deriveTitle({ message, stack, raw, status, level }) {
  const candidates = [message, stack, raw].filter(Boolean);
  for (const candidate of candidates) {
    const title = extractTitle(candidate);
    if (title) return cleanupTitle(title);
  }

  if (status && status >= 500) return `HTTP ${status} server error`;
  if (level === "fatal") return "Fatal error";
  return "Unknown production error";
}

function extractTitle(text) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";

  const first = lines[0];
  const stripped = first
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^\w+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s*/, "")
    .replace(/^\d{4}-\d{2}-\d{2}[T ]\S+\s*/, "")
    .replace(/^(error|fatal|critical|alert|emergency|warn|warning)[:\]\-]?\s*/i, "")
    .trim();

  if (/^at\s+\S+/.test(stripped) || !stripped) {
    const stackLine = lines.find((line) => /^([A-Za-z0-9_.-]+Error|Error|TypeError|ReferenceError|RangeError|SyntaxError|AggregateError)/.test(line));
    if (stackLine) return stackLine.replace(/\s+at\s+.*/, "").trim();
  }

  if (/^error[:\s-]*$/i.test(stripped) && lines[1]) return lines[1];
  return stripped;
}

function cleanupTitle(title) {
  return title
    .replace(/\s+\(.*\)$/u, "")
    .replace(/\s+\[[^\]]+\]$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isErrorEntry(entry) {
  if (!entry) return false;
  if (typeof entry.status === "number" && entry.status >= 500) return true;
  if (entry.level && ERROR_LEVELS.has(String(entry.level).toLowerCase())) return true;
  const combined = [entry.title, entry.message, entry.stack, entry.trace, entry.raw].filter(Boolean).join("\n");
  return /(error|exception|fatal|panic|unhandled|traceback|stack trace)/i.test(combined);
}

function deriveLevelFromText(text) {
  const lowerText = String(text).toLowerCase();
  for (const level of ERROR_LEVELS) {
    if (lowerText.includes(level)) return level;
  }
  if (/warn/i.test(text)) return "warn";
  return "";
}

function deriveStatusFromText(text) {
  const match = String(text).match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function normalizeFingerprintText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/gi, "<hex>")
    .replace(/\b[0-9]+\b/g, "<n>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstString(...values) {
  for (const value of values.flat(Infinity)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function matchFirst(text, regex) {
  const match = String(text).match(regex);
  return match?.[1]?.trim() ?? "";
}

function startsNewEntry(line) {
  return (
    line.trimStart().startsWith("{") ||
    /^\d{4}-\d{2}-\d{2}[T\s]/.test(line) ||
    /^\[[A-Z]+\]/.test(line) ||
    /^(error|warn|info|debug|fatal|critical|alert|emergency)\b[:\]\- ]/i.test(line) ||
    /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*/.test(line)
  );
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadState(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid state");
    return {
      incidents: parsed.incidents && typeof parsed.incidents === "object" ? parsed.incidents : {},
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { incidents: {} };
    }
    return { incidents: {} };
  }
}

async function persistState(filePath, state) {
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600).catch(() => {});
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function escapeYaml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `Log source command failed with exit code ${code}`));
    });
  });
}
