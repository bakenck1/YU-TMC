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
    const location = new URL(getRedirectUrl(response));
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
    ["admin", "/users", 200, null],
    ["owner", "/settings", 200, null],
    ["warehouse", "/analytics", 200, null],
    ["warehouse", "/users", 307, "/"],
    ["employee", "/items/42", 200, null],
    ["employee", "/locations", 307, "/items"],
  ] as const)("enforces %s access to %s", (role, pathname, status, redirectPath) => {
    const response = proxy(authenticatedRequest(pathname, role));
    expect(response.status).toBe(status);
    if (redirectPath) expect(new URL(getRedirectUrl(response)).pathname).toBe(redirectPath);
    else expect(response.headers.get("location")).toBeNull();
  });

  it("redirects authenticated users away from auth pages", () => {
    const admin = proxy(authenticatedRequest("/login", "admin"));
    const employee = proxy(authenticatedRequest("/register", "employee"));
    expect(new URL(getRedirectUrl(admin)).pathname).toBe("/");
    expect(new URL(getRedirectUrl(employee)).pathname).toBe("/items");
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
