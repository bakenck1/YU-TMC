import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";
import { ESLint } from "eslint";

test("scratch files are excluded by the actual Git, lint and TypeScript discovery", async () => {
  const candidates = [".tmp-dockflow-deploy/probe.ts", ".data/postgres-development.log"];
  for (const file of candidates) {
    const git = spawnSync("git", ["check-ignore", "--no-index", "--", file], { encoding: "utf8", windowsHide: true });
    assert.equal(git.status, 0, file);
  }
  const lint = new ESLint();
  assert.equal(await lint.isPathIgnored(candidates[0]), true);
  const loaded = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, process.cwd());
  assert.equal(config.fileNames.some(file => file.replaceAll("\\", "/").includes("/.tmp-dockflow-deploy/")), false);
});
