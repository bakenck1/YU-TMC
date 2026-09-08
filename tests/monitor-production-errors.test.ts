import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

const scriptPath = path.resolve("scripts/monitor-production-errors.mjs");

test("monitoring report records the custom source window", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-monitor-"));
  try {
    const sourceFile = path.join(directory, "logs.jsonl");
    const timestamp = new Date().toISOString();
    await writeFile(
      sourceFile,
      [
        JSON.stringify({
          timestamp,
          level: "error",
          message: "custom window failure",
          route: "/health",
          status: 500,
        }),
        JSON.stringify({
          timestamp,
          level: "fatal",
          message: "second custom window failure",
          route: "/ready",
          status: 503,
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    await runMonitor(["--since-minutes", "5", "--source-file", sourceFile, "--output-dir", directory]);

    const reports = await readReports(directory);
    assert.equal(reports.length, 2);
    for (const report of reports) {
      assert.match(report, /source_window_minutes: 5/);
      assert.match(report, /Occurrences: 1/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitoring report keeps the thirty-minute default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-monitor-"));
  try {
    const sourceFile = path.join(directory, "logs.jsonl");
    await writeFile(
      sourceFile,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "fatal",
        message: "default window failure",
      })}\n`,
      "utf8",
    );

    await runMonitor(["--source-file", sourceFile, "--output-dir", directory]);

    const report = await readReport(directory);
    assert.match(report, /source_window_minutes: 30/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor reads the structured envelope and old journal lines without sensitive context", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-monitor-"));
  try {
    const sourceFile = path.join(directory, "logs.jsonl");
    const timestamp = new Date().toISOString();
    await writeFile(sourceFile, [
      JSON.stringify({
        timestamp,
        level: "error",
        event: "http.request.failed",
        requestId: "safe-request-id",
        route: "/api/auth/login",
        status: 500,
        duration: 12,
        deploymentId: "deploy-safe",
        errorCode: "internal_error",
        email: "person@example.test",
        iin: "123456789012",
        body: "<xml>secret</xml>",
        photo: "data:image/jpeg;base64,c2VjcmV0",
        cause: { message: "nested secret" },
        details: { authorization: "Bearer secret" },
      }),
      `[ERROR] ${timestamp} legacy journal failure route=/legacy status=500 request_id=legacy-safe body=<xml>secret</xml> fullName: Sensitive Person photo=raw-secret-photo`,
    ].join("\n") + "\n", "utf8");

    await runMonitor(["--source-file", sourceFile, "--output-dir", directory]);
    const reports = await readReports(directory);
    assert.equal(reports.length, 2);
    const report = reports.find((value) => value.includes("http.request.failed"));
    assert.ok(report);
    assert.match(report, /Deployment ID: `deploy-safe`/);
    assert.match(report, /Error code: `internal_error`/);
    assert.doesNotMatch(reports.join("\n"), /person@example\.test|123456789012|<xml>|base64|nested secret|Bearer secret|Sensitive Person|raw-secret-photo/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("structured errors with different error codes remain separate incidents", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-monitor-"));
  try {
    const sourceFile = path.join(directory, "logs.jsonl");
    const timestamp = new Date().toISOString();
    const base = {
      timestamp,
      level: "error",
      event: "http.request.failed",
      route: "/api/example",
      status: 500,
    };
    await writeFile(sourceFile, [
      JSON.stringify({ ...base, errorCode: "database_unavailable" }),
      JSON.stringify({ ...base, errorCode: "dependency_timeout" }),
    ].join("\n") + "\n", "utf8");

    await runMonitor(["--source-file", sourceFile, "--output-dir", directory]);
    const reports = await readReports(directory);
    assert.equal(reports.length, 2);
    assert.match(reports.join("\n"), /database_unavailable/);
    assert.match(reports.join("\n"), /dependency_timeout/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a no-error run clears state without rewriting the previous report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-monitor-"));
  try {
    const sourceFile = path.join(directory, "logs.jsonl");
    await writeFile(
      sourceFile,
      `${JSON.stringify({ timestamp: new Date().toISOString(), level: "error", message: "persisted failure" })}\n`,
      "utf8",
    );
    await runMonitor(["--source-file", sourceFile, "--output-dir", directory]);
    const reportName = (await readdir(directory)).find((name) => name.endsWith(".md"));
    assert.ok(reportName);
    const reportBefore = await readFile(path.join(directory, reportName), "utf8");

    await writeFile(sourceFile, "info: healthy\n", "utf8");
    await runMonitor(["--source-file", sourceFile, "--output-dir", directory]);

    const state = JSON.parse(await readFile(path.join(directory, ".monitor-state.json"), "utf8")) as {
      incidents: Record<string, unknown>;
    };
    assert.deepEqual(state.incidents, {});
    assert.equal(await readFile(path.join(directory, reportName), "utf8"), reportBefore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function readReport(directory: string) {
  const reports = await readReports(directory);
  assert.equal(reports.length, 1);
  return reports[0];
}

async function readReports(directory: string) {
  const reportNames = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
  return Promise.all(reportNames.map((name) => readFile(path.join(directory, name), "utf8")));
}

function runMonitor(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test" },
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `monitor exited with ${code}`));
      }
    });
  });
}
