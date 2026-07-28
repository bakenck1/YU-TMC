import { expect, test } from "@playwright/test";
import { removeE2EData, resetE2EData } from "../environment";

const EMAIL = "admin@example.com";
const PASSWORD = "Correct-Horse-Battery-2026!";

test.use({
  extraHTTPHeaders: { "x-forwarded-for": "198.51.100.11" },
});

test.beforeEach(async () => {
  await resetE2EData();
});

test.afterEach(async () => {
  await removeE2EData();
});

test("first administrator journey protects real browser sessions", async ({
  page,
  context,
}) => {
  await test.step("an anonymous deep link is preserved by the login redirect", async () => {
    await page.goto("/items?query=HP");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fitems%3Fquery%3DHP$/);
    await expect(page.getByRole("link", { name: "Тіркелу" })).toBeVisible();
  });

  await test.step("the first administrator registers and is automatically authenticated", async () => {
    await page.getByRole("link", { name: "Тіркелу" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await page.getByLabel("Аты", { exact: true }).fill("Ada");
    await page.getByLabel("Тегі", { exact: true }).fill("Lovelace");
    await page.getByLabel("Email", { exact: true }).fill(EMAIL);
    await page.getByLabel("Құпиясөз", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Құпиясөзді қайталаңыз", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Аккаунт жасау" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Ada Lovelace", { exact: true })).toBeVisible();
    const sessionResponse = await page.request.get("/api/auth/session");
    expect(sessionResponse.status()).toBe(200);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      authenticated: true,
      user: { email: EMAIL, name: "Ada Lovelace", role: "admin" },
    });

    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "yu_inventory_session",
    );
    expect(sessionCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Strict",
      secure: true,
    });
  });

  await test.step("an authenticated user cannot return to registration", async () => {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step("logout destroys access to protected pages", async () => {
    await page.getByRole("button", { name: "Шығу" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "yu_inventory_session",
      ),
    ).toBeUndefined();

    await page.goto("/items?query=HP");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fitems%3Fquery%3DHP$/);
  });

  await test.step("normalized credentials restore the original protected route", async () => {
    await page.getByLabel("Email", { exact: true }).fill("  ADMIN@EXAMPLE.COM  ");
    await page.getByLabel("Құпиясөз", { exact: true }).fill(PASSWORD);
    const remember = page.getByRole("checkbox", { name: "Мені есте сақтау" });
    await remember.uncheck();
    await page.getByRole("button", { name: "Кіру" }).click();
    await expect(page).toHaveURL(/\/items\?query=HP$/);

    const loginCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "yu_inventory_session",
    );
    expect(loginCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Strict",
      secure: true,
    });
    await expect(page.getByRole("heading", { name: "ТМҚ тізімі" })).toBeVisible();
  });
});
