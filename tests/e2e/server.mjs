import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pidFile = path.resolve(".next-e2e", "playwright-server.pid");
writeFileSync(pidFile, String(process.pid), "utf8");

process.argv = [
  process.execPath,
  "next",
  "start",
  ...process.argv.slice(2),
];

const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
await import(pathToFileURL(nextCli).href);
