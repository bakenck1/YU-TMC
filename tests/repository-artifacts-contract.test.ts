import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("repository artifact checker passes for the current repository", () => {
  const result = spawnSync(process.execPath, ["scripts/check-repository-artifacts.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Repository artifact check passed/);
});
