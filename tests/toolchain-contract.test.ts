import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Node 24.15+ is the single declared application toolchain", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    engines?: { node?: string };
  };
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");
  const readme = await readFile("README.md", "utf8");
  const nvmrc = await readFile(".nvmrc", "utf8");
  const npmrc = await readFile(".npmrc", "utf8");

  assert.equal(packageJson.engines?.node, ">=24.15.0 <25");
  assert.match(workflow, /node-version:\s*24\.15\.0\b/);
  assert.match(readme, /Node\.js 24\.15\+ within the Node 24 major/);
  assert.equal(nvmrc.trim(), "24.15.0");
  assert.match(npmrc, /^engine-strict=true$/m);
});

test("the production build uses patched framework binaries and an application-only typecheck root", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: { next?: { sharp?: string } };
  };
  const packageLock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const nextConfig = await readFile("next.config.ts", "utf8");
  const buildConfig = JSON.parse(await readFile("tsconfig.build.json", "utf8")) as {
    extends?: string;
    include?: string[];
    exclude?: string[];
  };

  assert.equal(packageJson.dependencies?.next, "16.3.4");
  assert.equal(packageJson.dependencies?.sharp, "0.35.4");
  assert.equal(packageJson.devDependencies?.["eslint-config-next"], "16.3.4");
  assert.equal(packageJson.overrides?.next?.sharp, "0.35.4");
  assert.equal(packageLock.packages?.["node_modules/next"]?.version, "16.3.4");
  assert.equal(packageLock.packages?.["node_modules/sharp"]?.version, "0.35.4");
  assert.equal(packageLock.packages?.["node_modules/eslint-config-next"]?.version, "16.3.4");
  assert.match(nextConfig, /tsconfigPath:\s*"tsconfig\.build\.json"/);
  assert.equal(buildConfig.extends, "./tsconfig.json");
  assert.deepEqual(buildConfig.include, [
    "next-env.d.ts",
    "app/**/*.ts",
    "app/**/*.tsx",
    "components/**/*.ts",
    "components/**/*.tsx",
    "lib/**/*.ts",
    "lib/**/*.tsx",
    "scripts/**/*.ts",
    "proxy.ts",
    "next.config.ts",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    ".next-e2e/types/**/*.ts",
    ".next-e2e/dev/types/**/*.ts",
  ]);
  assert.deepEqual(buildConfig.exclude, [
    "node_modules",
    "tests",
    ".tmp-dockflow-deploy",
  ]);
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
  assert.doesNotMatch(workflow, /docker (?:compose|build|run|exec)/i);
});

test("the tracked application source remains container-runtime free", () => {
  const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !file.startsWith("_audit/"));
  const forbiddenArtifacts = /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|docker-compose(?:\.[^/]*)?|compose\.ya?ml|\.dockerignore)$/i;

  for (const file of trackedFiles) {
    assert.doesNotMatch(file, forbiddenArtifacts, `container artifact is tracked: ${file}`);
  }
});

test("production layout does not require a network request for fonts", async () => {
  const layout = await readFile("app/layout.tsx", "utf8");
  const styles = await readFile("app/globals.css", "utf8");

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(styles, /--font-geist-sans: ui-sans-serif/);
  assert.match(styles, /--font-geist-mono: ui-monospace/);
  assert.match(styles, /--font-montserrat:/);
});
