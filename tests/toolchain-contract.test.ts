import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Node 22 is the single declared application toolchain", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    engines?: { node?: string };
  };
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");
  const dockerfile = await readFile("Dockerfile.mobile", "utf8");
  const readme = await readFile("README.md", "utf8");
  const nvmrc = await readFile(".nvmrc", "utf8");
  const npmrc = await readFile(".npmrc", "utf8");

  assert.equal(packageJson.engines?.node, "22.x");
  assert.match(workflow, /node-version:\s*22\b/);
  assert.match(dockerfile, /^FROM node:22-bookworm-slim AS base$/m);
  assert.match(readme, /Node\.js 22\.x/);
  assert.equal(nvmrc.trim(), "22");
  assert.match(npmrc, /^engine-strict=true$/m);
});

test("Docker dependencies are installed from the lockfile without force", async () => {
  const dockerfile = await readFile("Dockerfile.mobile", "utf8");

  assert.match(dockerfile, /COPY package\.json package-lock\.json \.npmrc \.\//);
  assert.match(dockerfile, /RUN npm ci\b/);
  assert.doesNotMatch(dockerfile, /npm install/);
  assert.doesNotMatch(dockerfile, /--ignore-scripts/);
  assert.doesNotMatch(dockerfile, /--force/);
});

test("CI builds every Docker runtime target", async () => {
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");

  assert.match(workflow, /for target in builder migrator worker runner; do/);
  assert.match(workflow, /docker build --file Dockerfile\.mobile --target "\$target"/);
  assert.match(workflow, /docker run --rm yu-inventory-ci:builder/);
  assert.match(workflow, /docker run --rm yu-inventory-ci:migrator/);
  assert.match(workflow, /docker run --rm yu-inventory-ci:worker/);
  assert.match(workflow, /docker run --rm yu-inventory-ci:runner/);
});
