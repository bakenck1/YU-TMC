import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Keep the full migration configuration private; workers and Next need only
// runtime credentials. Empty values also stop Next's .env.local fallback.
const [source, destination] = process.argv.slice(2);
if (!source || !destination || process.argv.length !== 4) {
  throw new Error("Usage: node deploy/prepare-runtime-env.mjs SOURCE DESTINATION");
}
const sourcePath = path.resolve(source);
const destinationPath = path.resolve(destination);
const samePath = process.platform === "win32"
  ? sourcePath.toLowerCase() === destinationPath.toLowerCase()
  : sourcePath === destinationPath;
if (samePath) throw new Error("Source and destination must differ.");

const lines = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "").split(/\r?\n/u);
if (lines.some((line) => {
  if (/^\s*(?:#.*)?$/u.test(line)) return false;
  const assignment = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/u);
  if (!assignment) return true;
  const value = assignment[1].trimStart(), quote = value[0];
  if (!["'", '"', "`"].includes(quote)) return false;
  let escaped = false;
  for (let index = 1; index < value.length; index++) {
    if (value[index] === quote && !escaped) return false;
    escaped = value[index] === "\\" && !escaped;
  }
  return true;
})) {
  throw new Error("Environment file must use one KEY=value assignment per line.");
}
const configuration = lines
  .filter((line) => !/^\s*(?:export\s+)?(?:TEST_)?DATABASE_MIGRATOR_URL\s*=/u.test(line))
  .map((line) => line.replace(/^(\s*)export\s+/u, "$1"))
  .join("\n");
const runtimeConfiguration = `${configuration.trimEnd()}\nDATABASE_MIGRATOR_URL=\nTEST_DATABASE_MIGRATOR_URL=\n`;
const temporaryPath = path.join(path.dirname(destinationPath), `.yu-inventory-runtime-${randomUUID()}`);
try {
  writeFileSync(temporaryPath, runtimeConfiguration, { mode: 0o600, flag: "wx" });
  renameSync(temporaryPath, destinationPath);
} finally {
  rmSync(temporaryPath, { force: true });
}
