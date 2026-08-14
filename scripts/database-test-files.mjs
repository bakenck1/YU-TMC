import { readdirSync } from "node:fs";
import path from "node:path";

export function getDatabaseTestFiles(root) {
  return readdirSync(path.join(root, "tests", "database"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => path.join("tests", "database", name));
}
