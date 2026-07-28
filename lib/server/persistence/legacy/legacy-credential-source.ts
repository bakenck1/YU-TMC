import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { USER_ROLES, type UserRole } from "@/lib/contracts/users";
import { dataDirectory } from "@/lib/data-directory";
import { normalizeUserEmail } from "@/lib/application/services/user-service";

export interface LegacyCredential {
  email: string;
  name: string;
  role: UserRole;
  blocked: boolean;
  salt: string;
  hash: Uint8Array;
}

interface StoredCredential {
  email: string;
  name?: string;
  role?: UserRole;
  salt: string;
  hash: string;
  updatedAt: string;
}

export async function readLegacyCredential(): Promise<LegacyCredential | null> {
  const fileCredential = await readCredentialFile();
  if (fileCredential) return fileCredential;
  return readEnvironmentCredential();
}

async function readCredentialFile(): Promise<LegacyCredential | null> {
  const filename = path.join(dataDirectory(), "auth-credentials.json");
  let serialized: string;
  try {
    serialized = await readFile(filename, "utf8");
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return null;
    throw new Error("Unable to read the legacy credential file.", {
      cause: error,
    });
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("The legacy credential file contains invalid JSON.", {
      cause: error,
    });
  }
  if (!isStoredCredential(value)) {
    throw new Error("The legacy credential file has an invalid shape.");
  }
  return {
    email: normalizeUserEmail(value.email),
    name: value.name?.trim() || defaultName(value.email),
    role: value.role ?? "admin",
    blocked: blockedFromEnvironment(),
    salt: value.salt,
    hash: Buffer.from(value.hash, "hex"),
  };
}

function readEnvironmentCredential(): LegacyCredential | null {
  const raw = {
    email: process.env.AUTH_ADMIN_EMAIL?.trim() ?? "",
    name: process.env.AUTH_ADMIN_NAME?.trim() ?? "",
    role: process.env.AUTH_ADMIN_ROLE?.trim().toLowerCase() ?? "",
    salt: process.env.AUTH_ADMIN_PASSWORD_SALT?.trim() ?? "",
    hash: process.env.AUTH_ADMIN_PASSWORD_HASH?.trim() ?? "",
  };
  const configured = Object.values(raw).some(Boolean);
  if (!configured) return null;

  if (
    !raw.email ||
    !raw.salt ||
    !/^[0-9a-f]{128}$/i.test(raw.hash) ||
    (raw.role && !USER_ROLES.includes(raw.role as UserRole))
  ) {
    throw new Error("The legacy AUTH_ADMIN_* environment is incomplete.");
  }
  return {
    email: normalizeUserEmail(raw.email),
    name: raw.name || defaultName(raw.email),
    role: (raw.role || "admin") as UserRole,
    blocked: blockedFromEnvironment(),
    salt: raw.salt,
    hash: Buffer.from(raw.hash, "hex"),
  };
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<StoredCredential>;
  return (
    typeof stored.email === "string" &&
    stored.email.trim().length > 0 &&
    (stored.name === undefined || typeof stored.name === "string") &&
    (stored.role === undefined || USER_ROLES.includes(stored.role)) &&
    typeof stored.salt === "string" &&
    stored.salt.length >= 16 &&
    typeof stored.hash === "string" &&
    /^[0-9a-f]{128}$/i.test(stored.hash) &&
    typeof stored.updatedAt === "string"
  );
}

function defaultName(email: string): string {
  return normalizeUserEmail(email).split("@")[0] || "Administrator";
}

function blockedFromEnvironment(): boolean {
  return process.env.AUTH_ADMIN_BLOCKED?.trim().toLowerCase() === "true";
}

function fileErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
