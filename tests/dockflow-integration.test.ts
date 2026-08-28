import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCKFLOW_ITEM_STATUSES,
  highestDockflowStatus,
  isValidDockflowEmail,
  isValidDockflowIin,
  normalizeDockflowEmail,
  normalizeDockflowFullName,
} from "../lib/contracts/dockflow";

test("Dockflow identity normalization follows the public contract", () => {
  assert.equal(normalizeDockflowFullName("  Иванов   Иван\nИванович "), "иванов иван иванович");
  assert.equal(normalizeDockflowEmail(" I.Ivanov@Example.KZ "), "i.ivanov@example.kz");
  assert.equal(isValidDockflowIin("900101300123"), true);
  assert.equal(isValidDockflowIin("90010130012"), false);
  assert.equal(isValidDockflowIin("90010130012A"), false);
  assert.equal(isValidDockflowEmail("i.ivanov@example.kz"), true);
  assert.equal(isValidDockflowEmail("invalid"), false);
});

test("Dockflow chooses the strongest blocking status", () => {
  assert.equal(highestDockflowStatus([]), "CLEAR");
  assert.equal(highestDockflowStatus(["ASSETS_ASSIGNED"]), "ASSETS_ASSIGNED");
  assert.equal(
    highestDockflowStatus(["ASSETS_ASSIGNED", "LOSS_PAYMENT_PENDING", "ACCOUNTING_REVIEW_PENDING"]),
    "ACCOUNTING_REVIEW_PENDING",
  );
  assert.equal(highestDockflowStatus(["BLOCKED", "ACCOUNTING_REVIEW_PENDING"]), "BLOCKED");
});

test("Dockflow item statuses match the public per-item contract", () => {
  assert.deepEqual(DOCKFLOW_ITEM_STATUSES, [
    "ASSIGNED",
    "TRANSFER_PENDING",
    "RETURN_PENDING",
    "LOST",
    "PAYMENT_PENDING",
    "RECEIPT_SUBMITTED",
    "ACCOUNTING_VERIFIED",
  ]);
});

test("Dockflow endpoint is isolated from cookie proxy and emits no-store responses", async () => {
  const [proxy, route] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/dockflow/employee/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /matcher:\s*\["\/\(\(\?!api\|/);
  assert.match(route, /request\.headers\.get\("x-api-key"\)/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.doesNotMatch(route, /requireCurrentUser|cookies\(|SESSION_COOKIE/);
});

test("Dockflow persistence never stores the clear API key", async () => {
  const [migration, service] = await Promise.all([
    readFile(new URL("../drizzle/20260827143000_dockflow_integration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/dockflow-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /"key_hash" bytea NOT NULL/);
  assert.doesNotMatch(migration, /key_secret|clear_?text|plaintext/i);
  assert.match(service, /createHash\("sha256"\)/);
  assert.match(service, /randomBytes\(32\)/);
  assert.match(service, /timingSafeEqual/);
});

test("Dockflow raw keys are issued only by the server CLI", async () => {
  const [route, component, script, packageJson] = await Promise.all([
    readFile(new URL("../app/api/admin/integrations/dockflow/key/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/DockflowIntegrationSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/manage-dockflow-key.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(
    component,
    /setSecret|clipboard\.writeText|payload\.key(?:\W|$)/,
  );
  assert.match(script, /process\.stdout\.write\(`\$\{result\.key\}\\n`\)/);
  assert.match(packageJson, /"dockflow:key"/);
});

test("production Nginx does not log the personal-data query string", async () => {
  const nginx = await readFile(new URL("../deploy/nginx/yu-inventory.conf", import.meta.url), "utf8");
  assert.match(
    nginx,
    /location = \/api\/integrations\/dockflow\/employee \{[\s\S]*?access_log off;/,
  );
});
