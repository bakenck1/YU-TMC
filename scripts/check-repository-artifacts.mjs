#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(parseArgs(process.argv.slice(2)).root ?? process.cwd());
const baselinePath = path.join(root, "scripts", "repository-artifacts-baseline.json");
const policyPath = path.join(root, "docs", "repository-artifacts.md");
const problems = [];

let baseline;
let policy;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  policy = await readFile(policyPath, "utf8");
} catch (error) {
  console.error(`Repository artifact check could not load its policy: ${error.message}`);
  process.exitCode = 1;
}

if (baseline && policy) {
  assertPolicyDocument(baseline, policy);
  assertReviewWindow(baseline);
  await assertReports(baseline, policy);
  await assertGeneratedHistory(baseline);
  await assertIgnoreBoundaries(baseline);
  assertTrackedRuntimeBoundary(baseline);
}

if (problems.length) {
  console.error("Repository artifact check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else if (baseline) {
  console.log(
    `Repository artifact check passed: ${baseline.reports.length} reports and generated migration history are cataloged.`,
  );
}

function assertPolicyDocument(manifest, source) {
  for (const required of [
    "Repository artifact policy",
    "immutable evidence",
    "Owner: repository maintainer",
    manifest.created,
    manifest.nextReview,
    "Historical reports are never rewritten",
    "backup and restore",
    "New audit report contract",
    "scripts/repository-artifacts-baseline.json",
  ]) {
    if (!source.includes(required)) {
      problems.push(`docs/repository-artifacts.md: missing required policy text ${required}`);
    }
  }

  for (const report of manifest.reports) {
    for (const value of [report.path, report.date, report.commit, report.scope]) {
      if (!source.includes(value)) {
        problems.push(`docs/repository-artifacts.md: catalog is missing ${value}`);
      }
    }
  }
}

function assertReviewWindow(manifest) {
  const created = parseDate(manifest.created, "created");
  const nextReview = parseDate(manifest.nextReview, "nextReview");
  const interval = (nextReview - created) / 86_400_000;
  if (manifest.reviewIntervalDays !== 90) {
    problems.push("repository artifact review interval must remain 90 days");
  }
  if (interval < 0 || interval > manifest.reviewIntervalDays) {
    problems.push(
      `repository artifact review window must be between 0 and ${manifest.reviewIntervalDays} days`,
    );
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (!Number.isNaN(nextReview.valueOf()) && nextReview < today) {
    problems.push(`repository artifact review ${manifest.nextReview} is overdue`);
  }
}

async function assertReports(manifest, source) {
  const reports = manifest.reports ?? [];
  const paths = new Set();
  for (const report of reports) {
    if (paths.has(report.path)) problems.push(`baseline: duplicate report ${report.path}`);
    paths.add(report.path);
    if (!/^[0-9a-f]{40}$/.test(report.commit)) {
      problems.push(`baseline: ${report.path} must carry a full 40-character commit SHA`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
      problems.push(`baseline: ${report.path} has an invalid report date`);
    }
    if (!report.scope || !Array.isArray(report.commands) || report.commands.length === 0) {
      problems.push(`baseline: ${report.path} needs scope and validation commands`);
    }
    const absolute = path.join(root, report.path);
    let reportSource;
    try {
      reportSource = await readFile(absolute, "utf8");
    } catch {
      problems.push(`baseline: report does not exist: ${report.path}`);
      continue;
    }
    if (report.kind === "security-audit" && !reportSource.includes(report.date)) {
      problems.push(`${report.path}: report date is missing from the historical report`);
    }
    if (!hasScopeHeading(reportSource)) {
      problems.push(`${report.path}: explicit scope section is required`);
    }
    if (!/(?:npm|next|git|docker)\s+(?:run|audit|build|test|diff|compose)/i.test(reportSource)) {
      problems.push(`${report.path}: validation commands are missing from the report`);
    }
    if (!source.includes(report.path) || !source.includes(report.commit)) {
      problems.push(`${report.path}: policy catalog must include its path and commit SHA`);
    }
  }

  const docsDirectory = path.join(root, "docs");
  let documentNames = [];
  try {
    documentNames = (await readdir(docsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^security-audit-\d{4}-\d{2}-\d{2}\.md$/.test(name) || name === "ui-refactor-report.md")
      .map((name) => path.posix.join("docs", name));
  } catch {
    problems.push("docs: cannot enumerate evidence reports");
  }
  for (const document of documentNames) {
    if (!paths.has(document)) problems.push(`${document}: report is not in the artifact baseline`);
  }
  for (const reportPath of paths) {
    if (!documentNames.includes(reportPath)) problems.push(`${reportPath}: baseline report is not present in docs`);
  }
}

async function assertGeneratedHistory(manifest) {
  const history = manifest.generatedHistory;
  const directory = path.join(root, history.directory);
  const metaDirectory = path.join(directory, "meta");
  let journal;
  try {
    journal = JSON.parse(await readFile(path.join(root, history.journal), "utf8"));
  } catch {
    problems.push(`${history.journal}: generated-history journal is missing or invalid JSON`);
    return;
  }
  if (journal.dialect !== "postgresql" || !Array.isArray(journal.entries)) {
    problems.push(`${history.journal}: expected a PostgreSQL journal with entries`);
    return;
  }

  const tags = new Set();
  const timestamps = new Set();
  const snapshotExceptions = new Map(
    (history.snapshotExceptions ?? []).map((exception) => [exception.tag, exception]),
  );
  for (const [tag, exception] of snapshotExceptions) {
    if (!exception.reason) problems.push(`${history.journal}: snapshot exception ${tag} needs a reason`);
    if (!journal.entries.some((entry) => entry.tag === tag)) {
      problems.push(`${history.journal}: snapshot exception references unknown tag ${tag}`);
    }
  }
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index];
    if (entry.idx !== index) problems.push(`${history.journal}: entry index ${entry.idx} is not ${index}`);
    if (tags.has(entry.tag)) problems.push(`${history.journal}: duplicate migration tag ${entry.tag}`);
    tags.add(entry.tag);
    const timestamp = /^(\d{14})(?:_|$)/.exec(entry.tag)?.[1];
    if (!timestamp) {
      problems.push(`${history.journal}: migration tag has no 14-digit timestamp: ${entry.tag}`);
      continue;
    }
    if (timestamps.has(timestamp)) problems.push(`${history.journal}: duplicate migration timestamp ${timestamp}`);
    timestamps.add(timestamp);
    await requireFile(path.join(directory, `${entry.tag}.sql`), `missing SQL for ${entry.tag}`);
    if (!snapshotExceptions.has(entry.tag)) {
      await requireFile(path.join(metaDirectory, `${timestamp}_snapshot.json`), `missing snapshot for ${entry.tag}`);
    }
  }

  let sqlNames = [];
  let snapshotNames = [];
  try {
    sqlNames = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name.slice(0, -4));
    snapshotNames = (await readdir(metaDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{14}_snapshot\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -14));
  } catch {
    problems.push(`${history.directory}: cannot enumerate generated migration files`);
    return;
  }
  const journalTags = new Set(tags);
  const exceptionTimestamps = new Set(
    journal.entries
      .filter((entry) => snapshotExceptions.has(entry.tag))
      .map((entry) => /^(\d{14})(?:_|$)/.exec(entry.tag)?.[1])
      .filter(Boolean),
  );
  const expectedSnapshotTimestamps = new Set(
    [...timestamps].filter((timestamp) => !exceptionTimestamps.has(timestamp)),
  );
  for (const name of sqlNames) if (!journalTags.has(name)) problems.push(`${history.directory}/${name}.sql is not in the journal`);
  for (const timestamp of snapshotNames) if (!expectedSnapshotTimestamps.has(timestamp)) problems.push(`${history.directory}/meta/${timestamp}_snapshot.json is not in the journal or is not an allowed snapshot exception`);
  if (sqlNames.length !== journalTags.size) problems.push(`${history.directory}: SQL file count does not match journal entry count`);
  if (snapshotNames.length !== expectedSnapshotTimestamps.size) problems.push(`${history.directory}/meta: snapshot count does not match non-exempt journal timestamp count`);
}

async function assertIgnoreBoundaries(manifest) {
  const gitignore = await readText(".gitignore");
  const dockerignore = await readText(".dockerignore");
  for (const exclusion of manifest.dockerContextExclusions ?? []) {
    if (!hasLine(dockerignore, exclusion)) {
      problems.push(`.dockerignore: missing repository context exclusion ${exclusion}`);
    }
  }
  for (const artifact of manifest.ignoredArtifacts) {
    if (artifact.gitignore && !hasLine(gitignore, artifact.gitignore)) {
      problems.push(`.gitignore: missing artifact rule ${artifact.gitignore}`);
    }
    if (artifact.dockerignore && !hasLine(dockerignore, artifact.dockerignore)) {
      problems.push(`.dockerignore: missing artifact rule ${artifact.dockerignore}`);
    }
  }
  const dockerfile = await readText("Dockerfile.mobile");
  if (!dockerfile.includes("COPY . .") || !dockerfile.includes("COPY --from=builder /app/.next/standalone ./")) {
    problems.push("Dockerfile.mobile: expected context-copy build stages and standalone runtime boundary are missing");
  }
  const submodule = manifest.auditSubmodule;
  const gitmodules = await readText(".gitmodules");
  for (const line of [
    `[submodule "${submodule.path}"]`,
    `path = ${submodule.path}`,
    `url = ${submodule.url}`,
  ]) {
    if (!hasLine(gitmodules, line)) problems.push(`.gitmodules: missing pinned audit locator ${line}`);
  }
}

function assertTrackedRuntimeBoundary(manifest) {
  const tracked = gitOutput(["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const artifact of manifest.ignoredArtifacts) {
    const allowedTracked = new Set(artifact.allowedTracked ?? []);
    const matches = tracked.filter(
      (filename) => matchesArtifact(filename, artifact.path) && !allowedTracked.has(filename),
    );
    if (matches.length) problems.push(`${artifact.path}: generated/runtime artifacts must not be tracked (${matches.join(", ")})`);
  }

  const submodule = manifest.auditSubmodule;
  const line = gitOutput(["ls-files", "-s", "--", submodule.path])
    .split(/\r?\n/)
    .find((value) => value.endsWith(`\t${submodule.path}`));
  if (!line) {
    problems.push(`${submodule.path}: immutable audit gitlink is not tracked`);
  } else {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "160000" || fields[1] !== submodule.commit) {
      problems.push(`${submodule.path}: gitlink must remain pinned to ${submodule.commit}`);
    }
  }
}

function matchesArtifact(filename, artifactPath) {
  if (artifactPath === "*.tsbuildinfo") return filename.endsWith(".tsbuildinfo");
  const normalized = artifactPath.replace(/\/$/, "");
  return filename === normalized || filename.startsWith(`${normalized}/`);
}

async function requireFile(filename, message) {
  try {
    await readFile(filename);
  } catch {
    problems.push(`${filename.slice(root.length + 1)}: ${message}`);
  }
}

async function readText(relativeFile) {
  try {
    return await readFile(path.join(root, relativeFile), "utf8");
  } catch {
    problems.push(`${relativeFile}: required repository policy file is missing`);
    return "";
  }
}

function hasLine(source, expected) {
  return source.split(/\r?\n/).some((line) => line.trim() === expected);
}

function hasScopeHeading(source) {
  return /^## .*?(scope|method|\u043e\u0445\u0432\u0430\u0442|\u043a\u043e\u043d\u0442\u0443\u0440|\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u043d)/imu.test(source);
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    problems.push(`baseline ${label} must use YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function gitOutput(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  } catch {
    problems.push("git: repository artifact checks require a Git worktree");
    return "";
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root" && argv[index + 1]) {
      parsed.root = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}
