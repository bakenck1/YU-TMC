import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pidFile = path.resolve(".next-e2e", "playwright-server.pid");
writeFileSync(pidFile, String(process.pid), "utf8");

const webhookPort = Number(process.env.YU_E2E_WEBHOOK_PORT);
const webhookSecret = process.env.AUTH_PASSWORD_RESET_WEBHOOK_SECRET;
const webhookFile = path.resolve(
  process.env.YU_DATA_DIRECTORY ?? ".next-e2e",
  "password-reset-webhook.json",
);

if (!Number.isSafeInteger(webhookPort) || webhookPort < 1 || !webhookSecret) {
  throw new Error("The E2E password-reset webhook is not configured safely");
}

const webhookServer = createServer((request, response) => {
  if (
    request.method !== "POST" ||
    request.url !== "/password-reset" ||
    request.headers.authorization !== `Bearer ${webhookSecret}`
  ) {
    response.writeHead(401).end();
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > 64 * 1024) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", () => {
    mkdirSync(path.dirname(webhookFile), { recursive: true });
    writeFileSync(webhookFile, Buffer.concat(chunks), "utf8");
    response.writeHead(204).end();
  });
});

await new Promise((resolve, reject) => {
  webhookServer.once("error", reject);
  webhookServer.listen(webhookPort, "127.0.0.1", resolve);
});

process.argv = [
  process.execPath,
  "next",
  "start",
  ...process.argv.slice(2),
];

const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
await import(pathToFileURL(nextCli).href);
