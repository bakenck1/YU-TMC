import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

const script = path.resolve("scripts/check-release-evidence.mjs");
const signingKeys = generateKeyPairSync("ed25519");
const publicKeySpki = signingKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const publicKeyDigest = createHash("sha256").update(Buffer.from(publicKeySpki, "base64")).digest("hex");

test("a complete evidence pack produces GO only with every gate evidenced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "release-evidence-"));
  try {
    const packFile = path.join(directory, "pack.json");
    const pack = await validPack();
    await writeFile(packFile, JSON.stringify(pack), "utf8");
    const output = await run(packFile);
    assert.match(output, /\(GO\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocked, missing, forged and secret-bearing evidence cannot manufacture GO", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "release-evidence-"));
  try {
    const packFile = path.join(directory, "pack.json");
    const cases: Array<[string, (pack: Awaited<ReturnType<typeof validPack>>) => void, RegExp]> = [
      ["blocked", (pack) => { pack.gates[0]!.status = "blocked"; pack.gates[0]!.rationale = "No staging access"; pack.gates[0]!.evidence = []; }, /verdict must be NO-GO/],
      ["critical n-a", (pack) => { pack.gates[0]!.status = "not-applicable"; pack.gates[0]!.rationale = "Not applicable"; pack.gates[0]!.evidence = []; }, /critical gate cannot be not-applicable/],
      ["blocked prerequisite", (pack) => { pack.prerequisites[0]!.status = "blocked"; pack.prerequisites[0]!.rationale = "Evidence window incomplete"; pack.prerequisites[0]!.evidence = []; }, /alert-delivery: pass requires prerequisite/],
      ["missing", (pack) => { pack.gates.pop(); }, /missing gate alert-delivery/],
      ["secret", (pack) => { pack.gates[0]!.evidence[0]!.uri = "https://user:password@example.test/result"; }, /repository-relative evidence path/],
      ["remote URL", (pack) => { pack.gates[1]!.evidence[0]!.uri = "https://evidence.example.test/releases/latest.txt"; }, /repository-relative evidence path/],
      ["future", (pack) => { pack.gates[0]!.evidence[0]!.capturedAt = "2999-01-01T00:00:00.000Z"; }, /non-future RFC3339 UTC timestamp/],
      ["local timestamp", (pack) => { pack.gates[0]!.evidence[0]!.capturedAt = "2026-09-08 12:00:00"; }, /RFC3339 UTC timestamp/],
      ["after pack timestamp", (pack) => { pack.gates[0]!.evidence[0]!.capturedAt = "2026-09-08T12:00:01.000Z"; }, /within 30 days before/],
      ["migration drift", (pack) => { pack.release.migrationSet.pop(); }, /must exactly match drizzle/],
      ["dirty-tree hash", (pack) => { pack.gates[0]!.evidence[0]!.sha256 = createHash("sha256").update("modified working tree").digest("hex"); }, /does not match the file at release.evidenceCommitSha/],
      ["registry drift", (pack) => { pack.release.gateRegistrySha256 = "c".repeat(64); }, /must match the active gate registry/],
      ["artifact digest", (pack) => { pack.release.artifactSha256 = "not-a-digest"; }, /GO release.artifactSha256/],
      ["bad signature", (pack) => { pack.signature.value = Buffer.from("forged").toString("base64"); }, /signature is invalid/],
    ];
    for (const [, mutate, expected] of cases) {
      const pack = await validPack();
      mutate(pack);
      await writeFile(packFile, JSON.stringify(pack), "utf8");
      await assert.rejects(run(packFile), expected);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the committed NO-GO pack resolves its pinned historical evidence", async () => {
  const output = await run(path.resolve("release-evidence/local-2026-09-08-no-go.json"));
  assert.match(output, /\(NO-GO\)/);
});

async function validPack() {
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const journal = JSON.parse(execFileSync(
    "git",
    ["show", `${commitSha}:drizzle/meta/_journal.json`],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  )) as { entries: Array<{ tag: string }> };
  const baseline = JSON.parse(await readFile("scripts/release-evidence-gates.json", "utf8")) as {
    prerequisites: Array<{ id: string; owner: string }>;
    gates: Array<{ id: string; owner: string }>;
  };
  const localEvidence = execFileSync("git", ["show", `${commitSha}:docs/release-checklist.md`], { cwd: process.cwd(), windowsHide: true });
  const localEvidenceHash = createHash("sha256").update(localEvidence).digest("hex");
  const baselineBytes = await readFile("scripts/release-evidence-gates.json");
  const pack = {
    formatVersion: 1,
    packId: "release-2026-09-08-test",
    release: {
      commitSha,
      evidenceCommitSha: commitSha,
      artifactSha256: "b".repeat(64),
      gateRegistrySha256: createHash("sha256").update(baselineBytes).digest("hex"),
      deploymentId: "test-deployment",
      environment: "isolated-test",
      timestamp: "2026-09-08T12:00:00.000Z",
      executor: "release-test-runner",
      migrationSet: journal.entries.map((entry) => entry.tag),
    },
    prerequisites: baseline.prerequisites.map((item) => ({
      id: item.id,
      status: "pass",
      owner: item.owner,
      rationale: "Verified by isolated test fixture",
      evidence: [{
        uri: "docs/release-checklist.md",
        sha256: localEvidenceHash,
        capturedAt: "2026-09-08T12:00:00.000Z",
      }],
    })),
    gates: baseline.gates.map((gate) => ({
      id: gate.id,
      status: "pass",
      owner: gate.owner,
      rationale: "Verified by isolated test fixture",
      evidence: [{
        uri: "docs/release-checklist.md",
        sha256: localEvidenceHash,
        capturedAt: "2026-09-08T12:00:00.000Z",
      }],
    })),
    verdict: "GO",
    signature: { algorithm: "ed25519", keyId: "release-platform-v1", value: "" },
  };
  pack.signature.value = sign(null, Buffer.from(canonicalJson({ ...pack, signature: undefined })), signingKeys.privateKey).toString("base64");
  return pack;
}

function run(file: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--file", file], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        RELEASE_EVIDENCE_PUBLIC_KEY_SPKI: publicKeySpki,
        RELEASE_EVIDENCE_TEST_PUBLIC_KEY_SHA256: publicKeyDigest,
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout)));
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
