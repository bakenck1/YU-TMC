import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { getApplicationServices } from "@/lib/server/application";
import {
  updatePasswordCredential,
  verifyPasswordCredentials,
} from "@/lib/security/credentials";
import { verifySessionToken } from "@/lib/security/session";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
  uniqueRequest,
} from "../helpers/auth-test-environment";

const directory = createAuthTestDirectory();
const PASSWORD = "Correct-Horse-Battery-2026!";

function jsonRequest(
  pathname: string,
  body: unknown,
  ip?: string,
) {
  return uniqueRequest(
    pathname,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    ip,
  );
}

function registrationRequest(
  email = "admin@example.com",
  password = PASSWORD,
  ip?: string,
) {
  return jsonRequest(
    "/api/auth/register",
    { firstName: "Ada", lastName: "Lovelace", email, password },
    ip,
  );
}

function loginRequest(
  email = "admin@example.com",
  password = PASSWORD,
  rememberMe = false,
  ip?: string,
) {
  return jsonRequest(
    "/api/auth/login",
    { email, password, rememberMe },
    ip,
  );
}

function cookieValue(response: Response) {
  const rawCookie = response.headers.get("set-cookie") ?? "";
  const match = rawCookie.match(/yu_inventory_session=([^;]+)/);
  if (!match) throw new Error(`Session cookie is missing: ${rawCookie}`);
  return { rawCookie, token: decodeURIComponent(match[1]) };
}

describe("authentication route handlers", () => {
  beforeEach(async () => {
    await resetAuthTestEnvironment(directory);
  });

  afterAll(async () => {
    await removeAuthTestDirectory(directory);
  });

  describe("first administrator registration", () => {
    it.each([
      [{ firstName: "A", lastName: "Lovelace", email: "admin@example.com", password: PASSWORD }],
      [{ firstName: "Ada", lastName: "L", email: "admin@example.com", password: PASSWORD }],
      [{ firstName: "Ada", lastName: "Lovelace", email: "not-an-email", password: PASSWORD }],
      [{ firstName: "Ada", lastName: "Lovelace", email: "admin@example.com", password: "too-short" }],
    ])("rejects invalid registration input without creating credentials", async (body) => {
      const response = await register(jsonRequest("/api/auth/register", body));
      expect(response.status).toBe(400);
      await expect(verifyPasswordCredentials("admin@example.com", PASSWORD)).resolves.toBe(false);
    });

    it("normalizes the identity, hashes the password and closes registration", async () => {
      const response = await register(
        jsonRequest("/api/auth/register", {
          firstName: "  Ada ",
          lastName: " Lovelace  ",
          email: "  ADMIN@Example.COM ",
          password: PASSWORD,
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        registered: true,
        user: { email: "admin@example.com", name: "Ada Lovelace", role: "admin" },
      });

      await expect(getApplicationServices().users.listUsers()).resolves.toEqual([
        expect.objectContaining({
        email: "admin@example.com",
        fullName: "Ada Lovelace",
        role: "admin",
        }),
      ]);
      await expect(verifyPasswordCredentials("ADMIN@example.com", PASSWORD)).resolves.toBe(true);

      const repeated = await register(registrationRequest("second@example.com"));
      expect(repeated.status).toBe(409);
      await expect(repeated.json()).resolves.toEqual({ error: "registration_closed" });
    });

    it("atomically permits exactly one of two simultaneous registrations", async () => {
      const candidates = [
        { email: "first@example.com", password: "First-Secure-Password-2026!" },
        { email: "second@example.com", password: "Second-Secure-Password-2026!" },
      ];
      const responses = await Promise.all(
        candidates.map((candidate, index) =>
          register(registrationRequest(candidate.email, candidate.password, `203.0.113.${index + 10}`)),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

      const winnerIndex = responses.findIndex((response) => response.status === 201);
      const winner = candidates[winnerIndex];
      const loser = candidates[1 - winnerIndex];
      expect(await login(loginRequest(winner.email, winner.password))).toMatchObject({ status: 200 });
      expect(await login(loginRequest(loser.email, loser.password))).toMatchObject({ status: 401 });
    });
  });

  describe("login protection and cookies", () => {
    it("updates only the configured account password", async () => {
      await register(registrationRequest());
      await expect(
        updatePasswordCredential("other@example.com", "Replacement-Password-2026!"),
      ).resolves.toBe(false);
      await expect(
        updatePasswordCredential(" ADMIN@example.com ", "Replacement-Password-2026!"),
      ).resolves.toBe(true);
      await expect(verifyPasswordCredentials("admin@example.com", PASSWORD)).resolves.toBe(false);
      await expect(
        verifyPasswordCredentials("admin@example.com", "Replacement-Password-2026!"),
      ).resolves.toBe(true);
    });

    it("returns 503 when no credentials exist", async () => {
      const response = await login(loginRequest());
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "authentication_not_configured" });
    });

    it("does not reveal whether the email or password was wrong", async () => {
      await register(registrationRequest());
      const wrongEmail = await login(loginRequest("unknown@example.com", PASSWORD));
      const wrongPassword = await login(loginRequest("admin@example.com", "Wrong-Password-2026!"));
      expect(wrongEmail.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      await expect(wrongEmail.json()).resolves.toEqual({ error: "invalid_credentials" });
      await expect(wrongPassword.json()).resolves.toEqual({ error: "invalid_credentials" });
    });

    it("locks an email after five failures across IPs while another email stays independent", async () => {
      await register(registrationRequest());
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await login(
          loginRequest(
            "admin@example.com",
            "Wrong-Password-2026!",
            false,
            `198.51.100.${attempt}`,
          ),
        );
        expect(response.status, `attempt ${attempt}`).toBe(401);
      }
      const blocked = await login(
        loginRequest("admin@example.com", PASSWORD, false, "198.51.100.99"),
      );
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).not.toBeNull();

      const independent = await login(
        loginRequest("other@example.com", "Wrong-Password-2026!", false, "198.51.100.99"),
      );
      expect(independent.status).toBe(401);
    });

    it("clears the per-email failure counter only after a successful login", async () => {
      await register(registrationRequest());
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(
          (await login(loginRequest("admin@example.com", "Wrong-Password-2026!"))).status,
        ).toBe(401);
      }
      expect((await login(loginRequest(" ADMIN@EXAMPLE.COM ", PASSWORD))).status).toBe(200);

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect(
          (await login(loginRequest("admin@example.com", "Wrong-Password-2026!"))).status,
          `post-success attempt ${attempt}`,
        ).toBe(401);
      }
      expect((await login(loginRequest("admin@example.com", PASSWORD))).status).toBe(429);
    });

    it("rejects a configured but blocked user", async () => {
      await register(registrationRequest());
      const users = getApplicationServices().users;
      const adminActorId = (
        await users.resolveCurrentAccount("admin@example.com")
      )!.userId;
      const second = await users.createUser({
        email: "second-admin@example.com",
        fullName: "Second Admin",
        role: "admin",
        initialPassword: "Second-Admin-Password-2026!",
      }, adminActorId);
      await users.updateUser(second.id, {
        fullName: second.fullName,
        phone: second.phone,
        role: second.role,
        emailVerified: second.emailVerified,
        active: true,
        version: second.version,
      }, adminActorId);
      const first = (await users.listUsers()).find(
        (user) => user.email === "admin@example.com",
      )!;
      await users.updateUser(first.id, {
        fullName: first.fullName,
        phone: first.phone,
        role: first.role,
        emailVerified: first.emailVerified,
        active: false,
        version: first.version,
      }, adminActorId);
      const response = await login(loginRequest());
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "user_blocked" });
    });

    it.each([
      [false, 8 * 60 * 60],
      [true, 30 * 24 * 60 * 60],
    ] as const)("issues the correct cookie contract when rememberMe=%s", async (rememberMe, ttl) => {
      await register(registrationRequest());
      const response = await login(loginRequest(" ADMIN@example.com ", PASSWORD, rememberMe));
      expect(response.status).toBe(200);
      const { rawCookie, token } = cookieValue(response);
      const payload = verifySessionToken(token);

      expect(rawCookie).toContain("HttpOnly");
      expect(rawCookie).toContain("SameSite=strict");
      expect(rawCookie).toContain("Path=/");
      if (rememberMe) expect(rawCookie).toContain(`Max-Age=${ttl}`);
      else expect(rawCookie).not.toContain("Max-Age=");
      expect(payload).not.toBeNull();
      expect(payload!.exp - payload!.iat).toBe(ttl);
    });

    it("wires the login IP limiter at its exact boundary", async () => {
      const ip = "192.0.2.55";
      for (let attempt = 1; attempt <= 30; attempt += 1) {
        const response = await login(
          jsonRequest("/api/auth/login", { malformed: true }, ip),
        );
        expect(response.status, `attempt ${attempt}`).toBe(400);
      }
      const blocked = await login(jsonRequest("/api/auth/login", { malformed: true }, ip));
      expect(blocked.status).toBe(429);
      await expect(blocked.json()).resolves.toMatchObject({
        error: "too_many_login_attempts",
      });
    });
  });

  describe("session and logout", () => {
    it("accepts only an untampered session cookie", async () => {
      await register(registrationRequest());
      const loggedIn = await login(loginRequest());
      const { token } = cookieValue(loggedIn);
      const valid = await session(
        new NextRequest("http://localhost/api/auth/session", {
          headers: { cookie: `yu_inventory_session=${token}` },
        }),
      );
      expect(valid.status).toBe(200);
      await expect(valid.json()).resolves.toMatchObject({
        authenticated: true,
        user: { email: "admin@example.com", role: "admin" },
      });

      const tampered = await session(
        new NextRequest("http://localhost/api/auth/session", {
          headers: { cookie: `yu_inventory_session=${token.slice(0, -1)}x` },
        }),
      );
      expect(tampered.status).toBe(401);
      expect((await session(new NextRequest("http://localhost/api/auth/session"))).status).toBe(401);
    });

    it("uses the current database name, role and active state for an old cookie", async () => {
      const registered = await register(registrationRequest());
      const { token } = cookieValue(registered);
      const users = getApplicationServices().users;
      const adminActorId = (
        await users.resolveCurrentAccount("admin@example.com")
      )!.userId;
      const second = await users.createUser({
        email: "second-admin@example.com",
        fullName: "Second Admin",
        role: "admin",
        initialPassword: "Second-Admin-Password-2026!",
      }, adminActorId);
      await users.updateUser(second.id, {
        fullName: second.fullName,
        phone: second.phone,
        role: second.role,
        emailVerified: second.emailVerified,
        active: true,
        version: second.version,
      }, adminActorId);
      const original = (await users.listUsers()).find(
        (user) => user.email === "admin@example.com",
      )!;
      const changed = await users.updateUser(original.id, {
        fullName: "Current Warehouse Name",
        phone: original.phone,
        role: "warehouse",
        emailVerified: original.emailVerified,
        active: true,
        version: original.version,
      }, adminActorId);

      const refreshed = await session(
        new NextRequest("http://localhost/api/auth/session", {
          headers: { cookie: `yu_inventory_session=${token}` },
        }),
      );
      expect(refreshed.status).toBe(200);
      await expect(refreshed.json()).resolves.toMatchObject({
        user: {
          name: "Current Warehouse Name",
          role: "warehouse",
        },
      });

      await users.updateUser(changed.id, {
        fullName: changed.fullName,
        phone: changed.phone,
        role: changed.role,
        emailVerified: changed.emailVerified,
        active: false,
        version: changed.version,
      }, second.id);
      const revoked = await session(
        new NextRequest("http://localhost/api/auth/session", {
          headers: { cookie: `yu_inventory_session=${token}` },
        }),
      );
      expect(revoked.status).toBe(401);
      expect(revoked.headers.get("set-cookie")).toContain(
        "yu_inventory_session=",
      );
    });

    it("expires the session cookie on logout", async () => {
      const response = await logout(uniqueRequest("/api/auth/logout", { method: "POST" }));
      expect(response.status).toBe(200);
      const rawCookie = response.headers.get("set-cookie") ?? "";
      expect(rawCookie).toContain("yu_inventory_session=");
      expect(rawCookie).toContain("Max-Age=0");
      expect(rawCookie).toContain("HttpOnly");
      expect(rawCookie).toContain("SameSite=strict");
      expect(rawCookie).toContain("Path=/");
    });
  });
});
