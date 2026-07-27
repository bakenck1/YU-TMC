import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./login-protection";
import {
  normalizeAuthRole,
  type AuthenticatedUser,
} from "./authorization";
import { dataDirectory } from "../data-directory";

const scryptAsync = promisify(scrypt);
const DUMMY_SALT = "yu-inventory-dummy-credential-v1";
const DUMMY_HASH = scryptSync("invalid-password", DUMMY_SALT, 64);
function authFile() {
  return path.join(dataDirectory(), "auth-credentials.json");
}

interface StoredCredentials {
  email: string;
  name?: string;
  role?: "admin";
  salt: string;
  hash: string;
  updatedAt: string;
}

function envPasswordHash() {
  const value = process.env.AUTH_ADMIN_PASSWORD_HASH?.trim();
  if (!value || !/^[a-f\d]{128}$/i.test(value)) return null;
  return Buffer.from(value, "hex");
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<StoredCredentials>;
  return Boolean(
    typeof stored.email === "string" &&
      (stored.name === undefined || typeof stored.name === "string") &&
      (stored.role === undefined || stored.role === "admin") &&
      typeof stored.salt === "string" &&
      stored.salt.length >= 16 &&
      typeof stored.hash === "string" &&
      /^[a-f\d]{128}$/i.test(stored.hash) &&
      typeof stored.updatedAt === "string",
  );
}

async function storedCredentials() {
  try {
    const value: unknown = JSON.parse(await readFile(authFile(), "utf8"));
    return isStoredCredentials(value) ? value : null;
  } catch {
    return null;
  }
}

async function activeCredentials() {
  const stored = await storedCredentials();
  if (stored) {
    return {
      email: normalizeEmail(stored.email),
      name: stored.name?.trim(),
      role: stored.role,
      salt: stored.salt,
      hash: Buffer.from(stored.hash, "hex"),
    };
  }

  const email = normalizeEmail(process.env.AUTH_ADMIN_EMAIL ?? "");
  const salt = process.env.AUTH_ADMIN_PASSWORD_SALT?.trim() ?? "";
  const hash = envPasswordHash();
  return email && salt && hash
    ? {
        email,
        name: process.env.AUTH_ADMIN_NAME?.trim(),
        role: normalizeAuthRole(
          process.env.AUTH_ADMIN_ROLE?.trim().toLowerCase(),
        ),
        salt,
        hash,
      }
    : null;
}

export async function isPasswordLoginConfigured() {
  return (await activeCredentials()) !== null;
}

export async function getConfiguredUser(): Promise<
  (AuthenticatedUser & { blocked: boolean }) | null
> {
  const credentials = await activeCredentials();
  if (!credentials) return null;

  return {
    email: credentials.email,
    name:
      credentials.name ||
      credentials.email.split("@")[0] ||
      credentials.email,
    role: credentials.role ?? "admin",
    blocked: process.env.AUTH_ADMIN_BLOCKED?.trim().toLowerCase() === "true",
  };
}

export async function verifyPasswordCredentials(email: string, password: string) {
  const credentials = await activeCredentials();
  const expectedEmail = credentials?.email ?? "";
  const salt = credentials?.salt ?? DUMMY_SALT;
  const expectedHash = credentials?.hash ?? DUMMY_HASH;
  const candidateHash = (await scryptAsync(password, salt, expectedHash.length)) as Buffer;
  const passwordMatches = timingSafeEqual(candidateHash, expectedHash);
  const emailMatches = expectedEmail.length > 0 && normalizeEmail(email) === expectedEmail;

  return Boolean(credentials && emailMatches && passwordMatches);
}

export async function updatePasswordCredential(email: string, password: string) {
  const credentials = await activeCredentials();
  if (!credentials || normalizeEmail(email) !== credentials.email) return false;

  const salt = randomBytes(24).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  const next: StoredCredentials = {
    email: credentials.email,
    name: credentials.name,
    role: credentials.role === "admin" ? "admin" : undefined,
    salt,
    hash: hash.toString("hex"),
    updatedAt: new Date().toISOString(),
  };

  await mkdir(dataDirectory(), { recursive: true });
  await writeFile(authFile(), JSON.stringify(next, null, 2), "utf8");
  return true;
}

export async function initializeAdminCredential(input: {
  email: string;
  name: string;
  password: string;
}) {
  if (await activeCredentials()) return null;

  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const salt = randomBytes(24).toString("hex");
  const hash = (await scryptAsync(input.password, salt, 64)) as Buffer;
  const next: StoredCredentials = {
    email,
    name,
    role: "admin",
    salt,
    hash: hash.toString("hex"),
    updatedAt: new Date().toISOString(),
  };

  await mkdir(dataDirectory(), { recursive: true });
  try {
    await writeFile(authFile(), JSON.stringify(next, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return null;
    }
    throw error;
  }

  return {
    email,
    name,
    role: "admin" as const,
  };
}
