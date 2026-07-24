import "server-only";

import { promisify } from "node:util";
import { scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./login-protection";

const scryptAsync = promisify(scrypt);
const DUMMY_SALT = "yu-inventory-dummy-credential-v1";
const DUMMY_HASH = scryptSync("invalid-password", DUMMY_SALT, 64);

function configuredPasswordHash() {
  const value = process.env.AUTH_ADMIN_PASSWORD_HASH?.trim();
  if (!value || !/^[a-f\d]{128}$/i.test(value)) return null;
  return Buffer.from(value, "hex");
}

export function isPasswordLoginConfigured() {
  return Boolean(
    process.env.AUTH_ADMIN_EMAIL?.trim() &&
      process.env.AUTH_ADMIN_PASSWORD_SALT?.trim() &&
      configuredPasswordHash(),
  );
}

export async function verifyPasswordCredentials(email: string, password: string) {
  const expectedEmail = normalizeEmail(process.env.AUTH_ADMIN_EMAIL ?? "");
  const salt = process.env.AUTH_ADMIN_PASSWORD_SALT?.trim() || DUMMY_SALT;
  const expectedHash = configuredPasswordHash() ?? DUMMY_HASH;
  const candidateHash = (await scryptAsync(password, salt, expectedHash.length)) as Buffer;
  const passwordMatches = timingSafeEqual(candidateHash, expectedHash);
  const emailMatches = expectedEmail.length > 0 && normalizeEmail(email) === expectedEmail;

  return isPasswordLoginConfigured() && emailMatches && passwordMatches;
}
