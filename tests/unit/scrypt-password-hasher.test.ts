import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ScryptPasswordHasher } from "@/lib/server/security/scrypt-password-hasher";

describe("ScryptPasswordHasher", () => {
  it("verifies the exact legacy scrypt format without rehashing", async () => {
    const password = "Legacy-Password-2026!";
    const salt = "0123456789abcdef0123456789abcdef";
    const legacyHash = scryptSync(password, salt, 64);
    const hasher = new ScryptPasswordHasher();

    await expect(
      hasher.verify(password, { salt, hash: legacyHash }),
    ).resolves.toBe(true);
    await expect(
      hasher.verify("wrong-password", { salt, hash: legacyHash }),
    ).resolves.toBe(false);
  });

  it("creates independent 64-byte hashes and exercises the dummy path", async () => {
    const hasher = new ScryptPasswordHasher();
    const first = await hasher.hash("Same-Password-2026!");
    const second = await hasher.hash("Same-Password-2026!");

    expect(first.salt).toMatch(/^[0-9a-f]{48}$/);
    expect(first.hash).toHaveLength(64);
    expect(first.salt).not.toBe(second.salt);
    await expect(
      hasher.verify("Same-Password-2026!", first),
    ).resolves.toBe(true);
    await expect(
      hasher.verify("Same-Password-2026!", null),
    ).resolves.toBe(false);
  });
});
