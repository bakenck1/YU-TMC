import "server-only";

import {
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import type {
  PasswordHash,
  PasswordHasher,
} from "@/lib/application/ports/password-hasher";

const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
const LEGACY_SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const KEY_LENGTH = 64;
const DUMMY_SALT = "yu-inventory-dummy-credential-v2";
const DUMMY_HASH = scryptSync(
  "invalid-password",
  DUMMY_SALT,
  KEY_LENGTH,
  SCRYPT_OPTIONS,
);

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<PasswordHash> {
    const salt = encodedSalt(randomBytes(24).toString("hex"), SCRYPT_OPTIONS);
    return {
      salt,
      hash: await deriveKey(password, salt),
    };
  }

  async verify(
    password: string,
    credential: { salt: string; hash: Uint8Array } | null,
  ): Promise<boolean> {
    const expected = credential
      ? Buffer.from(credential.hash)
      : DUMMY_HASH;
    const salt = credential?.salt ?? DUMMY_SALT;
    const candidate = await deriveKey(
      password,
      credential ? salt : encodedSalt(salt, SCRYPT_OPTIONS),
    );

    return (
      expected.length === candidate.length &&
      timingSafeEqual(candidate, expected) &&
      credential !== null
    );
  }

  needsRehash(credential: { salt: string; hash: Uint8Array }): boolean {
    const parsed = parseSalt(credential.salt);
    return (
      parsed.options.N !== SCRYPT_OPTIONS.N ||
      parsed.options.r !== SCRYPT_OPTIONS.r ||
      parsed.options.p !== SCRYPT_OPTIONS.p
    );
  }
}

async function deriveKey(password: string, encoded: string): Promise<Buffer> {
  const { salt, options } = parseSalt(encoded);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function encodedSalt(
  salt: string,
  options: Pick<typeof SCRYPT_OPTIONS, "N" | "r" | "p">,
) {
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt}`;
}

function parseSalt(value: string) {
  const match = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([a-f0-9]{48})$/i.exec(value);
  if (!match) return { salt: value, options: LEGACY_SCRYPT_OPTIONS };
  const [, rawN, rawR, rawP, salt] = match;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (N !== 16_384 || r !== 8 || (p !== 1 && p !== 5)) {
    return { salt: value, options: LEGACY_SCRYPT_OPTIONS };
  }
  return {
    salt: salt!,
    options: { N, r, p, maxmem: p === 5 ? 64 * 1024 * 1024 : 32 * 1024 * 1024 },
  };
}
