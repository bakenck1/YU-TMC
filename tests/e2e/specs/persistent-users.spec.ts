import { expect, test } from "@playwright/test";

import { removeE2EData, resetE2EData } from "../environment";

test.use({
  extraHTTPHeaders: { "x-forwarded-for": "198.51.100.14" },
});

test.beforeEach(async () => {
  await resetE2EData();
});

test.afterEach(async () => {
  await removeE2EData();
});

test("an administrator manages durable user records through the real UI boundary", async ({
  page,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    data: {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "admin@example.com",
      password: "Persistent-Users-E2E-2026!",
    },
  });
  expect(registration.status()).toBe(201);

  const createdResponse = await page.request.post("/api/users", {
    data: {
      fullName: "Warehouse Specialist",
      email: "warehouse@example.com",
      role: "warehouse",
      active: false,
      initialPassword: "Warehouse-Initial-Password-2026!",
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).user;
  expect(created).toMatchObject({ active: false, version: 1 });

  await page.goto("/users");
  await expect(
    page.getByText("Warehouse Specialist", { exact: true }).first(),
  ).toBeVisible();

  const updatedResponse = await page.request.patch(`/api/users/${created.id}`, {
    data: {
      fullName: "Warehouse Lead",
      phone: "+0 000 000 00 00",
      role: "warehouse",
      emailVerified: true,
      active: true,
      version: created.version,
    },
  });
  expect(updatedResponse.status()).toBe(200);
  const updated = (await updatedResponse.json()).user;
  expect(updated).toMatchObject({ active: true, version: 2 });

  await page.reload();
  await expect(
    page.getByText("Warehouse Lead", { exact: true }).first(),
  ).toBeVisible();

  const stale = await page.request.patch(`/api/users/${created.id}`, {
    data: {
      fullName: "Stale Edit",
      phone: null,
      role: "employee",
      emailVerified: false,
      active: false,
      version: 1,
    },
  });
  expect(stale.status()).toBe(409);
  await expect(stale.json()).resolves.toEqual({
    error: "user_version_conflict",
  });

  const secondAdminResponse = await page.request.post("/api/users", {
    data: {
      fullName: "Second Administrator",
      email: "second-admin@example.com",
      role: "admin",
      initialPassword: "Second-Admin-Password-2026!",
    },
  });
  const secondAdmin = (await secondAdminResponse.json()).user;
  expect(
    (
      await page.request.patch(`/api/users/${secondAdmin.id}`, {
        data: {
          fullName: secondAdmin.fullName,
          phone: secondAdmin.phone,
          role: secondAdmin.role,
          emailVerified: secondAdmin.emailVerified,
          active: true,
          version: secondAdmin.version,
        },
      })
    ).status(),
  ).toBe(200);

  const currentAdmin = (
    (await (await page.request.get("/api/users")).json()).users as Array<{
      id: string;
      email: string;
      fullName: string;
      phone: string | null;
      role: "admin";
      emailVerified: boolean;
      active: boolean;
      version: number;
    }>
  ).find((user) => user.email === "admin@example.com")!;
  expect(
    (
      await page.request.patch(`/api/users/${currentAdmin.id}`, {
        data: {
          fullName: currentAdmin.fullName,
          phone: currentAdmin.phone,
          role: currentAdmin.role,
          emailVerified: currentAdmin.emailVerified,
          active: false,
          version: currentAdmin.version,
        },
      })
    ).status(),
  ).toBe(200);

  await page.goto("/items");
  await expect(page).toHaveURL(/\/login$/);
});
