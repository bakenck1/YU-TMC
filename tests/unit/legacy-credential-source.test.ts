import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { dataDirectory } from "@/lib/data-directory";
import { readLegacyCredential } from "@/lib/server/persistence/legacy/legacy-credential-source";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
} from "../helpers/auth-test-environment";

const directory = createAuthTestDirectory();
const HASH = "ab".repeat(64);

describe("legacy credential source", () => {
  beforeEach(async () => {
    await resetAuthTestEnvironment(directory);
  });

  afterAll(async () => {
    await removeAuthTestDirectory(directory);
  });

  it("uses a valid credential file before a complete environment source", async () => {
    process.env.AUTH_ADMIN_EMAIL = "env@example.com";
    process.env.AUTH_ADMIN_NAME = "Environment Admin";
    process.env.AUTH_ADMIN_ROLE = "owner";
    process.env.AUTH_ADMIN_PASSWORD_SALT = "environment-salt-value";
    process.env.AUTH_ADMIN_PASSWORD_HASH = "cd".repeat(64);
    await writeCredentialFile({
      email: " File@Example.com ",
      name: "File Admin",
      role: "warehouse",
      salt: "file-credential-salt",
      hash: HASH,
      updatedAt: "2026-07-28T00:00:00.000Z",
    });

    await expect(readLegacyCredential()).resolves.toMatchObject({
      email: "file@example.com",
      name: "File Admin",
      role: "warehouse",
      salt: "file-credential-salt",
    });
  });

  it("fails closed for malformed or invalid credential files", async () => {
    await mkdir(dataDirectory(), { recursive: true });
    await writeFile(
      path.join(dataDirectory(), "auth-credentials.json"),
      "{not-json",
      "utf8",
    );
    await expect(readLegacyCredential()).rejects.toThrow(/invalid JSON/);

    await writeCredentialFile({ email: "missing-fields@example.com" });
    await expect(readLegacyCredential()).rejects.toThrow(/invalid shape/);
  });

  it("rejects an incomplete AUTH_ADMIN environment", async () => {
    process.env.AUTH_ADMIN_EMAIL = "admin@example.com";
    process.env.AUTH_ADMIN_PASSWORD_SALT = "";
    process.env.AUTH_ADMIN_PASSWORD_HASH = "";
    await expect(readLegacyCredential()).rejects.toThrow(/incomplete/);
  });

  it("preserves the role and blocked status from the active environment source", async () => {
    process.env.AUTH_ADMIN_EMAIL = "Owner@Example.com";
    process.env.AUTH_ADMIN_NAME = "Owner User";
    process.env.AUTH_ADMIN_ROLE = "owner";
    process.env.AUTH_ADMIN_PASSWORD_SALT = "environment-salt-value";
    process.env.AUTH_ADMIN_PASSWORD_HASH = HASH;
    process.env.AUTH_ADMIN_BLOCKED = "true";

    await expect(readLegacyCredential()).resolves.toMatchObject({
      email: "owner@example.com",
      name: "Owner User",
      role: "owner",
      blocked: true,
    });
  });
});

async function writeCredentialFile(value: unknown) {
  await mkdir(dataDirectory(), { recursive: true });
  await writeFile(
    path.join(dataDirectory(), "auth-credentials.json"),
    JSON.stringify(value),
    "utf8",
  );
}
