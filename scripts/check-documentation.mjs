#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { existsSync as pathExists, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const cliArgs = parseArgs(process.argv.slice(2));
const root = path.resolve(String(cliArgs.root ?? process.cwd()));
const documentationFiles = [
  "README.md",
  "docs/database.md",
  "docs/production-monitoring.md",
  "docs/release-checklist.md",
  "docs/test-coverage.md",
  "docs/legacy-compatibility.md",
  "docs/repository-artifacts.md",
  "TASKS.md",
];

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const problems = [];

for (const relativeFile of documentationFiles) {
  const absoluteFile = path.join(root, relativeFile);
  let source;
  try {
    source = await readFile(absoluteFile, "utf8");
  } catch {
    problems.push(`${relativeFile}: documentation file does not exist`);
    continue;
  }

  checkCommands(relativeFile, source);
  checkRelativeLinks(relativeFile, source);
  checkBacktickedPaths(relativeFile, source);
}

if (problems.length) {
  console.error("Documentation check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${documentationFiles.length} operational files.`);
}

function checkCommands(relativeFile, source) {
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  for (const match of source.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
    const command = match[1];
    if (!scripts.has(command)) problems.push(`${relativeFile}: npm run ${command} is not defined in package.json`);
  }

  for (const match of source.matchAll(/\bnpm (test|start)\b/g)) {
    const command = match[1];
    if (!scripts.has(command)) problems.push(`${relativeFile}: npm ${command} is not defined in package.json`);
  }
}

function checkRelativeLinks(relativeFile, source) {
  const directory = path.dirname(path.join(root, relativeFile));
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0].trim();
    if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
    if (!existsSync(path.resolve(directory, target))) {
      problems.push(`${relativeFile}: linked path is not an existing file: ${target}`);
    }
  }
}

function checkBacktickedPaths(relativeFile, source) {
  const pathLike = /^(?:app|components|docs|lib|scripts|tests|public|drizzle|\.github)(?:[\\/][^`\s]+)?$/;
  for (const match of source.matchAll(/`([^`]+)`/g)) {
    const value = match[1];
    if (!pathLike.test(value)) continue;
    if (!existsSync(path.resolve(root, value))) problems.push(`${relativeFile}: referenced path is not an existing file: ${value}`);
  }
}

function existsSync(filePath) {
  try {
    return pathExists(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root" && argv[index + 1]) {
      parsed.root = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}
