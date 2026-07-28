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

const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
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
    const salt = randomBytes(24).toString("hex");
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
    const candidate = await deriveKey(password, salt);

    return (
      expected.length === candidate.length &&
      timingSafeEqual(candidate, expected) &&
      credential !== null
    );
  }
}

async function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
