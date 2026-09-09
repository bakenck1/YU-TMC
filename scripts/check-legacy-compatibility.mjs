#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = parseRoot(process.argv.slice(2));
const manifestPath = path.join(root, "scripts", "legacy-compatibility-baseline.json");
const documentationPath = path.join(root, "docs", "legacy-compatibility.md");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const documentation = await readFile(documentationPath, "utf8");
const problems = [];

assertInventory(documentation);
assertReviewWindow();
await assertSourceBoundaries();

if (problems.length) {
  console.error("Legacy compatibility check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Legacy compatibility check passed: ${manifest.inventoryIds.length} inventory entries are tracked.`,
  );
}

function assertInventory(source) {
  for (const id of manifest.inventoryIds) {
    const section = inventorySection(source, id);
    if (!section) {
      problems.push(`docs/legacy-compatibility.md: missing inventory entry ${id}`);
      continue;
    }

    for (const field of [
      "Owner",
      "Consumer",
      "Introduced",
      "Security",
      "Evidence source",
      "Migration path",
      "Sunset criterion",
      "Regression",
      "Minimum support",
    ]) {
      if (!section.includes(`- **${field}:**`)) {
        problems.push(`docs/legacy-compatibility.md: ${id} is missing inventory field ${field}`);
      }
    }
    const status = manifest.statuses?.[id];
    const evidenceStatus = manifest.evidenceStatus?.[id];
    if (!["supported", "import-only"].includes(status)) {
      problems.push(`baseline: ${id} requires supported or import-only status`);
    } else if (!section.includes(`- **Status:** \`${status}\`.`)) {
      problems.push(`docs/legacy-compatibility.md: ${id} status must match the baseline`);
    }
    if (evidenceStatus !== "unknown") {
      problems.push(`baseline: ${id} evidence status must remain unknown before owner review`);
    } else if (!section.includes("- **Evidence status:** `unknown`.")) {
      problems.push(`docs/legacy-compatibility.md: ${id} evidence status must match the baseline`);
    }

    const documentedValues = manifest.documentedValues?.[id];
    if (!Array.isArray(documentedValues)) {
      problems.push(`baseline: ${id} has no documentedValues entry`);
      continue;
    }
    for (const value of documentedValues) {
      if (!section.includes(value)) {
        problems.push(`docs/legacy-compatibility.md: ${id} does not document ${value}`);
      }
    }
  }
  assertMatchingLists(
    manifest.legacyPermissions,
    manifest.documentedValues?.["LEGACY-PERMISSIONS"],
    "LEGACY-PERMISSIONS",
  );
  assertMatchingLists(
    manifest.qrFormats,
    manifest.documentedValues?.["LEGACY-QR-ALIASES"],
    "LEGACY-QR-ALIASES",
  );
  assertMatchingLists(
    manifest.legacyRouteFiles,
    manifest.documentedValues?.["LEGACY-TRANSFER-ROUTES"],
    "LEGACY-TRANSFER-ROUTES",
  );
  assertMatchingLists(
    manifest.cookieContractFields,
    manifest.documentedValues?.["LEGACY-COOKIE-CONTRACT"],
    "LEGACY-COOKIE-CONTRACT",
  );
  assertInventoryMapKeys(manifest.statuses, "statuses");
  assertInventoryMapKeys(manifest.evidenceStatus, "evidenceStatus");
  if (!source.includes(manifest.created) || !source.includes(manifest.nextReview)) {
    problems.push("docs/legacy-compatibility.md: review dates must match the machine baseline");
  }
  if (!/90 (?:days|дней)/.test(source) || !source.includes("unknown")) {
    problems.push(
      "docs/legacy-compatibility.md: evidence retention and unknown-status policy are required",
    );
  }
}

function assertReviewWindow() {
  const created = parseDate(manifest.created, "created");
  const nextReview = parseDate(manifest.nextReview, "nextReview");
  const days = (nextReview - created) / 86_400_000;
  if (days < 0 || days > manifest.evidenceRetentionDays) {
    problems.push(
      `baseline review window must be between 0 and ${manifest.evidenceRetentionDays} days`,
    );
  }
  if (manifest.evidenceRetentionDays !== 90) {
    problems.push("baseline evidence retention must remain 90 days");
  }
  if (!Number.isNaN(nextReview.valueOf())) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (nextReview < today) {
      problems.push(`baseline nextReview ${manifest.nextReview} is overdue; complete the compatibility review`);
    }
  }
}

async function assertSourceBoundaries() {
  const sourceFiles = [];
  for (const directory of ["app", "components", "lib", "scripts"]) {
    sourceFiles.push(...(await collectSourceFiles(path.join(root, directory))));
  }
  sourceFiles.push(...(await collectRootSourceFiles()));
  const sources = await Promise.all(
    sourceFiles.map(async (filename) => ({
      filename,
      relative: toRelative(filename),
      source: await readFile(filename, "utf8"),
    })),
  );
  const sourceByName = new Map(sources.map((entry) => [entry.relative, entry.source]));
  const credentialSanitizers = new Set(manifest.credentialSanitizers ?? []);

  for (const relative of credentialSanitizers) {
    const source = sourceByName.get(relative);
    if (!source) {
      problems.push(`baseline: missing credential sanitizer ${relative}`);
    } else if (!(await isEmptyCredentialSanitizer(path.join(root, relative), source))) {
      problems.push(`${relative}: credential sanitizer must force legacy credential markers to empty strings`);
    }
  }

  for (const id of manifest.inventoryIds) {
    const telemetrySources = manifest.telemetrySources?.[id];
    const variants = manifest.telemetryVariants?.[id];
    const outcomes = manifest.telemetryOutcomes?.[id];
    if (!manifest.owners?.[id] || !Array.isArray(telemetrySources) || telemetrySources.length === 0 || !Array.isArray(variants) || variants.length === 0 || !Array.isArray(outcomes) || outcomes.length === 0) {
      problems.push(`baseline: ${id} requires owner, telemetry variants, telemetry outcomes and telemetry sources`);
      continue;
    }
    for (const relative of telemetrySources) {
      const source = sourceByName.get(relative);
      if (!source) problems.push(`baseline: missing telemetry source ${relative} for ${id}`);
      else {
        const marker = id === "LEGACY-TRANSFER-ROUTES" ? "observeLegacyHttpRequest" : `"${id}"`;
        if (!source.includes(marker)) problems.push(`${relative}: missing structured legacy usage event for ${id}`);
      }
    }
  }

  const permissionValues = new Set();
  for (const entry of sources) {
    for (const match of entry.source.matchAll(/["'](legacy\.[a-z][a-z0-9_.]*)["']/g)) {
      if (match[1] !== manifest.telemetryEvent) permissionValues.add(match[1]);
    }
  }
  assertAllowlistedValues(permissionValues, manifest.legacyPermissions, "permission");

  const qrRegistry = await readFile(
    path.join(root, "lib", "contracts", "inventory-domain.ts"),
    "utf8",
  );
  const qrFormats = new Set(
    [...qrRegistry.matchAll(/["'](legacy_[a-z][a-z0-9_]*)["']/g)].map(
      (match) => match[1],
    ),
  );
  assertAllowlistedValues(qrFormats, manifest.qrFormats, "QR format");

  for (const entry of sources) {
    if (importsLegacySeed(entry.source) && entry.relative !== manifest.seedImportOnly) {
      problems.push(
        `${entry.relative}: lib/data.ts is a seed-only compatibility source; add an explicit documented exception before importing it elsewhere`,
      );
    }
    if (
      importsLegacyCredentials(entry.source) &&
      entry.relative !== manifest.credentialImportOnly
    ) {
      problems.push(
        `${entry.relative}: legacy credential source is import-only and must not enter runtime code`,
      );
    }
    if (
      hasLegacyCredentialMarker(entry.source) &&
      ![
        manifest.credentialImportOnly,
        "lib/server/persistence/legacy/legacy-credential-source.ts",
      ].includes(entry.relative) &&
      !credentialSanitizers.has(entry.relative)
    ) {
      problems.push(
        `${entry.relative}: direct legacy credential file/environment access is import-only and must not enter runtime code`,
      );
    }
  }

  const sessionSource = await readFile(
    path.join(root, "lib", "security", "session.ts"),
    "utf8",
  );
  const payloadMatch = /export interface SessionPayload\s*\{([\s\S]*?)\n\}/m.exec(sessionSource);
  const actualCookieFields = payloadMatch
    ? [...payloadMatch[1].matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1])
    : [];
  if (JSON.stringify([...actualCookieFields].sort()) !== JSON.stringify([...manifest.cookieContractFields].sort())) {
    problems.push(
      "lib/security/session.ts: SessionPayload fields must match the tracked cookie compatibility contract exactly",
    );
  }

  const routeRoot = path.join(root, "app", "api", "inventory", "transfers");
  const actualRouteFiles = (await collectAllFiles(routeRoot)).map(toRelative).sort();
  const expectedRouteFiles = [...manifest.legacyRouteFiles].sort();
  for (const filename of expectedRouteFiles) {
    if (!actualRouteFiles.includes(filename)) {
      problems.push(`missing tracked legacy transfer route ${filename}`);
    }
  }
  for (const filename of actualRouteFiles) {
    if (!expectedRouteFiles.includes(filename)) {
      problems.push(
        `${filename}: new legacy transfer route requires an inventory entry, regression fixture and explicit exception`,
      );
    }
  }
}

function assertAllowlistedValues(actual, allowed, label) {
  const allowedSet = new Set(allowed);
  for (const value of actual) {
    if (!allowedSet.has(value)) {
      problems.push(
        `${label} ${value} is not in scripts/legacy-compatibility-baseline.json; document the exception before adding it`,
      );
    }
  }
}

function importsLegacySeed(source) {
  return moduleSpecifiers(source).some((specifier) =>
    specifier === "@/lib/data" ||
    /(?:^|\/)lib\/data(?:\.(?:c?js|m?js|c?ts|m?ts|tsx|jsx))?$/.test(specifier) ||
    /^(?:\.\.\/|\.\/)+data(?:\.(?:c?js|m?js|c?ts|m?ts|tsx|jsx))?$/.test(specifier),
  );
}

function importsLegacyCredentials(source) {
  return moduleSpecifiers(source).some((specifier) =>
    specifier.endsWith("legacy-credential-source") ||
    specifier.endsWith("legacy-credential-source.ts"),
  );
}

function hasLegacyCredentialMarker(source) {
  return /(?:auth-credentials\.json|AUTH_ADMIN_[A-Z0-9_*]+)/.test(source);
}

async function isEmptyCredentialSanitizer(filename, source) {
  if (!hasLegacyCredentialMarker(source)) return false;
  try {
    const sanitizer = await import(
      `${pathToFileURL(filename).href}?legacy-check=${Date.now()}`
    );
    if (typeof sanitizer.createBrowserSmokeEnvironment !== "function") return false;
    const sentinel = "must-not-survive";
    const input = Object.fromEntries([
      ["PATH", "safe-path"],
      ["UNRELATED_SECRET", sentinel],
      ...(manifest.credentialSanitizerKeys ?? []).map((key) => [key, sentinel]),
    ]);
    const output = sanitizer.createBrowserSmokeEnvironment(input);
    return (
      output?.PATH === "safe-path" &&
      output?.UNRELATED_SECRET === undefined &&
      Array.isArray(manifest.credentialSanitizerKeys) &&
      manifest.credentialSanitizerKeys.length > 0 &&
      manifest.credentialSanitizerKeys.every((key) => output?.[key] === "")
    );
  } catch {
    return false;
  }
}

function moduleSpecifiers(source) {
  return [...source.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

async function collectSourceFiles(directory) {
  return (await collectAllFiles(directory)).filter((filename) =>
    /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx|mjsx)$/.test(filename),
  ).filter((filename) => !filename.endsWith("check-legacy-compatibility.mjs"));
}

async function collectRootSourceFiles() {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name))
    .filter((filename) => /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx|mjsx)$/.test(filename))
    .filter((filename) => !filename.endsWith("check-legacy-compatibility.mjs"));
}

async function collectAllFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectAllFiles(filename)));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

function toRelative(filename) {
  return path.relative(root, filename).replaceAll(path.sep, "/");
}

function parseDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    problems.push(`baseline ${name} must be an ISO date`);
    return new Date(Number.NaN);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    problems.push(`baseline ${name} must be an ISO date`);
  }
  return date;
}

function inventorySection(source, id) {
  const heading = new RegExp(`^### ${escapeRegExp(id)}$`, "m").exec(source);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const rest = source.slice(start);
  const nextHeading = rest.search(/^#{2,3} /m);
  return source.slice(heading.index, nextHeading < 0 ? source.length : start + nextHeading);
}

function assertMatchingLists(actual, documented, id) {
  if (!Array.isArray(documented)) return;
  const left = [...actual].sort();
  const right = [...documented].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    problems.push(`baseline: ${id} allowlist and documentedValues must match exactly`);
  }
}

function assertInventoryMapKeys(value, name) {
  const actual = value && typeof value === "object" ? Object.keys(value).sort() : [];
  const expected = [...manifest.inventoryIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`baseline: ${name} must cover every inventory ID exactly`);
  }
}

function parseRoot(args) {
  const index = args.indexOf("--root");
  return index >= 0 && args[index + 1]
    ? path.resolve(args[index + 1])
    : process.cwd();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
