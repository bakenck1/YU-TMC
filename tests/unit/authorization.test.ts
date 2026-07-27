import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  defaultPathForRole,
  isSafeReturnPath,
  type AuthRole,
} from "@/lib/security/authorization";

describe("authorization contracts", () => {
  it.each<[AuthRole, string, boolean]>([
    ["admin", "/settings", true],
    ["owner", "/users/42", true],
    ["warehouse", "/", true],
    ["warehouse", "/items/42", true],
    ["warehouse", "/locations", true],
    ["warehouse", "/analytics", true],
    ["warehouse", "/users", false],
    ["warehouse", "/settings", false],
    ["employee", "/", true],
    ["employee", "/items", true],
    ["employee", "/items/42?tab=info#top", true],
    ["employee", "/items-other", false],
    ["employee", "/locations", false],
  ])("allows role %s to access %s: %s", (role, pathname, expected) => {
    expect(canAccessPath(role, pathname)).toBe(expected);
  });

  it.each<[AuthRole, string]>([
    ["admin", "/"],
    ["owner", "/"],
    ["warehouse", "/"],
    ["employee", "/items"],
  ])("uses the expected default route for %s", (role, expected) => {
    expect(defaultPathForRole(role)).toBe(expected);
  });

  it.each([
    "/",
    "/items",
    "/items?query=monitor&page=2",
    "/items/42#history",
  ])("accepts a safe local return path: %s", (value) => {
    expect(isSafeReturnPath(value)).toBe(true);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5cevil.example",
    "/%2f%2fevil.example",
    "/items\nLocation:https://evil.example",
    "/items%0d%0aLocation:https://evil.example",
    "%E0%A4%A",
  ])("rejects an unsafe return path: %s", (value) => {
    expect(isSafeReturnPath(value)).toBe(false);
  });
});
