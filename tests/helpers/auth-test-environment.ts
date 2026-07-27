import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limiter";
import { resetSessionStateForTests } from "@/lib/security/session";
import { resetPasswordResetStateForTests } from "@/lib/security/password-reset";

const ORIGINAL_ENV = {
  YU_DATA_DIRECTORY: process.env.YU_DATA_DIRECTORY,
  SESSION_SECRET: process.env.SESSION_SECRET,
  AUTH_ADMIN_EMAIL: process.env.AUTH_ADMIN_EMAIL,
  AUTH_ADMIN_NAME: process.env.AUTH_ADMIN_NAME,
  AUTH_ADMIN_ROLE: process.env.AUTH_ADMIN_ROLE,
  AUTH_ADMIN_PASSWORD_HASH: process.env.AUTH_ADMIN_PASSWORD_HASH,
  AUTH_ADMIN_PASSWORD_SALT: process.env.AUTH_ADMIN_PASSWORD_SALT,
  AUTH_ADMIN_BLOCKED: process.env.AUTH_ADMIN_BLOCKED,
  AUTH_PASSWORD_RESET_WEBHOOK_URL: process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL,
  AUTH_PASSWORD_RESET_WEBHOOK_SECRET:
    process.env.AUTH_PASSWORD_RESET_WEBHOOK_SECRET,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export function createAuthTestDirectory() {
  return path.join(tmpdir(), `yu-inventory-auth-${randomUUID()}`);
}

export async function resetAuthTestEnvironment(directory: string) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}yu-inventory-auth-`)) {
    throw new Error(`Refusing to reset unsafe test directory: ${resolved}`);
  }

  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });
  process.env.YU_DATA_DIRECTORY = resolved;
  process.env.SESSION_SECRET = "yu-inventory-test-session-secret-2026";
  process.env.AUTH_ADMIN_EMAIL = "";
  process.env.AUTH_ADMIN_NAME = "";
  process.env.AUTH_ADMIN_ROLE = "";
  process.env.AUTH_ADMIN_PASSWORD_HASH = "";
  process.env.AUTH_ADMIN_PASSWORD_SALT = "";
  process.env.AUTH_ADMIN_BLOCKED = "";
  process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL = "";
  process.env.AUTH_PASSWORD_RESET_WEBHOOK_SECRET = "";
  resetRateLimitStateForTests();
  resetSessionStateForTests();
  resetPasswordResetStateForTests();
}

export async function removeAuthTestDirectory(directory: string) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}yu-inventory-auth-`)) {
    throw new Error(`Refusing to remove unsafe test directory: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
  restoreEnvironment();
}

let requestSequence = 0;

export function uniqueRequest(
  pathname: string,
  init: RequestInit = {},
  ip?: string,
) {
  requestSequence += 1;
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", ip ?? `198.51.100.${(requestSequence % 240) + 1}`);
  return new Request(`http://localhost${pathname}`, { ...init, headers });
}
