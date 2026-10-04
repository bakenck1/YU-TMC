import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

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

const outputRoots = [...new Set([
  ".next",
  ".next-e2e",
  process.env.NEXT_DIST_DIR,
].filter((value) => typeof value === "string" && value.trim().length > 0))]
  .map((value) => path.resolve(process.cwd(), value));
const productionRoots = outputRoots.flatMap((root) => [
  path.join(root, "standalone"),
  path.join(root, "static"),
  path.join(root, "server"),
]);
for (const outputRoot of outputRoots) {
  for (const forbidden of ["_migration", "errors", ".data"]) {
    const standalonePath = path.join(outputRoot, "standalone", forbidden);
    if (existsSync(standalonePath)) {
      throw new Error(`Forbidden path found in standalone output: ${path.relative(process.cwd(), standalonePath)}`);
    }
  }
}
const secretAssignment = /(?:["']?)(SESSION_SECRET|DATABASE_URL|DATABASE_MIGRATOR_URL|WA_API_TOKEN)(?:["']?)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;}]+))/gi;
for (const outputRoot of productionRoots) {
  if (!existsSync(outputRoot)) continue;
  for (const file of filesUnder(outputRoot)) {
    const baseName = path.basename(file);
    if (
      /^\.env(?:\..*)?$/i.test(baseName) ||
      /(?:^|[._-])(credentials?|secrets?|id_rsa|\.pgpass)(?:[._-]|$)/i.test(baseName) ||
      /\.(?:pem|key|p12|pfx|dump|sql)$/i.test(baseName)
    ) {
      throw new Error(`Secret-like file found in production output: ${path.relative(process.cwd(), file)}`);
    }
    const stat = lstatSync(file);
    if (stat.size <= 8 * 1024 * 1024) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(secretAssignment)) {
        const value = match[2] ?? match[3] ?? match[4] ?? "";
        if (
          value.length >= 8 &&
          !/^(?:undefined|null|process\.env\b|replace-with\b|example\b|test\b|\$\{|(?:TEST_)?DATABASE_URL|(?:TEST_)?DATABASE_MIGRATOR_URL|WA_API_TOKEN|SESSION_SECRET)$/i.test(value)
        ) {
          throw new Error(`Secret assignment found in production output: ${path.relative(process.cwd(), file)}`);
        }
      }
    }
  }
}

for (const outputRoot of outputRoots.flatMap((root) => [
  path.join(root, "standalone"),
  path.join(root, "static"),
])) {
  if (!existsSync(outputRoot)) continue;
  const sourceMaps = readdirSync(outputRoot, {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && entry.name.endsWith(".map"));
  if (sourceMaps.length) {
    throw new Error(`Production output contains source maps under ${outputRoot}`);
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

function filesUnder(root) {
  try {
    const entries = readdirSync(root, { recursive: true, withFileTypes: true });
    const projectRoot = realpathSync(process.cwd());
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const link = path.join(entry.parentPath, entry.name);
        let target;
        try {
          target = realpathSync(link);
        } catch {
          throw new Error(`Broken symbolic link found in production output: ${link}`);
        }
        if (!isWithin(projectRoot, target)) {
          throw new Error(`Production output symbolic link escapes the project: ${link}`);
        }
      }
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
