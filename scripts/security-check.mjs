import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const requiredDockerExclusions = [
  "/_migration/",
  "/errors/",
  "**/.data/**",
  "**/.env*",
  "**/*secret*",
  "**/*credential*",
  "**/*.dump",
  "**/PG_VERSION",
];
const dockerIgnore = readFileSync(".dockerignore", "utf8");
for (const exclusion of requiredDockerExclusions) {
  if (!dockerIgnore.split(/\r?\n/).includes(exclusion)) {
    throw new Error(`Missing mandatory Docker exclusion: ${exclusion}`);
  }
}
for (const inclusion of [
  "!lib/security/credentials.ts",
  "!lib/security/secret-configuration.ts",
  "!lib/server/persistence/legacy/legacy-credential-source.ts",
]) {
  if (!dockerIgnore.split(/\r?\n/).includes(inclusion)) {
    throw new Error(`Missing mandatory Docker source inclusion: ${inclusion}`);
  }
}

const nextConfig = readFileSync("next.config.ts", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
if (/script-src[^"\n]*unsafe-inline/.test(nextConfig + proxy)) {
  throw new Error("CSP must not permit inline scripts");
}
if (!proxy.includes("'strict-dynamic'") || !proxy.includes('requestHeaders.set("x-nonce"')) {
  throw new Error("HTML responses must use a nonce-based script policy");
}

const publicItems = readdirSync(path.join("public", "items"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name !== ".gitkeep");
if (publicItems.length) {
  throw new Error("Inventory files must never be stored under public/items");
}

const routeFiles = findFiles(path.join(process.cwd(), "app"), "route.ts");
for (const file of routeFiles) {
  const source = readFileSync(file, "utf8");
  if (/request\.(?:json|formData)\(\)/.test(source)) {
    throw new Error(`Unbounded request body parser in ${path.relative(process.cwd(), file)}`);
  }
}

const standaloneRoot = path.join(process.cwd(), ".next", "standalone");
for (const forbidden of ["_migration", "errors", ".data"]) {
  if (existsSync(path.join(standaloneRoot, forbidden))) {
    throw new Error(`Forbidden path found in standalone output: ${forbidden}`);
  }
}

console.log("Security invariants verified.");

function findFiles(root, name, includeDirectories = false) {
  try {
    const entries = readdirSync(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) =>
        entry.name === name && (includeDirectories || entry.isFile()),
      )
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}
