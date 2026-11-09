import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

export function getDatabaseTestFiles(root) {
  return readdirSync(path.join(root, "tests", "database"), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => path.join("tests", "database", name));
}

export function databaseTestArguments(root, file) {
  const report = path.join(root, ".artifacts", "database-tests", `${file.replaceAll("\\", "/").replaceAll("/", "__")}.json`);
  mkdirSync(path.dirname(report), { recursive: true });
  return [
    path.join(root, "node_modules", "vitest", "vitest.mjs"), "run",
    "--config", path.join(root, "vitest.config.mjs"), file,
    "--reporter=default", "--reporter=json", `--outputFile.json=${report}`,
  ];
}
