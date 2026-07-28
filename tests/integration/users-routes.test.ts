import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as register } from "@/app/api/auth/register/route";
import {
  GET as listUsers,
  POST as createUser,
} from "@/app/api/users/route";
import {
  DELETE as deleteUser,
  PATCH as updateUser,
} from "@/app/api/users/[id]/route";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
  uniqueRequest,
} from "../helpers/auth-test-environment";
import { getApplicationServices } from "@/lib/server/application";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/security/session";

const directory = createAuthTestDirectory();
let sessionCookie = "";
let ownerSessionCookie = "";
let employeeSessionCookie = "";
let adminActorId = "";

describe("persistent users route", () => {
  beforeEach(async () => {
    await resetAuthTestEnvironment(directory);
    const response = await register(
      jsonRequest("/api/auth/register", {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "admin@example.com",
        password: "Users-Route-Password-2026!",
      }),
    );
    sessionCookie =
      response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(response.status).toBe(201);

    const users = getApplicationServices().users;
    adminActorId = (
      await users.resolveCurrentAccount("admin@example.com")
    )!.userId;
    const owner = await users.createUser({
      fullName: "Owner User",
      email: "owner@example.com",
      role: "owner",
      active: true,
      initialPassword: "Owner-Route-Password-2026!",
    }, adminActorId);
    const employee = await users.createUser({
      fullName: "Employee User",
      email: "employee@example.com",
      role: "employee",
      active: true,
      initialPassword: "Employee-Route-Password-2026!",
    }, adminActorId);
    ownerSessionCookie = sessionCookieFor({
      email: owner.email,
      name: owner.fullName,
      role: owner.role,
    });
    employeeSessionCookie = sessionCookieFor({
      email: employee.email,
      name: employee.fullName,
      role: employee.role,
    });
  });

  afterAll(async () => {
    await removeAuthTestDirectory(directory);
  });

  it("requires a DB-resolved administrator", async () => {
    const response = await listUsers(uniqueRequest("/api/users"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("applies the centralized role matrix to user operations", async () => {
    const employeeResponse = await listUsers(
      authenticatedRequest("/api/users", {}, employeeSessionCookie),
    );
    expect(employeeResponse.status).toBe(403);

    const ownerResponse = await listUsers(
      authenticatedRequest("/api/users", {}, ownerSessionCookie),
    );
    expect(ownerResponse.status).toBe(200);

    const createdByOwner = await createUser(
      authenticatedJsonRequest(
        "/api/users",
        "POST",
        {
          fullName: "Managed Employee",
          email: "managed.employee@example.com",
          role: "employee",
        },
        ownerSessionCookie,
      ),
    );
    expect(createdByOwner.status).toBe(201);

    const forbiddenPromotion = await createUser(
      authenticatedJsonRequest(
        "/api/users",
        "POST",
        {
          fullName: "Forbidden Admin",
          email: "forbidden.admin@example.com",
          role: "admin",
        },
        ownerSessionCookie,
      ),
    );
    expect(forbiddenPromotion.status).toBe(403);

    const admin = (await getApplicationServices().users.listUsers()).find(
      (user) => user.email === "admin@example.com",
    )!;
    const forbiddenAdminEdit = await updateUser(
      authenticatedJsonRequest(
        `/api/users/${admin.id}`,
        "PATCH",
        {
          fullName: admin.fullName,
          phone: admin.phone,
          role: admin.role,
          emailVerified: admin.emailVerified,
          active: admin.active,
          version: admin.version,
        },
        ownerSessionCookie,
      ),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(forbiddenAdminEdit.status).toBe(403);

    const forbiddenAdminDelete = await deleteUser(
      authenticatedRequest(
        `/api/users/${admin.id}?version=${admin.version}`,
        { method: "DELETE" },
        ownerSessionCookie,
      ),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(forbiddenAdminDelete.status).toBe(403);
  });

  it("persists create, update and soft-delete with optimistic versions", async () => {
    const createdResponse = await createUser(
      authenticatedJsonRequest("/api/users", "POST", {
        fullName: "  Warehouse User ",
        email: " WAREHOUSE@example.com ",
        phone: "",
        role: "warehouse",
        emailVerified: false,
        active: true,
        initialPassword: "Warehouse-Initial-Password-2026!",
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).user;
    expect(created).toMatchObject({
      email: "warehouse@example.com",
      fullName: "Warehouse User",
      role: "warehouse",
      active: true,
      version: 1,
    });

    const listAfterCreate = await listUsers(
      authenticatedRequest("/api/users"),
    );
    await expect(listAfterCreate.json()).resolves.toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({ id: created.id }),
      ]),
    });

    const updatedResponse = await updateUser(
      authenticatedJsonRequest(`/api/users/${created.id}`, "PATCH", {
        fullName: "Warehouse Manager",
        phone: "+0 000 000 00 00",
        role: "warehouse",
        emailVerified: true,
        active: true,
        version: created.version,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()).user;
    expect(updated).toMatchObject({
      fullName: "Warehouse Manager",
      active: true,
      version: 2,
    });

    const staleResponse = await updateUser(
      authenticatedJsonRequest(`/api/users/${created.id}`, "PATCH", {
        fullName: "Stale Name",
        phone: null,
        role: "employee",
        emailVerified: false,
        active: false,
        version: 1,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toEqual({
      error: "user_version_conflict",
    });

    const deletedResponse = await deleteUser(
      authenticatedRequest(
        `/api/users/${created.id}?version=${updated.version}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(deletedResponse.status).toBe(204);

    const listAfterDelete = await listUsers(
      authenticatedRequest("/api/users"),
    );
    const remaining = (await listAfterDelete.json()).users;
    expect(remaining).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
  });

  it("rejects localized role labels and duplicate case variants", async () => {
    const localized = await createUser(
      authenticatedJsonRequest("/api/users", "POST", {
        fullName: "Localized Role",
        email: "localized@example.com",
        role: "Кладовщик",
      }),
    );
    expect(localized.status).toBe(400);
    await expect(localized.json()).resolves.toEqual({
      error: "invalid_request",
    });

    const input = {
      fullName: "First User",
      email: "duplicate@example.com",
      role: "employee",
    };
    expect(
      (await createUser(authenticatedJsonRequest("/api/users", "POST", input)))
        .status,
    ).toBe(201);
    const duplicate = await createUser(
      authenticatedJsonRequest("/api/users", "POST", {
        ...input,
        email: " DUPLICATE@EXAMPLE.COM ",
      }),
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({
      error: "email_already_exists",
    });
  });

  it("returns a stable validation error for malformed JSON", async () => {
    const response = await createUser(
      authenticatedRequest("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });

  it("rejects malformed user ids before reaching PostgreSQL", async () => {
    const patchResponse = await updateUser(
      authenticatedJsonRequest("/api/users/not-a-uuid", "PATCH", {
        fullName: "Invalid Identifier",
        phone: null,
        role: "employee",
        emailVerified: false,
        active: false,
        version: 1,
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(patchResponse.status).toBe(400);
    await expect(patchResponse.json()).resolves.toEqual({
      error: "invalid_request",
    });

    const deleteResponse = await deleteUser(
      authenticatedRequest("/api/users/not-a-uuid?version=1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(deleteResponse.status).toBe(400);
    await expect(deleteResponse.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });
});

function jsonRequest(pathname: string, body: unknown) {
  return uniqueRequest(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authenticatedJsonRequest(
  pathname: string,
  method: "POST" | "PATCH",
  body: unknown,
  cookie = sessionCookie,
) {
  return authenticatedRequest(pathname, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, cookie);
}

function authenticatedRequest(
  pathname: string,
  init: RequestInit = {},
  cookie = sessionCookie,
) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  return uniqueRequest(pathname, { ...init, headers });
}

function sessionCookieFor(user: {
  email: string;
  name: string;
  role: "admin" | "owner" | "warehouse" | "employee";
}) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(user))}`;
}
