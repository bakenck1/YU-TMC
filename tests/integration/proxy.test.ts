import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { createSessionToken } from "@/lib/security/session";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
} from "../helpers/auth-test-environment";

const directory = createAuthTestDirectory();

function authenticatedRequest(pathname: string, role: "admin" | "owner" | "warehouse" | "employee") {
  const token = createSessionToken({
    email: `${role}@example.com`,
    name: role,
    role,
  });
  return new NextRequest(`http://localhost${pathname}`, {
    headers: { cookie: `yu_inventory_session=${token}` },
  });
}

describe("proxy authorization", () => {
  beforeEach(async () => {
    await resetAuthTestEnvironment(directory);
  });

  afterAll(async () => {
    await removeAuthTestDirectory(directory);
  });

  it("redirects an anonymous deep link to login and preserves a safe returnTo", () => {
    const response = proxy(new NextRequest("http://localhost/items/42?tab=history"));
    expect(response.status).toBe(307);
    const location = new URL(getRedirectUrl(response)!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe("/items/42?tab=history");
  });

  it("deletes an invalid cookie while redirecting an anonymous request", () => {
    const response = proxy(
      new NextRequest("http://localhost/items", {
        headers: { cookie: "yu_inventory_session=invalid.token" },
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("yu_inventory_session=");
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });

  it.each([
    ["admin", "/users"],
    ["owner", "/settings"],
    ["warehouse", "/analytics"],
    ["warehouse", "/users"],
    ["employee", "/items/42"],
    ["employee", "/locations"],
  ] as const)("treats a signed %s session as an optimistic gate for %s", (role, pathname) => {
    const response = proxy(authenticatedRequest(pathname, role));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets DB-aware auth pages resolve signed sessions without a redirect loop", () => {
    const admin = proxy(authenticatedRequest("/login", "admin"));
    const employee = proxy(authenticatedRequest("/register", "employee"));
    expect(admin.status).toBe(200);
    expect(employee.status).toBe(200);
    expect(admin.headers.get("location")).toBeNull();
    expect(employee.headers.get("location")).toBeNull();
  });

  it.each([
    ["/items", true],
    ["/items/42", true],
    ["/api/auth/session", false],
    ["/_next/static/chunk.js", false],
    ["/_next/image?url=x", false],
    ["/favicon.ico", false],
    ["/items/photo.jpg", false],
  ] as const)("matches %s: %s", (url, expected) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: `http://localhost${url}`,
      }),
    ).toBe(expected);
  });
});
