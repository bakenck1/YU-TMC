import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("operational documentation uses existing commands and paths", async () => {
  const result = await runDocumentationCheck();
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Documentation check passed/);
});

test("documentation checker rejects stale commands and broken paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-docs-"));
  try {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ scripts: { start: "next start" } }), "utf8");
    for (const file of ["README.md", "docs/database.md", "docs/production-monitoring.md", "docs/release-checklist.md", "TASKS.md"]) {
      const target = file === "README.md" ? "npm run missing-command\n[nothing](missing)\n[directory](docs)\n" : "ok\n";
      const filePath = path.join(directory, file);
      await mkdirFor(filePath);
      await writeFile(filePath, target, "utf8");
    }

    const result = await runDocumentationCheck(directory);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /missing-command/);
    assert.match(result.stderr, /missing/);
    assert.match(result.stderr, /docs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function runDocumentationCheck(rootDirectory = process.cwd()) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/check-documentation.mjs", "--root", rootDirectory], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function mkdirFor(filePath: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
}
