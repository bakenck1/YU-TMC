import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createIntegrationKey(scope = "read", now = new Date()) {
  if (scope !== "read") throw new Error("Only read-only integration keys are supported.");
  const token = `yu_read_${randomBytes(32).toString("base64url")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(now.getTime() + 90 * 86_400_000).toISOString() };
}

function main() {
  const scope = process.argv[2] ?? "read";
  if (scope !== "read" || process.argv.length > 3) throw new Error("Usage: node scripts/create-integration-key.mjs [read]");
  const key = createIntegrationKey(scope);
  const directory = path.resolve(".private-transfer");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = `${scope}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
  const consumer = path.join(directory, `${name}-consumer.env`);
  const server = path.join(directory, `${name}-server.env`);
  writeFileSync(consumer, `# Private: give only to the integration developer. Server-side use only.\nYU_INVENTORY_${scope.toUpperCase()}_API_KEY=${key.token}\n# Expires at ${key.expiresAt}\n`, { flag: "wx", mode: 0o600 });
  writeFileSync(server, `# Install only on the YU Inventory server.\nINTEGRATION_API_READ_KEY_SHA256=${key.hash}\nINTEGRATION_API_READ_EXPIRES_AT=${key.expiresAt}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Developer credentials: ${consumer}\nInventory server configuration: ${server}\nThe key is not printed and has not been activated.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
