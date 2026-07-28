import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  GET as getSettings,
  PATCH as patchSettings,
} from "@/app/api/settings/route";
import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { dataDirectory } from "@/lib/data-directory";
import type { AuthRole } from "@/lib/security/authorization";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/security/session";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
  uniqueRequest,
} from "../helpers/auth-test-environment";
import { getApplicationServices } from "@/lib/server/application";

const directory = createAuthTestDirectory();

function settingsRequest(
  method: "GET" | "PATCH",
  body?: unknown,
  role?: AuthRole,
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (role) {
    const token = createSessionToken({
      email: `${role}@example.com`,
      name: role,
      role,
    });
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
  }

  return uniqueRequest("/api/settings", {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("settings route", () => {
  beforeEach(async () => {
    await resetAuthTestEnvironment(directory);
    const users = getApplicationServices().users;
    await users.registerFirstAdmin({
      email: "admin@example.com",
      name: "Admin",
      password: "Settings-Test-Password-2026!",
    });
    for (const role of ["owner", "employee"] as const) {
      const created = await users.createUser({
        email: `${role}@example.com`,
        fullName: role,
        role,
        initialPassword: `Settings-${role}-Password-2026!`,
      });
      await users.updateUser(created.id, {
        fullName: created.fullName,
        phone: created.phone,
        role: created.role,
        emailVerified: created.emailVerified,
        active: true,
        version: created.version,
      });
    }
  });

  afterAll(async () => {
    await removeAuthTestDirectory(directory);
  });

  it("returns the compatible default payload and persists it", async () => {
    const response = await getSettings(settingsRequest("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(DEFAULT_APP_SETTINGS);
    await expect(
      readFile(path.join(dataDirectory(), "settings.json"), "utf8").then(
        JSON.parse,
      ),
    ).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("requires a permitted session before updating settings", async () => {
    const unauthorized = await patchSettings(
      settingsRequest("PATCH", { language: "ru" }),
    );
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: "unauthorized",
    });

    const forbidden = await patchSettings(
      settingsRequest("PATCH", { language: "ru" }, "employee"),
    );
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("updates settings through the service and repository", async () => {
    const response = await patchSettings(
      settingsRequest(
        "PATCH",
        {
          organizationName: "  YU Campus  ",
          language: "en",
          maintenanceAlerts: false,
        },
        "owner",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationName: "YU Campus",
      language: "en",
      maintenanceAlerts: false,
    });
    await expect(
      readFile(path.join(dataDirectory(), "settings.json"), "utf8").then(
        JSON.parse,
      ),
    ).resolves.toMatchObject({
      organizationName: "YU Campus",
      language: "en",
      maintenanceAlerts: false,
    });
  });

  it.each([
    [{ organizationName: "x" }, "invalid_organization_name"],
    [{ language: "de" }, "invalid_language"],
    [{ pushNotifications: "yes" }, "invalid_notification_setting"],
    [{ unknown: true }, "invalid_settings_payload"],
  ])("returns a stable validation error for %j", async (body, error) => {
    const response = await patchSettings(
      settingsRequest("PATCH", body, "admin"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("returns a validation error for malformed JSON", async () => {
    const token = createSessionToken({
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    });
    const response = await patchSettings(
      uniqueRequest("/api/settings", {
        method: "PATCH",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
          "content-type": "application/json",
        },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_settings_payload",
    });
  });

  it("does not lose concurrent patches", async () => {
    const [language, notifications] = await Promise.all([
      patchSettings(
        settingsRequest("PATCH", { language: "ru" }, "owner"),
      ),
      patchSettings(
        settingsRequest("PATCH", { emailNotifications: false }, "owner"),
      ),
    ]);
    expect(language.status).toBe(200);
    expect(notifications.status).toBe(200);

    const persisted = JSON.parse(
      await readFile(path.join(dataDirectory(), "settings.json"), "utf8"),
    );
    expect(persisted).toMatchObject({
      language: "ru",
      emailNotifications: false,
    });
  });

  it("returns a safe unavailable response for corrupt persisted data", async () => {
    await mkdir(dataDirectory(), { recursive: true });
    await writeFile(
      path.join(dataDirectory(), "settings.json"),
      "{corrupt",
      "utf8",
    );

    const response = await getSettings(settingsRequest("GET"));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe('{"error":"settings_unavailable"}');
    expect(body).not.toContain(dataDirectory());
    expect(body).not.toContain("SyntaxError");
  });
});
