import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createYuApiClient } from "../lib/server/integrations/yu-api-client";

test("YU API personnel lookup keeps credentials server-side and returns a minimal directory record", async () => {
  const requestedUrls: string[] = [];
  let authorization = "";
  const client = createYuApiClient(
    {
      YU_API_BASE_URL: "https://api.yu.example/base/",
      YU_API_TOKEN: "service-token",
      YU_API_TIMEOUT_MS: "2500",
    },
    async (input, init) => {
      requestedUrls.push(String(input));
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        count: 1,
        results: [
          {
            id: 42,
            full_name: "  Alisher Sagynov  ",
            mobile_phone: "+0 000 000 00 00",
            is_active: true,
            identify_code: "should-not-leave-the-server",
            user: {
              email: "ALISHER@YU.EDU.KZ",
              is_active: true,
              custom_data: { private: true },
            },
          },
        ],
      });
    },
  );

  assert.deepEqual(await client.searchPersonnel("  demo-user  "), [
    {
      id: "42",
      fullName: "Alisher Sagynov",
      email: "legacy-user@example.test",
      phone: "+0 000 000 00 00",
    },
  ]);
  assert.match(requestedUrls[0], /\/base\/api\/v2\/personnels\//);
  assert.match(requestedUrls[0], /search=demo-user/);
  assert.equal(authorization, "Token service-token");
  assert.doesNotMatch(JSON.stringify(await client.searchPersonnel("demo-user")), /identify_code|custom_data/);
  await client.checkConnection();
  assert.match(requestedUrls.at(-1) ?? "", /size=1/);
  assert.doesNotMatch(requestedUrls.at(-1) ?? "", /search=/);
});

test("YU API integration rejects missing configuration and malformed upstream data", async () => {
  assert.throws(
    () => createYuApiClient({}),
    (error: unknown) =>
      error instanceof Error && error.message === "yu_api_not_configured",
  );

  const client = createYuApiClient(
    {
      YU_API_BASE_URL: "https://api.yu.example",
      YU_API_TOKEN: "service-token",
    },
    async () => Response.json({ unexpected: true }),
  );
  await assert.rejects(
    () => client.searchPersonnel("ali"),
    (error: unknown) =>
      error instanceof Error && error.message === "yu_api_invalid_response",
  );
  await assert.rejects(
    () => client.searchPersonnel("123456789012"),
    (error: unknown) =>
      error instanceof Error && error.message === "invalid_yu_api_query",
  );
});

test("legacy sign-in verifies credentials without exposing the legacy token", async () => {
  let requestBody: unknown;
  let authorization: string | null = "unexpected";
  const client = createYuApiClient(
    {
      YU_API_BASE_URL: "https://api.yu.example",
      YU_API_TOKEN: "directory-service-token",
    },
    async (input, init) => {
      assert.match(String(input), /\/api\/users\/login\/$/);
      requestBody = JSON.parse(String(init?.body));
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({
        id: 7,
        email: " ADMIN@YU.EDU.KZ ",
        is_active: true,
        token: "legacy-user-token-must-be-discarded",
      });
    },
  );

  assert.deepEqual(
    await client.authenticateLegacyCredentials("admin", "old-password"),
    { email: "admin@yu.edu.kz" },
  );
  assert.deepEqual(requestBody, {
    username: "admin",
    password: "old-password",
  });
  assert.equal(authorization, null);
  assert.doesNotMatch(
    JSON.stringify(
      await client.authenticateLegacyCredentials("admin", "old-password"),
    ),
    /legacy-user-token/,
  );
});

test("legacy sign-in treats rejected credentials as invalid", async () => {
  const client = createYuApiClient(
    {
      YU_API_BASE_URL: "https://api.yu.example",
      YU_API_TOKEN: "directory-service-token",
    },
    async () => new Response(null, { status: 401 }),
  );
  assert.equal(
    await client.authenticateLegacyCredentials("admin", "wrong-password"),
    null,
  );
});

test("YU API route is admin-protected and never sends the service token to the browser", () => {
  const route = readFileSync(
    "app/api/integrations/yu-api/personnel/route.ts",
    "utf8",
  );
  const statusRoute = readFileSync(
    "app/api/integrations/yu-api/status/route.ts",
    "utf8",
  );
  const component = readFileSync("components/UsersManager.tsx", "utf8");
  assert.match(route, /requirePermission\(request, "legacy\.users\.manage"\)/);
  assert.match(statusRoute, /requirePermission\(request, "legacy\.users\.manage"\)/);
  assert.doesNotMatch(component, /YU_API_TOKEN|Authorization:\s*`Token/);

  const loginRoute = readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.match(loginRoute, /authenticateLegacyCredentials/);
  assert.match(loginRoute, /resolveYuApiIdentity/);
});

test("provisioning keeps the token out of console output and removes elevated permissions", () => {
  const script = readFileSync(
    "scripts/provision-yu-api-integration.mjs",
    "utf8",
  );
  assert.match(script, /user\.is_staff = False/);
  assert.match(script, /user\.is_superuser = False/);
  assert.match(script, /user\.groups\.clear\(\)/);
  assert.match(script, /user\.user_permissions\.clear\(\)/);
  assert.match(script, /codename='view_personnel'/);
  assert.doesNotMatch(script, /console\.log\([^\n]*token/i);
});
