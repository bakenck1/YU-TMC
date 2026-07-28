import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  E2E_WEBHOOK_FILE,
  removeE2EData,
  resetE2EData,
} from "../environment";

const EMAIL = "admin@example.com";
const OLD_PASSWORD = "Correct-Horse-Battery-2026!";
const NEW_PASSWORD = "Replacement-Password-2026!";

test.use({
  extraHTTPHeaders: { "x-forwarded-for": "198.51.100.13" },
});

test.beforeEach(async () => {
  await resetE2EData();
});

test.afterEach(async () => {
  await removeE2EData();
});

test("a user recovers access through the real delivery and login flow", async ({
  page,
  context,
}) => {
  await test.step("create the account and enter recovery from login", async () => {
    const registration = await page.request.post("/api/auth/register", {
      data: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: EMAIL,
        password: OLD_PASSWORD,
      },
    });
    expect(registration.status()).toBe(201);
    await context.clearCookies();

    await page.goto("/login");
    await page.locator('a[href="/forgot-password"]').click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.locator('input[type="email"]').fill(`  ${EMAIL.toUpperCase()}  `);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('a[href^="/reset-password?email="]')).toBeVisible();
  });

  let deliveredCode = "";
  let deliveredResetUrl = "";
  await test.step("receive a real authenticated webhook and follow its reset link", async () => {
    await expect
      .poll(async () => {
        try {
          const payload = JSON.parse(await readFile(E2E_WEBHOOK_FILE, "utf8")) as {
            code?: string;
            email?: string;
            resetUrl?: string;
          };
          deliveredCode = payload.code ?? "";
          deliveredResetUrl = payload.resetUrl ?? "";
          return payload;
        } catch {
          return null;
        }
      })
      .toMatchObject({
        email: EMAIL,
        code: expect.stringMatching(/^\d{6}$/),
        resetUrl: expect.stringMatching(/\/reset-password\?email=admin%40example\.com$/),
      });

    await page.goto(deliveredResetUrl);
    await expect(page).toHaveURL(/\/reset-password\?email=admin%40example\.com$/);
    await expect(page.locator('input[type="email"]')).toHaveValue(EMAIL);
  });

  await test.step("client validation blocks a mismatched confirmation", async () => {
    await page.locator('input[autocomplete="one-time-code"]').fill(deliveredCode);
    const passwordInputs = page.locator('input[autocomplete="new-password"]');
    await passwordInputs.nth(0).fill(NEW_PASSWORD);
    await passwordInputs.nth(1).fill("Different-Password-2026!");
    let resetRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/auth/reset-password")) resetRequests += 1;
    });
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("form .text-red-600")).toHaveCount(1);
    expect(resetRequests).toBe(0);
  });

  await test.step("the delivered code updates the password once", async () => {
    const passwordInputs = page.locator('input[autocomplete="new-password"]');
    await passwordInputs.nth(1).fill(NEW_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('a[href="/login"]')).toBeVisible();
  });

  await test.step("the old password is rejected and the new password signs in", async () => {
    await page.locator('a[href="/login"]').click();
    await expect(page).toHaveURL(/\/login$/);
    const email = page.locator('input[type="email"]');
    const password = page.locator('input[autocomplete="current-password"]');
    await email.fill(EMAIL);
    await password.fill(OLD_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toBeVisible();

    await password.fill(NEW_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Ada Lovelace", { exact: true })).toBeVisible();
  });
});
