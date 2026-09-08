import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/report-legacy-usage.mjs");
const ids = [
  ["LEGACY-PERMISSIONS", "legacy.items.read", "allowed"],
  ["LEGACY-TRANSFER-ROUTES", "decision", "accepted"],
  ["LEGACY-QR-ALIASES", "legacy_raw", "resolved"],
  ["LEGACY-AUTH-IMPORT", "configured", "imported"],
  ["LEGACY-COOKIE-CONTRACT", "v1", "accepted"],
  ["LEGACY-SEED-DATA", "development", "completed"],
] as const;

test("legacy report aggregates all six boundaries without identifier labels", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legacy-report-"));
  try {
    const source = path.join(directory, "journal.ndjson");
    const output = path.join(directory, "report.md");
    const sensitive = "8b88ac18-f334-47b0-88ad-d228f84322d3";
    const lines = ids.flatMap(([compatibilityId, variant, outcome], index) => [0, 1].map(() => JSON.stringify({
      timestamp: `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`,
      event: "legacy.usage",
      requestId: sensitive,
      attributes: { compatibilityId, variant, outcome },
    })));
    lines.push(JSON.stringify({
      timestamp: "2026-01-02T00:00:00.000Z",
      event: "legacy.usage",
      attributes: {
        compatibilityId: "LEGACY-PERMISSIONS",
        variant: "legacy.items.read",
        outcome: "manufactured_success",
      },
    }));
    await writeFile(source, `${lines.join("\n")}\n`, "utf8");
    await run(["--source-file", source, "--output-file", output, "--from", "2026-01-01T00:00:00.000Z", "--to", "2026-04-02T00:00:00.000Z", "--coverage-confirmed", "--uptime-confirmed"]);
    const report = await readFile(output, "utf8");
    assert.match(report, /Evidence status: complete/);
    for (const [compatibilityId, variant, outcome] of ids) {
      assert.match(report, new RegExp(`\\| ${compatibilityId} .*\\| 2 \\| observed \\| keep \\| ${variant}:${outcome}=2 \\|`));
    }
    assert.doesNotMatch(report, new RegExp(sensitive));
    assert.doesNotMatch(report, /manufactured_success/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("absence stays unknown without full coverage and uptime evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legacy-report-"));
  try {
    const source = path.join(directory, "journal.ndjson");
    const output = path.join(directory, "report.md");
    await writeFile(source, "info: healthy\n", "utf8");
    await run(["--source-file", source, "--output-file", output, "--from", "2026-08-14T00:00:00.000Z", "--to", "2026-09-08T00:00:00.000Z"]);
    const report = await readFile(output, "utf8");
    assert.match(report, /Evidence status: unknown/);
    assert.equal((report.match(/\| 0 \| unknown \| keep \|/g) ?? []).length, 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("report rejects a future interval instead of manufacturing complete zero evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legacy-report-"));
  try {
    const source = path.join(directory, "journal.ndjson");
    const output = path.join(directory, "report.md");
    await writeFile(source, "", "utf8");
    await assert.rejects(
      run(["--source-file", source, "--output-file", output, "--from", "2999-01-01T00:00:00.000Z", "--to", "2999-04-02T00:00:00.000Z", "--coverage-confirmed", "--uptime-confirmed"]),
      /--to cannot be in the future/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `report exited with ${code}`)));
  });
}
