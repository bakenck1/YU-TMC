#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root ?? process.cwd()));
const evidenceFile = path.resolve(required(args, "file"));
const baselineBytes = await readFile(path.join(root, "scripts/release-evidence-gates.json"));
const baseline = JSON.parse(baselineBytes.toString("utf8"));
const pack = JSON.parse(await readFile(evidenceFile, "utf8"));
const problems = [];
const execFileAsync = promisify(execFile);

exactKeys(pack, ["formatVersion", "packId", "release", "prerequisites", "gates", "verdict", "signature"], "evidence pack");
if (pack.formatVersion !== baseline.formatVersion) problems.push("formatVersion does not match the gate baseline");
if (!safeId(pack.packId)) problems.push("packId must be a safe immutable identifier");
await validateRelease(pack.release);
await validatePrerequisites(pack.prerequisites);
await validateGates(pack.gates);

const gateDefinitions = new Map(baseline.gates.map((gate) => [gate.id, gate]));
const expectedVerdict =
  Array.isArray(pack.prerequisites) && pack.prerequisites.every((item) => item?.status === "pass") &&
  Array.isArray(pack.gates) && pack.gates.every((gate) => {
    const definition = gateDefinitions.get(gate?.id);
    return gate?.status === "pass" || (gate?.status === "not-applicable" && definition?.critical === false);
  })
    ? "GO"
    : "NO-GO";
if (pack.verdict !== expectedVerdict) problems.push(`verdict must be ${expectedVerdict} for the recorded gate statuses`);
if (pack.verdict === "GO") validateSignature(pack.signature);

if (problems.length) {
  console.error("Release evidence check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Release evidence verified: ${pack.packId} (${pack.verdict}).`);
}

async function validateRelease(release) {
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    problems.push("release metadata is required");
    return;
  }
  exactKeys(release, ["commitSha", "evidenceCommitSha", "artifactSha256", "gateRegistrySha256", "deploymentId", "environment", "timestamp", "executor", "migrationSet"], "release metadata");
  if (!/^[0-9a-f]{40}$/.test(release.commitSha ?? "")) problems.push("release.commitSha must be a full lowercase Git SHA");
  if (!/^[0-9a-f]{40}$/.test(release.evidenceCommitSha ?? "")) problems.push("release.evidenceCommitSha must be a full lowercase Git SHA");
  if (pack.verdict === "GO" && !/^[0-9a-f]{64}$/.test(release.artifactSha256 ?? "")) problems.push("GO release.artifactSha256 must be a lowercase SHA-256 digest");
  if (pack.verdict !== "GO" && release.artifactSha256 !== null && !/^[0-9a-f]{64}$/.test(release.artifactSha256 ?? "")) problems.push("release.artifactSha256 must be null or a lowercase SHA-256 digest");
  const registryDigest = createHash("sha256").update(baselineBytes).digest("hex");
  if (release.gateRegistrySha256 !== registryDigest) problems.push("release.gateRegistrySha256 must match the active gate registry");
  for (const field of ["deploymentId", "environment", "executor"]) {
    if (!safeText(release[field])) problems.push(`release.${field} must be safe non-secret metadata`);
  }
  const timestamp = utcTimestamp(release.timestamp);
  if (timestamp === null) problems.push("release.timestamp must be an RFC3339 UTC timestamp ending in Z");
  else if (timestamp > Date.now() + 300_000) problems.push("release.timestamp cannot be in the future");
  if (!Array.isArray(release.migrationSet) || release.migrationSet.length === 0 || release.migrationSet.some((tag) => !safeId(tag))) {
    problems.push("release.migrationSet must contain safe migration tags");
  } else if (/^[0-9a-f]{40}$/.test(release.commitSha ?? "")) {
    try {
      await execFileAsync("git", ["cat-file", "-e", `${release.commitSha}^{commit}`], { cwd: root, windowsHide: true });
      const { stdout } = await execFileAsync("git", ["show", `${release.commitSha}:drizzle/meta/_journal.json`], { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      const journal = JSON.parse(stdout);
      const expected = journal.entries.map((entry) => entry.tag);
      if (JSON.stringify(release.migrationSet) !== JSON.stringify(expected)) {
        problems.push("release.migrationSet must exactly match drizzle/meta/_journal.json at release.commitSha in order");
      }
    } catch {
      problems.push("release.commitSha must resolve to a commit containing a valid migration journal");
    }
  }
  if (/^[0-9a-f]{40}$/.test(release.evidenceCommitSha ?? "")) {
    try {
      await execFileAsync("git", ["cat-file", "-e", `${release.evidenceCommitSha}^{commit}`], { cwd: root, windowsHide: true });
    } catch {
      problems.push("release.evidenceCommitSha must resolve to a Git commit");
    }
  }
}

async function validateGates(gates) {
  if (!Array.isArray(gates)) {
    problems.push("gates must be an array");
    return;
  }
  const expected = new Map(baseline.gates.map((gate) => [gate.id, gate]));
  const seen = new Set();
  for (const gate of gates) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      problems.push("each gate must be an object");
      continue;
    }
    exactKeys(gate, ["id", "status", "owner", "rationale", "evidence"], `gate ${gate.id ?? "unknown"}`);
    const definition = expected.get(gate.id);
    if (!definition) {
      problems.push(`unknown gate ${gate.id}`);
      continue;
    }
    if (seen.has(gate.id)) problems.push(`duplicate gate ${gate.id}`);
    seen.add(gate.id);
    if (gate.owner !== definition.owner) problems.push(`${gate.id}: owner must be ${definition.owner}`);
    if (!new Set(["pass", "fail", "blocked", "not-applicable"]).has(gate.status)) problems.push(`${gate.id}: invalid status`);
    if (!Array.isArray(gate.evidence)) problems.push(`${gate.id}: evidence must be an array`);
    else {
      if (gate.status === "pass" && gate.evidence.length === 0) problems.push(`${gate.id}: pass requires immutable evidence`);
      await Promise.all(gate.evidence.map((entry, index) => validateEvidence(entry, `${gate.id}.evidence[${index}]`)));
    }
    if (gate.status !== "pass" && !safeText(gate.rationale)) problems.push(`${gate.id}: ${gate.status} requires a rationale`);
    if (gate.status === "not-applicable" && definition.critical !== false) problems.push(`${gate.id}: critical gate cannot be not-applicable`);
    for (const prerequisiteId of definition.requires ?? []) {
      const prerequisite = Array.isArray(pack.prerequisites)
        ? pack.prerequisites.find((item) => item?.id === prerequisiteId)
        : null;
      if (gate.status === "pass" && prerequisite?.status !== "pass") {
        problems.push(`${gate.id}: pass requires prerequisite ${prerequisiteId} to pass`);
      }
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) problems.push(`missing gate ${id}`);
}

async function validatePrerequisites(prerequisites) {
  if (!Array.isArray(prerequisites)) {
    problems.push("prerequisites must be an array");
    return;
  }
  const expected = new Map((baseline.prerequisites ?? []).map((item) => [item.id, item]));
  const seen = new Set();
  for (const item of prerequisites) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push("each prerequisite must be an object");
      continue;
    }
    exactKeys(item, ["id", "status", "owner", "rationale", "evidence"], `prerequisite ${item.id ?? "unknown"}`);
    const definition = expected.get(item.id);
    if (!definition) {
      problems.push(`unknown prerequisite ${item.id}`);
      continue;
    }
    if (seen.has(item.id)) problems.push(`duplicate prerequisite ${item.id}`);
    seen.add(item.id);
    if (item.owner !== definition.owner) problems.push(`${item.id}: owner must be ${definition.owner}`);
    if (!new Set(["pass", "blocked", "fail"]).has(item.status)) problems.push(`${item.id}: invalid status`);
    if (!Array.isArray(item.evidence)) problems.push(`${item.id}: evidence must be an array`);
    else {
      if (item.status === "pass" && item.evidence.length === 0) problems.push(`${item.id}: pass requires immutable evidence`);
      await Promise.all(item.evidence.map((entry, index) => validateEvidence(entry, `${item.id}.evidence[${index}]`)));
    }
    if (item.status !== "pass" && !safeText(item.rationale)) problems.push(`${item.id}: ${item.status} requires a rationale`);
  }
  for (const id of expected.keys()) if (!seen.has(id)) problems.push(`missing prerequisite ${id}`);
}

async function validateEvidence(entry, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    problems.push(`${label} must be an object`);
    return;
  }
  exactKeys(entry, ["uri", "sha256", "capturedAt"], label);
  if (!safeEvidenceUri(entry.uri)) problems.push(`${label}.uri must be a repository-relative evidence path`);
  if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) problems.push(`${label}.sha256 must be a lowercase SHA-256 digest`);
  const capturedAt = utcTimestamp(entry.capturedAt);
  const releaseTimestamp = utcTimestamp(pack.release?.timestamp);
  if (capturedAt === null || capturedAt > Date.now() + 300_000) problems.push(`${label}.capturedAt must be a non-future RFC3339 UTC timestamp ending in Z`);
  else if (releaseTimestamp !== null && (capturedAt > releaseTimestamp || capturedAt < releaseTimestamp - 30 * 86_400_000)) {
    problems.push(`${label}.capturedAt must be within 30 days before release.timestamp`);
  }
  if (typeof entry.uri === "string" && /^(?:docs|release-evidence)\//.test(entry.uri) && /^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
    try {
      const evidenceSha = pack.release?.evidenceCommitSha;
      const { stdout } = await execFileAsync("git", ["show", `${evidenceSha}:${entry.uri}`], {
        cwd: root,
        windowsHide: true,
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
      });
      const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== entry.sha256) problems.push(`${label}.sha256 does not match the file at release.evidenceCommitSha`);
    } catch {
      problems.push(`${label}.uri does not resolve at release.evidenceCommitSha`);
    }
  }
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) problems.push(`${label}: unexpected field ${key}`);
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value) && !sensitive(value);
}

function safeText(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && !/[\r\n]/.test(value) && !sensitive(value);
}

function sensitive(value) {
  return /(?:bearer\s+|password|secret|token=|cookie|\b\d{12}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(value);
}

function safeEvidenceUri(value) {
  if (typeof value !== "string" || value.length > 500 || sensitive(value)) return false;
  return /^(?:docs|release-evidence)\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..");
}

function validateSignature(signature) {
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    problems.push("GO requires a signed deployment attestation");
    return;
  }
  exactKeys(signature, ["algorithm", "keyId", "value"], "signature");
  if (signature.algorithm !== "ed25519") problems.push("signature.algorithm must be ed25519");
  if (signature.keyId !== baseline.signingKeyId) problems.push(`signature.keyId must be ${baseline.signingKeyId}`);
  const encodedKey = process.env.RELEASE_EVIDENCE_PUBLIC_KEY_SPKI?.trim();
  if (!encodedKey) {
    problems.push("GO verification requires RELEASE_EVIDENCE_PUBLIC_KEY_SPKI");
    return;
  }
  try {
    const publicKeyBytes = Buffer.from(encodedKey, "base64");
    const publicKeyDigest = createHash("sha256").update(publicKeyBytes).digest("hex");
    const expectedKeyDigest = process.env.NODE_ENV === "test"
      ? process.env.RELEASE_EVIDENCE_TEST_PUBLIC_KEY_SHA256?.trim()
      : baseline.signingPublicKeySha256;
    if (!/^[0-9a-f]{64}$/.test(expectedKeyDigest ?? "") || publicKeyDigest !== expectedKeyDigest) {
      problems.push("deployment attestation public key is not pinned by the trusted registry");
      return;
    }
    const publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
    const payload = canonicalJson({ ...pack, signature: undefined });
    const valid = typeof signature.value === "string" && verify(null, Buffer.from(payload), publicKey, Buffer.from(signature.value, "base64"));
    if (!valid) problems.push("deployment attestation signature is invalid");
  } catch {
    problems.push("deployment attestation signature or public key is invalid");
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function utcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    result[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true";
  }
  return result;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required`);
  return value;
}
