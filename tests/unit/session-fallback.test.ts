import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
} from "../helpers/auth-test-environment";
import {
  createSessionToken,
  resetSessionStateForTests,
  verifySessionToken,
} from "@/lib/security/session";

const directory = createAuthTestDirectory();

describe("fallback session secret", () => {
  beforeAll(async () => {
    await resetAuthTestEnvironment(directory);
    delete process.env.SESSION_SECRET;
  });

  afterAll(async () => {
    process.env.SESSION_SECRET = "yu-inventory-test-session-secret-2026";
    await removeAuthTestDirectory(directory);
  });

  it("persists the generated secret across an in-memory reset", () => {
    const token = createSessionToken(
      { email: "admin@example.com", name: "Admin", role: "admin" },
      60,
    );
    resetSessionStateForTests();
    expect(verifySessionToken(token)).not.toBeNull();
  });
});
