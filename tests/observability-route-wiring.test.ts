import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const observedRoutes = [
  "app/api/auth/login/route.ts",
  "app/api/auth/session/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/reset-password/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/google/route.ts",
  "app/api/auth/google/callback/route.ts",
  "app/api/auth/yessenov/route.ts",
  "app/api/auth/yessenov/callback/route.ts",
  "app/api/integrations/1c/fixed-assets/route.ts",
  "app/api/v1/auth/check/route.ts",
  "app/api/v1/employees/route.ts",
  "app/api/v1/employees/[iin]/route.ts",
  "app/api/v1/employees/[iin]/items/route.ts",
  "app/api/v1/items/route.ts",
  "app/api/v1/items/[id]/photo/route.ts",
  "app/api/inventory/loss-cases/route.ts",
  "app/api/inventory/loss-cases/[id]/receipt/route.ts",
  "app/api/inventory/loss-cases/[id]/review/route.ts",
] as const;

test("initial external, auth and asset-loss boundaries use the behavioral observer", async () => {
  for (const filename of observedRoutes) {
    const source = await readFile(filename, "utf8");
    assert.match(source, /observeHttpRequest\(/, `${filename} must execute through observeHttpRequest`);
  }

  const worker = await readFile("scripts/process-tmc-push-outbox.ts", "utf8");
  const composition = await readFile("lib/server/application.ts", "utf8");
  const sessionRoute = await readFile("app/api/auth/session/route.ts", "utf8");
  const requestUser = await readFile("lib/server/security/request-user.ts", "utf8");
  assert.match(worker, /emitStructuredEvent\(/);
  assert.match(composition, /createStructuredWorkerLogger\("worker:tmc-push"\)/);
  assert.match(sessionRoute, /session_version_mismatch/);
  assert.match(requestUser, /session_version_mismatch/);
});
