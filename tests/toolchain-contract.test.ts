import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { satisfies } = require("semver") as { satisfies(version: string, range: string): boolean };

test("the declared Node version satisfies the supported application engine", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const selected = (await readFile(".nvmrc", "utf8")).trim();
  assert.equal(satisfies(selected, manifest.engines.node), true);
  assert.equal(satisfies(process.versions.node, manifest.engines.node), true);
});

test("framework dependencies agree with their installed lockfile versions", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  for (const name of ["next", "sharp", "eslint-config-next"]) {
    const declared = manifest.dependencies[name] ?? manifest.devDependencies[name];
    const locked = lock.packages["node_modules/" + name].version;
    assert.equal(satisfies(locked, declared), true, name);
  }
  assert.equal(manifest.dependencies.next, manifest.devDependencies["eslint-config-next"]);
});

test("production typechecking includes application code and excludes test fixtures", () => {
  const loaded = ts.readConfigFile("tsconfig.build.json", ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, process.cwd());
  assert.equal(config.errors.length, 0);
  const files = config.fileNames.map(file => file.replaceAll("\\", "/"));
  assert.equal(files.some(file => file.endsWith("/app/layout.tsx")), true);
  assert.equal(files.some(file => file.includes("/tests/")), false);
});
