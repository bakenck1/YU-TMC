import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Node 22 is the single declared application toolchain", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    engines?: { node?: string };
  };
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");
  const readme = await readFile("README.md", "utf8");
  const nvmrc = await readFile(".nvmrc", "utf8");
  const npmrc = await readFile(".npmrc", "utf8");

  assert.equal(packageJson.engines?.node, "22.x");
  assert.match(workflow, /node-version:\s*22\b/);
  assert.match(readme, /Node\.js 22\.x/);
  assert.equal(nvmrc.trim(), "22");
  assert.match(npmrc, /^engine-strict=true$/m);
});

test("direct production deployment uses lockfile installation and systemd services", async () => {
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");
  const guide = await readFile("deploy/README.md", "utf8");
  const appService = await readFile("deploy/systemd/yu-inventory.service", "utf8");
  const workerService = await readFile("deploy/systemd/yu-inventory-push-worker.service", "utf8");

  assert.match(guide, /npm ci/);
  assert.match(guide, /npm run build/);
  assert.match(appService, /Restart=on-failure/);
  assert.match(workerService, /Restart=on-failure/);
  assert.doesNotMatch(workflow, /docker (?:compose|build|run|exec)/);
});
