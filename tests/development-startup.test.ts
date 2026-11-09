import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("development starts Next only after database preparation succeeds", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "yu-startup-behavior-"));
  const hook = path.join(directory, "commands.mjs");
  const log = path.join(directory, "commands.jsonl");
  try {
    await writeFile(hook, `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { EventEmitter } from 'node:events';
      import { appendFileSync } from 'node:fs';
      childProcess.spawn = (_command, args) => {
        appendFileSync(process.env.REVIEW_COMMAND_LOG, JSON.stringify(args) + '\\n');
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', args.includes(process.env.REVIEW_FAIL_COMMAND) ? 17 : 0, null));
        return child;
      };
      syncBuiltinESMExports();
    `);
    const run = (fail: string) => spawnSync(process.execPath, ["--import", pathToFileURL(hook).href, "scripts/dev.mjs"], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused", npm_execpath: "", REVIEW_COMMAND_LOG: log, REVIEW_FAIL_COMMAND: fail },
    });
    const success = run("no-command");
    assert.equal(success.status, 0, success.stderr);
    const commands: string[] = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line)[1]);
    const migration = commands.indexOf("db:migrate");
    const settings = commands.indexOf("db:import-settings");
    const smoke = commands.indexOf("db:smoke");
    const server = commands.indexOf("dev:next");
    assert.ok(migration >= 0 && settings > migration && smoke > settings && server > smoke);
    await writeFile(log, "");
    const failed = run("db:migrate");
    assert.equal(failed.status, 17, failed.stderr);
    assert.deepEqual((await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line)[1]), ["db:migrate"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
