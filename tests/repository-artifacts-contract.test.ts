import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("repository artifact policy is discoverable and enforced in CI", async () => {
  const [policy, baselineSource, workflow, packageSource, documentationChecker, securityChecker, gitmodules] = await Promise.all([
    readFile("docs/repository-artifacts.md", "utf8"),
    readFile("scripts/repository-artifacts-baseline.json", "utf8"),
    readFile(".github/workflows/tests.yml", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/check-documentation.mjs", "utf8"),
    readFile("scripts/security-check.mjs", "utf8"),
    readFile(".gitmodules", "utf8"),
  ]);
  const baseline = JSON.parse(baselineSource) as {
    nextReview: string;
    reports: Array<{ path: string; commit: string }>;
  };

  assert.match(policy, /immutable evidence/);
  assert.match(policy, new RegExp(baseline.nextReview));
  assert.match(packageSource, /"artifacts:check"\s*:/);
  assert.match(workflow, /npm run artifacts:check/);
  assert.match(documentationChecker, /docs\/repository-artifacts\.md/);
  assert.match(securityChecker, /\"\/_audit\/\"/);
  assert.match(securityChecker, /\"docs\"/);
  assert.match(securityChecker, /\"tests\"/);
  assert.match(gitmodules, /path = _audit\/Anthropic-Cybersecurity-Skills/);
  for (const report of baseline.reports) {
    assert.match(policy, new RegExp(report.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(policy, new RegExp(report.commit));
  }
});

test("repository artifact checker passes for the current repository", () => {
  const result = spawnSync(process.execPath, ["scripts/check-repository-artifacts.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Repository artifact check passed/);
});
