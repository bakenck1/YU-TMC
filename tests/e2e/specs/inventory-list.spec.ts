import { expect, test } from "@playwright/test";
import { removeE2EData, resetE2EData } from "../environment";

test.beforeEach(async () => {
  await resetE2EData();
});

test.afterEach(async () => {
  await removeE2EData();
});

test("inventory list supports its primary desktop and mobile journey", async ({
  page,
  context,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    data: {
      firstName: "Inventory",
      lastName: "Tester",
      email: "inventory@example.com",
      password: "Reliable-Inventory-Tests-2026!",
    },
  });
  expect(registration.status()).toBe(201);

  await page.goto("/items");
  await expect(page).toHaveURL(/\/items$/);

  const table = page.getByRole("table");
  const rows = table.locator("tbody tr");
  const cards = page.getByRole("article");
  await expect(rows).toHaveCount(10);
  await expect(table).toBeVisible();
  await expect(cards.first()).toBeHidden();
  await expect(page.getByText("1–10, барлығы 110", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Артқа" })).toBeDisabled();

  const firstPhoto = rows.first().getByRole("img");
  await expect(firstPhoto).toBeVisible();
  await expect
    .poll(() => firstPhoto.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);

  const originalUrl = page.url();
  const firstItemCheckbox = rows.first().getByRole("checkbox");
  await firstItemCheckbox.check();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByText("Таңдалды: 1", { exact: true })).toBeVisible();

  await table.getByRole("checkbox", { name: "Барлық ТМҚ-ны таңдау" }).check();
  await expect(page.getByText("Таңдалды: 10", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(originalUrl);

  const search = page.getByRole("textbox", { name: "Іздеу" });
  await search.fill("2411/0162");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("2411/0162");
  await expect(page.getByText("1–1, барлығы 1", { exact: true })).toBeVisible();

  await search.clear();
  await page.getByRole("button", { name: "Алға" }).click();
  await expect(page.getByText("11–20, барлығы 110", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(10);
  await page.getByRole("button", { name: "Артқа" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards).toHaveCount(10);
  const firstCard = cards.first();
  await expect(table).toBeHidden();
  await expect(firstCard.getByRole("checkbox")).toBeChecked();
  await expect(firstCard.getByRole("img")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const pageCountBeforeNavigation = context.pages().length;
  const mobileCheckbox = firstCard.getByRole("checkbox");
  const mobileUrl = page.url();
  await mobileCheckbox.uncheck();
  await expect(page).toHaveURL(mobileUrl);
  await mobileCheckbox.check();
  await firstCard.locator("dl").click();
  await expect(page).toHaveURL(/\/items\/1$/);
  expect(context.pages()).toHaveLength(pageCountBeforeNavigation);

  await page.goBack();
  await expect(page).toHaveURL(/\/items$/);
  const itemLink = page.getByRole("article").first().getByRole("link", { name: /ID 1$/ });
  await itemLink.focus();
  await expect(itemLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/items\/1$/);
  expect(context.pages()).toHaveLength(pageCountBeforeNavigation);
});
