import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type PackageManifest = Partial<Record<(typeof dependencySections)[number], Record<string, string>>>;

test("scratch and the development PostgreSQL log stay outside Git, lint and TypeScript scopes", async () => {
  const [gitignore, eslintConfig, tsconfigSource, packageSource] = await Promise.all([
    readFile(".gitignore", "utf8"),
    readFile("eslint.config.mjs", "utf8"),
    readFile("tsconfig.json", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const tsconfig = JSON.parse(tsconfigSource) as { exclude?: string[] };
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };

  assert.match(gitignore, /^\/\.tmp-dockflow-deploy\/$/m);
  assert.match(gitignore, /^\/\.data\/postgres-development\.log$/m);
  assert.match(eslintConfig, /"\.tmp-dockflow-deploy\/\*\*"/);
  assert.ok(tsconfig.exclude?.includes(".tmp-dockflow-deploy"));
  assert.equal(packageJson.scripts?.lint, "eslint --max-warnings=0");
});

test("unused chart and Swagger UI packages are absent from direct and locked dependencies", async () => {
  const [packageSource, lockSource, itemTable, trackedFilesResult] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("package-lock.json", "utf8"),
    readFile("components/ItemsTable.tsx", "utf8"),
    execFileAsync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }),
  ]);
  const packageJson = JSON.parse(packageSource) as PackageManifest;
  const lock = JSON.parse(lockSource) as { packages?: Record<string, PackageManifest> };
  const sourceOrConfigFiles = trackedFilesResult.stdout
    .split("\0")
    .filter((file) => file && !file.startsWith("tests/"))
    .filter((file) => /(?:^|\/)(?:[^/]+\.)?(?:[cm]?[jt]sx?|json)$/.test(file))
    .filter((file) => file !== "package.json" && file !== "package-lock.json");
  const sourceEntries = (
    await Promise.all(
      sourceOrConfigFiles.map(async (file) => {
        try {
          return [file, await readFile(file, "utf8")] as const;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      }),
    )
  ).filter((entry): entry is readonly [string, string] => entry !== null);

  for (const dependency of ["recharts", "swagger-ui-react"]) {
    for (const section of dependencySections) {
      assert.equal(packageJson[section]?.[dependency], undefined);
    }

    for (const [packagePath, manifest] of Object.entries(lock.packages ?? {})) {
      assert.equal(packagePath.endsWith(`/node_modules/${dependency}`) || packagePath === `node_modules/${dependency}`, false);
      for (const section of dependencySections) {
        assert.equal(manifest[section]?.[dependency], undefined);
      }
    }

    for (const [file, source] of sourceEntries) {
      assert.doesNotMatch(source, new RegExp(`["']${dependency}(?:[\\/"'])`), file);
    }
  }
  assert.doesNotMatch(itemTable, /function itemDetails\(/);
});
